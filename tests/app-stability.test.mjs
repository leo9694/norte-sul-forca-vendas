import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { applyPromotions } from '../app/promotional-prices.ts';
const source=await readFile(new URL('../app/sales-app.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('sales-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const app=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='SalesApp');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function local(name,bindings,scope=app) {
  const node=scope.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name));
  return new Function(...Object.keys(bindings),compile(node.getText(ast))+`;return ${name};`)(...Object.values(bindings));
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('floating notices expire at exactly 5 seconds and replacement/unmount removes the previous timer',()=>{
  const effect=app.body.statements.find(n=>ts.isExpressionStatement(n)&&n.expression.expression?.getText(ast)==='useEffect'&&n.getText(ast).includes('setToastText'));
  const active=new Map();let nextId=0,message='A';
  const win={setTimeout(fn,ms){assert.equal(ms,5000);active.set(++nextId,fn);return nextId;},clearTimeout(id){active.delete(id);}};
  const start=text=>new Function('toast','window','setToastText',compile('const effect='+effect.expression.arguments[0].getText(ast)+';')+';return effect();')(text,win,value=>{message=value;});
  assert.match(effect.expression.arguments[1].getText(ast),/toastVersion/);
  const first=start('A');assert.equal(message,'A');assert.equal(active.size,1);
  first(); const second=start('B');assert.equal(active.size,1);
  [...active.values()][0]();assert.equal(message,'');second();assert.equal(active.size,0);
  assert.equal(start(''),undefined);
});

test('repeating the same notice restarts its lifetime, rather than being ignored by state equality',()=>{
  let text='',version=0;
  const show=local('setToast',{setToastText:value=>{text=value;},setToastVersion:update=>{version=update(version);}});
  show('same');show('same');assert.equal(text,'same');assert.equal(version,2);
});

test('read timeouts cover response bodies, preserve caller signals and never impose retries or deadlines on order writes',async()=>{
  const apiNode=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='api');
  const code=compile(apiNode.getText(ast));
  const durations=[],calls=[];
  class ApiError extends Error {}
  const api=new Function('fetch','AbortSignal','ApiError',code+';return api;')(async(_url,init)=>{calls.push(init);return Response.json({ok:true});},
    {timeout(ms){durations.push(ms);return new AbortController().signal;}},ApiError);
  await api('/api/data');await api('/api/sankhya/sync');
  await api('/api/sankhya/orders',{method:'POST',body:'{}'});
  const caller=new AbortController().signal;await api('/api/data',{signal:caller});
  assert.deepEqual(durations,[45000,600000]);assert.equal(calls[2].signal,undefined);assert.equal(calls[3].signal,caller);
  const controller=new AbortController();
  const timed=new Function('fetch','AbortSignal','ApiError',code+';return api;')(async()=>({text:()=>new Promise((_yes,no)=>controller.signal.addEventListener('abort',()=>no(controller.signal.reason),{once:true}))}),{timeout(){return controller.signal;}},ApiError);
  const pending=assert.rejects(timed('/api/data'),/demorou.*dados locais foram mantidos/);
  await Promise.resolve();controller.abort(new DOMException('timeout','TimeoutError'));await pending;
});

test('late order-filter responses and responses from a logged-out session cannot replace current orders',async()=>{
  const requests=[],events=[],epoch={current:0};
  const load=local('loadOrders',{
    ordersRequestRef:{current:0},sessionEpochRef:epoch,sellerId:4,offlineData:null,
    currentMonthStart:()=>'',inputDate:()=>'',api:()=>{const request=deferred();requests.push(request);return request.promise;},
    setLoadingOrders:value=>events.push(['loading',value]),setOrders:rows=>events.push(['orders',rows]),
    setAuthenticated:value=>events.push(['auth',value]),setCheckingSession:()=>{},setUser:()=>{},setUserId:()=>{},setSellerId:()=>{},setSellerName:()=>{},
    setToast:()=>{},getOfflineSnapshot:async()=>null,getLatestOfflineSnapshot:async()=>null,ApiError:class extends Error {},
  });
  const first=load(),second=load();requests[1].resolve({rows:['new']});await second;
  requests[0].resolve({rows:['old']});await first;
  assert.deepEqual(events.filter(([name])=>name==='orders'),[['orders',['new']]]);
  const third=load();epoch.current++;requests[2].resolve({rows:['foreign']});await third;
  assert.equal(events.filter(([name])=>name==='orders').length,1);
});

test('seller changes persist the order scope and returning reloads the same seller and dates',()=>{
  let selection;const calls=[],orderFilters={sellerId:4,from:'2026-10-01',to:'2026-10-31'};
  const change=local('changeOrderSelection',{userId:7,orderFilters,setOrders:rows=>assert.deepEqual(rows,[]),setOrdersSelection:value=>{selection=value;},loadOrders:(...args)=>calls.push(args)});
  change(orderFilters.from,orderFilters.to,8);
  assert.deepEqual(selection,{...orderFilters,userId:7,sellerId:8});
  const reload=local('reloadOrderSelection',{orderFilters:selection,loadOrders:(...args)=>calls.push(args)});
  reload();assert.deepEqual(calls,[['2026-10-01','2026-10-31',8],['2026-10-01','2026-10-31',8]]);
});

test('opening a prepared duplicate makes no repeat price/promotion calls; changing the table refreshes prices',async()=>{
  const editor=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='NewOrderV2');
  const findEffect=marker=>editor.body.statements.find(n=>ts.isExpressionStatement(n)&&n.getText(ast).startsWith('useEffect(')&&n.getText(ast).includes(marker)).expression.arguments[0].getText(ast);
  const calls=[],readiness=[],prices={current:'prepared-key'},prepared={current:{sellerId:8,online:true}};
  const env={prepared,preparedPriceKey:prices,actingSellerId:8,online:true,currentPricingKey:'prepared-key',cartProductCodes:'42',companyCode:1,priceCode:4,partner:{CODPARC:12},setPromotions(){throw Error('Should retain prepared promotions');},setPromotionsError(){},setPricesError(){},setPricesReady:value=>readiness.push(value),api:(url)=>{calls.push(url);return Promise.reject(Error('test response'));}};
  const run=(marker,bindings)=>new Function(...Object.keys(bindings),compile('const effect='+findEffect(marker)+';')+';return effect();')(...Object.values(bindings));
  run('setPromotions(null)',env);run('preparedPriceKey.current',env);
  assert.deepEqual(calls,[]);assert.deepEqual(readiness,[true]);
  run('preparedPriceKey.current',{...env,currentPricingKey:'new-table',priceCode:5});
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls,['/api/sankhya/order-prices']);assert.deepEqual(readiness,[true,false]);assert.equal(prices.current,undefined);
});

test('only one complete load runs at a time and its late result cannot reopen a signed-out session',async()=>{
  const request=deferred(),epoch={current:0},events=[];let calls=0;
  const load=local('makeLoad',{
    loadInFlightRef:{current:false},loadAbortRef:{current:null},sessionEpochRef:epoch,ordersRequestRef:{current:0},navigator:{onLine:true},
    api:()=>{calls++;return request.promise;},saveOfflineSnapshot:async()=>events.push('saved'),applySnapshot:()=>events.push('applied'),
    localStorage:{setItem(){}},OFFLINE_SESSION_KEY:'fixture',setSyncing:()=>{},setLoadError:()=>{},setLoadStage:()=>{},setToast:()=>{},returnToLogin:()=>{},ApiError:class extends Error {},
  });
  const first=load();assert.equal(await load(),null);assert.equal(calls,1);
  epoch.current++;request.resolve({clients:[],products:[]});await first;
  assert.deepEqual(events,[]);
});

test('promotion lookup indexes product metadata once and preserves group quantity discounts',()=>{
  let visits=0;
  const products=Array.from({length:10000},(_,index)=>({get CODPROD(){visits++;return index+1;},GRUPODESCPROD:'GOLDEN'}));
  const data={products,partners:[],negotiations:[{CODTIPVENDA:23,DESCPROM:'D'}],parameters:[],bands:[{NUPROMOCAO:1,QTDE:100,PERCDESC:10,TIPDESC:'P'}],rules:[{NUPROMOCAO:1,GRUPODESCPROD:'GOLDEN',USADESCQTD:'G',DTINICIAL:'01012020 00:00:00',DTFINAL:'31122999 00:00:00'}],seller:4,sellerGroup:''};
  const items=Array.from({length:100},(_,index)=>({CODPROD:index+1,CODLOCAL:1010101,CONTROLE:' ',CODVOL:'UN',VLRVENDA:10,quantity:1}));
  const result=applyPromotions(items,data,{partner:1,company:1,table:4,negotiation:23});
  assert.equal(visits,10000);assert.ok(result.every(item=>item.promotionalPrice===9));
});

test('auxiliary unread polling never piles up requests while an earlier response is pending',async()=>{
  const effect=app.body.statements.find(n=>ts.isExpressionStatement(n)&&n.expression.expression?.getText(ast)==='useEffect'&&n.getText(ast).includes('const refreshUnreadMessages'));
  let interval;const requests=[],updates=[];
  const cleanup=new Function('authenticated','online','userId','api','setUnreadMessages','window',compile('const effect='+effect.expression.arguments[0].getText(ast)+';')+';return effect();')(
    true,true,7,()=>{const pending=deferred();requests.push(pending);return pending.promise;},value=>updates.push(value),{setInterval(fn){interval=fn;return 1;},clearInterval(){interval=null;}});
  interval();interval();assert.equal(requests.length,1);
  requests[0].resolve({rows:[{unread_count:2}]});await new Promise(resolve=>setImmediate(resolve));
  interval();assert.equal(requests.length,2);cleanup();
  requests[1].resolve({rows:[{unread_count:99}]});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(updates,[2]);assert.equal(interval,null);
});

test('switching chat conversations ignores the previous cancelled response rather than showing the wrong messages',async()=>{
  const chat=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='CommunicationScreen');
  const requests=[],messages=[];
  const load=local('loadMessages',{
    online:true,api:()=>{const pending=deferred();requests.push(pending);return pending.promise;},
    setMessages:value=>messages.push(value),setConversations:()=>{},setLoading:()=>{},setError:()=>{},
    window:{setTimeout(){}},document:{querySelector(){return null;}},
  },chat);
  const first=new AbortController(),second=new AbortController();
  const old=load({id:'old'},false,first.signal);first.abort();
  const current=load({id:'new'},false,second.signal);
  requests[1].resolve({rows:['new message']});await current;
  requests[0].resolve({rows:['old message']});await old;
  assert.deepEqual(messages,[['new message']]);
});
