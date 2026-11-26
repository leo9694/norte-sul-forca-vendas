import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import * as model from '../app/goals-central-model.ts';
import * as registration from '../app/goals-registration.ts';
import {activeSellers,goalProgress,validGoalMonth,parseGoalAmount} from '../app/goals-model.ts';
import {unzipSync,strFromU8} from 'fflate';
export async function loadModule(file,modules={}){const source=await readFile(new URL(file,import.meta.url),'utf8'),js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports={};new Function('require','exports',js)(name=>{if(!(name in modules))throw Error('Unmocked '+name);return modules[name];},exports);return exports;}
const session={userId:7,user:'Gestor',sellerId:4},settings={...model.defaultGoalSettings};
const sellers=[{id:4,name:'Vendedor 4',active:true,region:'MT',supervisorId:19,company:1},{id:8,name:'Vendedor 8',active:true,region:'PR',supervisorId:20,company:6}];
const catalog={sellers,companies:[{id:1,name:'Empresa 1'},{id:6,name:'Empresa 6'}],brands:['Feltrin','Forth'],groups:[{id:100,name:'Sementes'},{id:200,name:'Jardim'}]};
const campaign=(overrides={})=>({id:'goal-1',description:'Novembro',type:'general',companies:[1],start:'2026-11-01',end:'2026-11-30',brand:'',group:0,status:'active',notes:'',version:0,assignments:[{sellerId:4,targetCents:100000}],createdBy:0,createdName:'',createdAt:0,updatedAt:0,...overrides});
function api({manager=true,configure=true,expired=false,scoped=[4],directory=sellers,existing=[],conflict=false}={}){
  const writes=[],queries=[],access={canViewAll:manager,canManage:manager,canConfigure:configure,sellerIds:scoped,companies:[1,6],sellers:directory.filter(s=>scoped.includes(s.id))};
  return loadModule('../app/api/goals/central/route.ts',{
    '../../_lib/sankhya':{requireSession:async()=>{if(expired)throw Error('AUTH_REQUIRED');return session;}},
    '../../_lib/goals-central':{goalAccess:async()=>access,goalCatalog:async()=>({...catalog,sellers:access.sellers}),loadGoalFacts:async(_s,a,_cfg,start,end)=>{queries.push([a,start,end]);return {facts:[{sellerId:4,actual:750}],updatedAt:1};},invalidateGoalFacts(){}},
    '../../../goals-central-model':model,
    '../../../goals-registration':registration,
    '../../../../db/goals':{readGoalSettings:()=>settings,listGoalSets:()=>existing,saveGoalSets:(...args)=>{if(conflict)throw Error('GOAL_CONFLICT');writes.push(args);},saveGoalSettings:(...args)=>writes.push(args),goalAudit:ids=>ids.map(id=>({set_id:id}))},
  }).then(handlers=>({...handlers,writes,queries,access}));
}
const post=body=>new Request('http://local/api/goals/central',{method:'POST',body:JSON.stringify(body)}),get=query=>new Request('http://local/api/goals/central'+(query?'?'+query:''));
test('calendar, pacing, thresholds, zero/no target, projection, growth and holidays',()=>{
  const m=model.goalMetrics(400,100,1000,'2026-11-02','2026-11-13',settings,'2026-11-06',200);
  assert.equal(m.total,10);assert.equal(m.elapsed,5);assert.equal(m.daysRemaining,5);assert.equal(m.remaining,600);assert.equal(m.dailyNeeded,120);assert.equal(m.projection,800);assert.equal(m.potential,500);assert.equal(m.growth,100);assert.equal(m.performance,'attention');
  assert.equal(model.goalMetrics(450,0,1000,'2026-11-02','2026-11-13',settings,'2026-11-06').performance,'on-track');
  assert.equal(model.goalMetrics(349,0,1000,'2026-11-02','2026-11-13',settings,'2026-11-06').performance,'critical');
  assert.equal(model.goalMetrics(0,0,0,'2026-11-02','2026-11-13',settings,'2026-12-01').performance,'achieved');
  assert.equal(model.goalMetrics(0,0,null,'2026-11-02','2026-11-13',settings,'2026-12-01').performance,'no-goal');
  assert.equal(model.goalMetrics(0,0,100,'2026-11-02','2026-11-13',settings,'2026-12-01').dailyNeeded,null);
  assert.equal(model.businessCalendar('2026-11-02','2026-11-13','2026-11-06',['2026-11-02']).total,9);
  assert.equal(model.goalMetrics(0,0,100,'2026-11-02','2026-11-13',settings,'2026-10-01',0).projection,0);
  assert.equal(model.validGoalDate('2026-02-30'),false);assert.equal(model.validGoalDate('2026-11-25'),true);
});
test('categories are independent; consolidated revenue and target do not add overlapping goals',()=>{
  const facts=[{date:'2026-11-04',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:500,wallet:50},{date:'2026-11-05',sellerId:4,company:1,brand:'Forth',group:200,state:'MT',actual:200,wallet:0}];
  const campaigns=[campaign(),campaign({id:'brand',type:'brand',brand:'Feltrin'}),campaign({id:'group',type:'group',group:100}),campaign({id:'both',type:'combined',brand:'Feltrin',group:100})];
  const data={catalog,settings,campaigns};
  let s=model.summarizeGoals(data,facts,model.emptyGoalFilters,'2026-11-01','2026-11-30','2026-11-10');assert.equal(s.totals.target,1000);assert.equal(s.totals.actual,700);
  s=model.summarizeGoals(data,facts,{...model.emptyGoalFilters,type:'combined'},'2026-11-01','2026-11-30','2026-11-10');assert.equal(s.totals.target,1000);assert.equal(s.totals.actual,500);
  s=model.summarizeGoals(data,facts,{...model.emptyGoalFilters,brand:'Feltrin'},'2026-11-01','2026-11-30');assert.equal(s.totals.actual,500);assert.equal(s.totals.target,1000);
  s=model.summarizeGoals(data,facts,{...model.emptyGoalFilters,company:'6'},'2026-11-01','2026-11-30');assert.equal(s.totals.actual,0);assert.equal(s.totals.target,null);
  assert.equal(model.campaignFacts(facts[1],campaigns[3]),false);
});
test('partial periods do not invent a prorated target and comparisons respect elapsed days',()=>{
  const facts=[{date:'2026-11-05',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:100,wallet:0},{date:'2026-10-05',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:50,wallet:0},{date:'2026-10-28',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:1000,wallet:0}];
  const data={catalog,settings,campaigns:[campaign()]};
  assert.equal(model.summarizeGoals(data,facts,model.emptyGoalFilters,'2026-11-01','2026-11-30','2026-11-10').rows[0].growth,100);
  assert.equal(model.summarizeGoals(data,facts,model.emptyGoalFilters,'2026-11-05','2026-11-30','2026-11-10').totals.target,null);
  assert.deepEqual(model.previousGoalPeriod('2026-11-05','2026-11-10','2026-11-08'),{start:'2026-10-30',end:'2026-11-02'});
  assert.deepEqual(model.previousGoalPeriod('2026-11-01','2026-11-30','2026-12-01'),{start:'2026-10-01',end:'2026-10-31'});
  assert.equal(model.goalMetrics(-50,0,1000,'2026-11-01','2026-11-30',settings,'2026-11-10').percent,-5);
  assert.equal(model.summarizeGoals({...data,campaigns:[campaign({companies:[1,6,8]})]},facts,{...model.emptyGoalFilters,company:'1'},'2026-11-01','2026-11-30').totals.target,null);
  assert.equal(model.summarizeGoals(data,facts,{...model.emptyGoalFilters,state:'MT'},'2026-11-01','2026-11-30').totals.target,null);
  assert.equal(model.summarizeGoals({...data,campaigns:[campaign({start:'2026-11-05',end:'2026-11-10'})]},facts,model.emptyGoalFilters,'2026-11-05','2026-11-10','2026-11-08').totals.target,1000);
});
test('seller selectors exclude inactive and unknown; localized money and pasted blocks',()=>{
  assert.deepEqual(activeSellers([{CODVEND:4,ATIVO:'S'},{CODVEND:8,ATIVO:'N'},{CODVEND:9},{CODVEND:0,ATIVO:'S'}]).map(s=>s.CODVEND),[4]);
  assert.deepEqual(goalProgress(750,100000),{percent:75,remaining:250});assert.equal(validGoalMonth('2026-13'),false);
  for(const [input,value] of [['1.234,56',123456],['100.50',10050],['1.234',123400],['0',null],['abc',null]])assert.equal(parseGoalAmount(input),value);
  assert.deepEqual(model.parseMatrixPaste('100\t200\r\n0\t300'),[['100','200'],['0','300']]);
});
test('backend scopes sellers, analytics and shared goals; seller cannot view drafts or management',async()=>{
  const h=await api({manager:false,existing:[campaign({assignments:[{sellerId:4,targetCents:100},{sellerId:8,targetCents:200}]}),campaign({id:'secret',assignments:[{sellerId:8,targetCents:100}]}),campaign({id:'draft',status:'draft'})]});
  const body=await(await h.GET(get('seller=8'))).json();assert.equal(body.canManage,false);assert.deepEqual(body.catalog.sellers.map(s=>s.id),[4]);assert.equal(body.campaigns.length,1);assert.deepEqual(body.campaigns[0].assignments,[{sellerId:4,targetCents:100}]);assert.equal(body.campaigns[0].editable,false);
  assert.equal((await h.GET(get('action=analytics&start=2026-01-01&end=2026-11-30&seller=8'))).status,403);assert.equal(h.queries.length,0);
  await h.GET(get('action=analytics&start=2026-01-01&end=2026-11-30&seller=4'));assert.deepEqual(h.queries[0][0].sellerIds,[4]);
  assert.equal((await h.POST(post({changes:[campaign()]}))).status,403);assert.equal((await h.GET(get('action=audit'))).status,403);
});
test('batch create/edit preserves actor, zero target, statuses and catalog dimensions',async()=>{
  const h=await api(),changes=[campaign(),campaign({id:'combined',type:'combined',brand:'Feltrin',group:100,assignments:[{sellerId:4,targetCents:0}]})];
  assert.equal((await h.POST(post({changes}))).status,200);assert.equal(h.writes[0][0].length,2);assert.equal(h.writes[0][0][1].assignments[0].targetCents,0);assert.equal(h.writes[0][1],7);assert.equal(h.writes[0][2],'Gestor');
});

test('analytics validates company and supervisor scopes before narrowing the ERP query',async()=>{
  const h=await api({scoped:[4,8,19],directory:[...sellers,{id:19,name:'Supervisor',active:true,supervisorId:0}]});
  assert.equal((await h.GET(get('action=analytics&start=2026-11-01&end=2026-11-30&company=6&seller=8'))).status,200);
  assert.deepEqual(h.queries[0][0].companies,[6]);assert.deepEqual(h.queries[0][0].sellerIds,[8]);
  for(const params of ['company=99','supervisor=99','seller=99'])assert.equal((await h.GET(get('action=analytics&start=2026-11-01&end=2026-11-30&'+params))).status,403);
  assert.equal((await h.GET(get('action=analytics&start=2026-11-01&end=2026-11-30&company=bad'))).status,400);
  assert.equal(h.queries.length,1);
  assert.equal((await h.GET(get('action=analytics&start=2026-11-01&end=2026-11-30&supervisor=19'))).status,200);assert.deepEqual(h.queries[1][0].sellerIds,[4]);
});
test('percentage goals are validated on the API, cannot drift from the general goal, and cannot bypass closure',async()=>{
  const parent=campaign(),child=campaign({id:'percentage',type:'brand',brand:'Feltrin',assignments:[{sellerId:4,targetCents:50000}],allocation:{parentId:parent.id,basisPoints:5000}});
  const valid=await api();assert.equal((await valid.POST(post({changes:[parent,child]}))).status,200);assert.equal(valid.writes[0][0][1].allocation.basisPoints,5000);
  for(const change of [{...child,assignments:[{sellerId:4,targetCents:50001}]},{...child,allocation:{parentId:'missing',basisPoints:5000}},{...child,allocation:{parentId:parent.id,basisPoints:10001}}]){const h=await api();assert.equal((await h.POST(post({changes:[parent,change]}))).status,400);assert.equal(h.writes.length,0);}
  const closed=await api({existing:[{...parent,status:'closed',version:1}]});assert.equal((await closed.POST(post({changes:[child]}))).status,409);assert.equal(closed.writes.length,0);
});
test('forged actors, out-of-team writes, invalid catalogs/values and shared-set edits are rejected',async()=>{
  for(const [change,status] of [[{assignments:[{sellerId:8,targetCents:100}]},403],[{companies:[8]},403],[{type:'combined',brand:'Inventada',group:100},400],[{type:'group',group:999},400],[{assignments:[{sellerId:4,targetCents:-1}]},400],[{start:'2026-02-30'},400],[{version:-1},400]]){
    const h=await api();assert.equal((await h.POST(post({changes:[campaign(change)]}))).status,status);assert.equal(h.writes.length,0);
  }
  const h=await api({existing:[campaign({version:1,assignments:[{sellerId:4,targetCents:100},{sellerId:8,targetCents:100}]})]});assert.equal((await h.POST(post({changes:[campaign({version:1})]}))).status,403);
  assert.equal((await(await api({expired:true})).GET(get())).status,401);
  assert.equal((await(await api({conflict:true})).POST(post({changes:[campaign()]}))).status,409);
});
test('configuration requires broad permission and validates thresholds, company scopes and dates',async()=>{
  const h=await api({configure:false});assert.equal((await h.POST(post({action:'settings',settings}))).status,403);
  for(const override of [{onTrack:70,attention:90},{holidays:['bad']},{companies:[]},{userCompanies:{7:[99]}}])assert.equal((await(await api()).POST(post({action:'settings',settings:{...settings,...override}}))).status,400);
  assert.equal((await(await api()).POST(post({action:'settings',settings}))).status,200);
});
test('supervisor scope is hierarchical and edit grant is explicit, never the session boolean',async()=>{
  for(const [role,type,canViewAll,canManage,broad] of [['Vendas','V',false,false,false],['Supervisor','V',true,false,false],['Diretoria','V',true,true,true],['Gerente','V',true,true,true],['Vendas','S',true,false,false]]){
    const sql=[];const lib=await loadModule('../app/api/_lib/goals-central.ts',{'./sankhya':{executeQuery:async(_s,q)=>{sql.push(q);return q.includes('NOMEGRUPO')?[{NOMEGRUPO:role,TIPVEND:type}]:[{CODVEND:4,APELIDO:'Vendedor',ATIVO:'S',CODGER:19}];}},'./goals-query':{}});
    const access=await lib.goalAccess({...session,canAnalyzeSellers:true},settings);assert.equal(access.canViewAll,canViewAll);assert.equal(access.canManage,canManage);
    if(canViewAll&&!broad)assert.match(sql[1],/CONNECT BY NOCYCLE PRIOR CODVEND=CODGER/);if(!canViewAll)assert.match(sql[1],/SELECT 4 FROM DUAL/);
    if(canViewAll&&!broad){const grant=await lib.goalAccess(session,{...settings,supervisorEditors:[7],userCompanies:{7:[6]}});assert.equal(grant.canManage,true);assert.deepEqual(grant.companies,[6]);}
  }
});
test('SQL counts invoices once, applies signed linked returns and only remaining wallet quantities',async()=>{
  const lib=await loadModule('../app/api/_lib/goals-central.ts',{'./sankhya':{},'./goals-query':{}}),scope={sellerIds:[4],companies:[1,6,8]},sql=lib.goalFactsSql('2026-11-01','2026-11-30',scope,settings),wallet=lib.goalFactsSql('2026-11-01','2026-11-30',scope,settings,true);
  assert.match(sql,/C.STATUSNOTA='L'/);assert.match(sql,/IN \('A','M','T'\)/);assert.match(sql,/C.CODVEND IN \(4\)/);assert.match(sql,/C.CODTIPOPER IN \(35\)/);assert.match(sql,/C.TIPMOV='D'/);assert.match(sql,/EXISTS \(SELECT 1 FROM TGFVAR/);assert.match(sql,/RV.SEQUENCIA=I.SEQUENCIA/);assert.match(sql,/THEN -1 ELSE 1/);assert.doesNotMatch(sql,/JOIN TGFVAR RV ON/);
  assert.match(wallet,/C.CODTIPOPER IN \(5\)/);assert.match(wallet,/GREATEST\(0,I.QTDNEG-/);assert.match(wallet,/GREATEST\(NVL\(I.QTDENTREGUE/);assert.match(wallet,/D.SEQUENCIAORIG=I.SEQUENCIA/);assert.match(wallet,/I.PENDENTE='S'/);assert.match(sql,/ORDER BY GOAL_DATE/);
});
test('facts cache is single flight, scoped by user and refreshable; failures are not cached',async()=>{
  let count=0;const lib=await loadModule('../app/api/_lib/goals-central.ts',{'./sankhya':{executeQuery:async()=>[]},'./goals-query':{readGoalQueryRows:async()=>{count++;await new Promise(r=>setImmediate(r));return [{GOAL_DATE:'2026-11-04',CODVEND:4,CODEMP:1,MARCA:'Feltrin',CODGRUPOPROD:100,UF:'MT',ACTUAL:100}];}}});
  const scope={sellerIds:[4],companies:[1]};await Promise.all([lib.loadGoalFacts(session,scope,settings,'2026-11-01','2026-11-30'),lib.loadGoalFacts(session,scope,settings,'2026-11-01','2026-11-30',true)]);assert.equal(count,2);
  await lib.loadGoalFacts({...session,userId:8},scope,settings,'2026-11-01','2026-11-30');assert.equal(count,4);await lib.loadGoalFacts(session,scope,settings,'2026-11-01','2026-11-30',true);assert.equal(count,6);
  assert.deepEqual((await lib.loadGoalFacts(session,{sellerIds:[],companies:[1]},settings,'2026-11-01','2026-11-30')).facts,[]);assert.equal(count,6);
  lib.invalidateGoalFacts();await lib.loadGoalFacts(session,scope,settings,'2026-11-01','2026-11-30');assert.equal(count,8);
});

test('management sales history runs one monthly revenue query and never shares the detailed wallet cache',async()=>{
  const sql=[];
  const lib=await loadModule('../app/api/_lib/goals-central.ts',{'./sankhya':{},'./goals-query':{readGoalQueryRows:async(_query,text)=>{sql.push(text);return [];}}});
  const scope={sellerIds:[4],companies:[1]};
  await lib.loadGoalFacts(session,scope,settings,'2026-10-01','2026-10-31',false,true);
  assert.equal(sql.length,1);assert.match(sql[0],/'YYYY-MM'\)\|\|'-01'/);assert.doesNotMatch(sql[0],/DELIVERIES|SUM\([^\n]+ WALLET/);
  await lib.loadGoalFacts(session,scope,settings,'2026-10-01','2026-10-31');
  assert.equal(sql.length,3);assert.match(sql[2],/DELIVERIES/);
});

test('catalog labels are reused without reusing the seller directory or bypassing write validation',async()=>{
  let calls=0;
  const lib=await loadModule('../app/api/_lib/goals-central.ts',{'./sankhya':{executeQuery:async()=>{calls++;return [];}},'./goals-query':{}});
  const first={companies:[1],sellers:[{id:4}]},second={companies:[1],sellers:[{id:8}]};
  await lib.goalCatalog(session,first,true);
  assert.deepEqual((await lib.goalCatalog(session,second,true)).sellers,second.sellers);assert.equal(calls,3);
  await lib.goalCatalog(session,second);assert.equal(calls,6);
  await lib.goalCatalog(session,second,true,true);assert.equal(calls,9);
  await lib.goalCatalog({...session,userId:99},second,true);assert.equal(calls,12);
});

test('failed goal queries are retried rather than cached as empty financial metrics',async()=>{
  let fail=true,count=0;const lib=await loadModule('../app/api/_lib/goals-central.ts',{'./sankhya':{},'./goals-query':{readGoalQueryRows:async()=>{count++;if(fail)throw Error('offline');return [];}}}),scope={sellerIds:[4],companies:[1]};
  await assert.rejects(lib.loadGoalFacts(session,scope,settings,'2026-11-01','2026-11-30'),/offline/);fail=false;assert.deepEqual((await lib.loadGoalFacts(session,scope,settings,'2026-11-01','2026-11-30')).facts,[]);assert.equal(count,4);
});
test('SQLite migration is non-destructive, batch is atomic, overlap/concurrency/closure preserve audit',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'fv-goals-central-'));process.env.MONTHLY_GOALS_DATABASE_PATH=path.join(dir,'goals.sqlite');const store=await import('../db/goals.ts');
  store.saveMonthlyGoal('2026-11',4,100000,'Legado',0,7);const migrated=store.listGoalSets();assert.equal(migrated.length,1);assert.equal(migrated[0].assignments[0].targetCents,100000);assert.equal(store.listMonthlyGoals('2026-11').length,1);
  assert.throws(()=>store.saveGoalSets([campaign()],7,'Gestor'),/GOAL_OVERLAP/);
  store.saveGoalSets([campaign({id:'brand',type:'brand',brand:'Feltrin'}),campaign({id:'group',type:'group',group:100})],7,'Gestor');assert.equal(store.listGoalSets().length,3);
  const brand=store.listGoalSets().find(c=>c.id==='brand');assert.throws(()=>store.saveGoalSets([{...brand,version:0}],7,'Gestor'),/GOAL_CONFLICT/);
  assert.throws(()=>store.saveGoalSets([campaign({id:'new',type:'combined',brand:'Feltrin',group:100}),{...brand,version:0}],7,'Gestor'),/GOAL_CONFLICT/);assert.equal(store.listGoalSets().some(c=>c.id==='new'),false);
  store.saveGoalSets([{...brand,status:'closed'}],7,'Gestor');assert.throws(()=>store.saveGoalSets([{...brand,version:2,description:'Alterar encerrada'}],7,'Gestor'),/GOAL_CLOSED/);
  const group=store.listGoalSets().find(c=>c.id==='group');store.saveGoalSets([{...group,status:'cancelled'}],7,'Gestor');store.saveGoalSets([campaign({id:'new-group',type:'group',group:100,assignments:[{sellerId:4,targetCents:0}]})],7,'Gestor');
  assert.equal(store.goalAudit(['brand']).length,2);assert.equal(JSON.parse(store.goalAudit(['brand'])[0].next).status,'closed');
  store.saveGoalSettings({...settings,onTrack:95},7,'Gestor');assert.equal(store.readGoalSettings().version,1);assert.throws(()=>store.saveGoalSettings(settings,7,'Gestor'),/GOAL_CONFLICT/);
  const db=new DatabaseSync(process.env.MONTHLY_GOALS_DATABASE_PATH);assert.equal(db.prepare('SELECT COUNT(*) N FROM monthly_goal_history').get().N,1);db.close();
});
test('Excel export is a real XLSX and keeps formula-like labels inert',async()=>{
  const lib=await loadModule('../app/goals-export.ts',{'fflate':await import('fflate')}),files=unzipSync(lib.goalsWorkbook([['CODVEND','Vendedor','Meta'],[4,'=1+1',1234.56],[8,'Nome & texto',0]])),sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.ok(files['[Content_Types].xml']);assert.match(sheet,/t="inlineStr"/);assert.match(sheet,/<t xml:space="preserve">=1\+1<\/t>/);assert.doesNotMatch(sheet,/<f>/);assert.match(sheet,/<v>1234.56<\/v>/);assert.match(sheet,/Nome &amp; texto/);
});
