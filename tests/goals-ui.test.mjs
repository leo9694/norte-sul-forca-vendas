import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as model from '../app/goals-central-model.ts';
import * as legacy from '../app/goals-model.ts';
import * as registration from '../app/goals-registration.ts';
async function load(file,modules){const code=ts.transpileModule(await readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports={};new Function('require','exports',code)(name=>{if(name==='./goals-charts'&&!(name in modules))return sharedGoalCharts;if(!(name in modules))throw Error(name);return modules[name];},exports);return exports;}
const sharedGoalCharts=await load('../app/goals-charts.tsx',{'react':React,'react/jsx-runtime':jsx,'./goals-central-model':model});
const icon=()=>React.createElement('svg');const icons=new Proxy({},{get:()=>icon});
const campaign={id:'goal-1',description:'Vendas novembro',type:'general',companies:[1],start:'2026-11-01',end:'2026-11-30',brand:'',group:0,status:'active',notes:'',version:1,assignments:[{sellerId:4,targetCents:100000}],createdBy:7,createdName:'Gestor',createdAt:1,updatedAt:1,editable:true};
const data={canViewAll:true,canManage:true,canConfigure:true,ownSellerId:4,settings:{...model.defaultGoalSettings},campaigns:[campaign],catalog:{sellers:[{id:4,name:'Vendedor 4',active:true,region:'MT',supervisorId:19,company:1},{id:8,name:'Inativo',active:false,region:'PR',supervisorId:20,company:6}],companies:[{id:1,name:'Empresa 1'}],brands:['Feltrin'],groups:[{id:100,name:'Sementes'}]}};
function hooks(){const state=[],effects=[],cleanups=[];let index=0;return {reset(){index=0;},run(){while(effects.length)effects.shift()();},react:{...React,useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useMemo(fn,deps){const i=index++;if(!state[i]||deps.some((v,j)=>v!==state[i].deps[j]))state[i]={value:fn(),deps};return state[i].value;},useCallback(fn,deps){const i=index++;if(!state[i]||deps.some((v,j)=>v!==state[i].deps[j]))state[i]={fn,deps};return state[i].fn;},useRef(initial){const i=index++;if(!(i in state))state[i]={current:initial};return state[i];},useEffect(fn,deps){const i=index++;if(!state[i]||deps.some((v,j)=>v!==state[i][j])){state[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}}};}
const find=(node,predicate)=>{if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const r=find(child,predicate);if(r)return r;}};
const text=node=>React.Children.toArray(node.props?.children).filter(c=>typeof c==='string').join('');
const tick=()=>new Promise(r=>setImmediate(r));

test('first load is limited to current and previous periods; long history and exports wait on demand without hiding metrics',async()=>{
  const h=hooks(),oldFetch=globalThis.fetch,Chart=()=>null,calls=[],exports=[];let finish;
  const fact=(date,actual)=>({date,sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual,wallet:0}),core=[fact('2026-11-04',500),fact('2026-10-04',250)];
  globalThis.fetch=async url=>{calls.push(String(url));if(!String(url).includes('analytics'))return Response.json(data);if(String(url).includes('start=2026-10-01'))return Response.json({facts:core,updatedAt:1});return new Promise(resolve=>{finish=()=>resolve(Response.json({facts:[...core,fact('2025-11-04',100)],updatedAt:2}));});};
  try{
    const {GoalsScreen}=await load('../app/goals-central-screen.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-model':{...legacy,currentGoalMonth:()=> '2026-11'},'./goals-central-model':model,'./goals-export':{downloadGoalsExcel:rows=>exports.push(rows)},'./goals-management':{GoalManagement:()=>null},'./goals-charts':{GoalCharts:Chart,buildGoalReport:sharedGoalCharts.buildGoalReport}});
    const render=()=>{h.reset();const tree=GoalsScreen({online:true,onNotice(){}});h.run();return tree;};
    render();await tick();render();await tick();let tree=render();assert.equal(calls.length,2);
    let chart=find(tree,n=>n.type===Chart);assert.equal(chart.props.historyReady,false);assert.equal(chart.props.summary.totals.actual,500);assert.equal(chart.props.allowDrilldown,false);
    const url=new URL(calls[1],'http://test');assert.equal(url.searchParams.get('start'),'2026-10-01');assert.equal(url.searchParams.get('end'),'2026-11-30');
    chart.props.onHistoryNeeded();tree=render();assert.equal(calls.length,3);assert.equal(find(tree,n=>n.type===Chart).props.summary.totals.actual,500);
    find(find(tree,n=>n.type==='label'&&text(n)==='Agrupar por'),n=>n.type==='select').props.onChange({target:{value:'year'}});tree=render();
    let excel=find(tree,n=>n.type==='button'&&text(n).trim()==='Excel');assert.equal(excel.props.disabled,true);await excel.props.onClick();assert.equal(exports.length,0);
    finish();await tick();tree=render();chart=find(tree,n=>n.type===Chart);
    assert.equal(chart.props.historyReady,true);assert.equal(chart.props.summary.filteredFacts.length,3,'historical overlap is deduplicated');assert.equal(chart.props.summary.totals.actual,500);assert.equal(calls.length,3);
    excel=find(tree,n=>n.type==='button'&&text(n).trim()==='Excel');assert.equal(excel.props.disabled,false);await excel.props.onClick();assert.equal(exports.length,1);
  }finally{globalThis.fetch=oldFetch;}
});

test('historical failures keep current metrics available and manual refresh does not permanently bypass the cache',async()=>{
  const h=hooks(),oldFetch=globalThis.fetch,Chart=()=>null,Management=()=>null,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push(String(url));if(init?.method==='POST')return Response.json({ok:true});if(!String(url).includes('analytics'))return Response.json(data);if(!String(url).includes('start=2026-10-01'))return Response.json({error:'Histórico indisponível'},{status:503});return Response.json({facts:[],updatedAt:1});};
  try{
    const {GoalsScreen}=await load('../app/goals-central-screen.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-model':{...legacy,currentGoalMonth:()=> '2026-11'},'./goals-central-model':model,'./goals-export':{},'./goals-management':{GoalManagement:Management},'./goals-charts':{GoalCharts:Chart}});
    const render=()=>{h.reset();const tree=GoalsScreen({online:true,onNotice(){}});h.run();return tree;};
    const settle=async()=>{render();await tick();render();await tick();return render();};
    let tree=await settle();find(tree,n=>n.type===Chart).props.onHistoryNeeded();tree=await settle();
    assert.equal(find(tree,n=>n.type===Chart).props.historyError,'Histórico indisponível');assert.equal(find(tree,n=>n.props.role==='alert'),undefined);
    find(tree,n=>n.type==='button'&&text(n).trim()==='Atualizar').props.onClick();tree=await settle();assert.ok(calls.some(url=>url.includes('refresh=1')));
    await find(tree,n=>n.type===Management).props.onSave([]);await settle();
    assert.ok(!calls.at(-1).includes('refresh=1'),'saving goals reuses cached ERP figures instead of forcing another scan');
  }finally{globalThis.fetch=oldFetch;}
});
test('seller lands directly in Minhas metas and management/other seller selectors are absent',async()=>{
  const h=hooks(),oldFetch=globalThis.fetch;globalThis.fetch=async url=>Response.json(String(url).includes('analytics')?{facts:[],updatedAt:1}:{...data,canViewAll:false,canManage:false,canConfigure:false,catalog:{...data.catalog,sellers:[data.catalog.sellers[0]]}});
  try{const {GoalsScreen}=await load('../app/goals-central-screen.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-model':legacy,'./goals-central-model':model,'./goals-export':{},'./goals-management':{GoalManagement:()=>null},'./goals-charts':{GoalCharts:()=>null}});
    const render=()=>{h.reset();const tree=GoalsScreen({online:true,onNotice(){}});h.run();return tree;};render();await tick();render();await tick();const tree=render(),html=renderToStaticMarkup(tree);
    assert.match(html,/Minhas metas/);assert.doesNotMatch(html,/Acompanhamento geral|Gestão de metas|Configurar apuração|Inativo/);assert.ok(!find(tree,n=>n.type==='label'&&text(n)==='Vendedor'));
  }finally{globalThis.fetch=oldFetch;}
});
test('management has exactly three internal tabs and keeps management mounted between tabs',async()=>{
  const h=hooks(),oldFetch=globalThis.fetch;globalThis.fetch=async url=>Response.json(String(url).includes('analytics')?{facts:[],updatedAt:1}:data);
  try{const {GoalsScreen}=await load('../app/goals-central-screen.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-model':legacy,'./goals-central-model':model,'./goals-export':{},'./goals-management':{GoalManagement:()=>React.createElement('div',null,'Matriz de metas')},'./goals-charts':{GoalCharts:()=>null}});
    const render=()=>{h.reset();const tree=GoalsScreen({online:true,onNotice(){}});h.run();return tree;};render();await tick();let tree=render();await tick();tree=render();const nav=find(tree,n=>n.type==='nav');assert.equal(React.Children.toArray(nav.props.children).length,3);
    find(tree,n=>n.type==='button'&&text(n)==='Gestão de metas').props.onClick();tree=render();assert.equal(find(tree,n=>n.type==='div'&&'hidden' in n.props).props.hidden,false);
    find(tree,n=>n.type==='button'&&text(n)==='Metas por vendedor').props.onClick();tree=render();assert.equal(find(tree,n=>n.type==='div'&&'hidden' in n.props).props.hidden,true);
  }finally{globalThis.fetch=oldFetch;}
});
test('scoped tabs reuse complete authorized results and do not inherit filters or flash other values',async()=>{
  const h=hooks(),oldFetch=globalThis.fetch,Chart=()=>null,calls=[];
  const payload={...data,catalog:{...data.catalog,brands:['Feltrin','Forth'],companies:[{id:1,name:'Empresa 1'},{id:6,name:'Empresa 6'}],sellers:[data.catalog.sellers[0],{id:5,name:'Vendedor 5',active:true,region:'PR',supervisorId:20,company:6}]}};
  const facts=[{date:'2026-11-04',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:500,wallet:50},{date:'2026-11-04',sellerId:5,company:6,brand:'Forth',group:200,state:'PR',actual:2000,wallet:100}];
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json(String(url).includes('analytics')?{facts,updatedAt:1}:payload);};
  try{
    const {GoalsScreen}=await load('../app/goals-central-screen.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-model':legacy,'./goals-central-model':model,'./goals-export':{},'./goals-management':{GoalManagement:()=>null},'./goals-charts':{GoalCharts:Chart}});
    const render=()=>{h.reset();const tree=GoalsScreen({online:true,onNotice(){}});h.run();return tree;};
    const select=(tree,label)=>find(find(tree,n=>n.type==='label'&&text(n)===label),n=>n.type==='select');
    render();await tick();render();await tick();let tree=render();
    assert.equal(find(tree,n=>n.type===Chart).props.summary.totals.actual,2500);
    const generalControls=find(tree,n=>n.props.className==='goals-filters');
    const generalHtml=renderToStaticMarkup(generalControls);assert.match(generalHtml,/<label>Empresa/);assert.match(generalHtml,/<label>Supervisor/);assert.equal((generalHtml.match(/<select/g)||[]).length,2);
    for(const [label,value] of [['Empresa','6'],['Supervisor','20']]){select(tree,label).props.onChange({target:{value}});tree=render();await tick();tree=render();}
    assert.equal(find(tree,n=>n.type===Chart).props.summary.totals.actual,2000);
    assert.equal(calls.length,2,'company and supervisor can be filtered from a complete cached result');
    find(tree,n=>n.type==='button'&&text(n)==='Metas por vendedor').props.onClick();tree=render();await tick();tree=render();
    const controls=find(tree,n=>n.props.className==='goals-filters goals-seller-filters');
    assert.deepEqual(React.Children.toArray(controls.props.children).map(text),['Vendedor']);
    assert.ok(find(tree,n=>n.props['aria-label']==='Mês das metas'));
    const chart=find(tree,n=>n.type===Chart);assert.deepEqual(chart.props.summary.filters,{...model.emptyGoalFilters,seller:'4'});
    assert.equal(chart.props.summary.totals.actual,500);assert.equal(chart.props.summary.totals.target,1000);assert.equal(chart.props.summary.totals.wallet,50);
    select(tree,'Vendedor').props.onChange({target:{value:'5'}});tree=render();await tick();tree=render();assert.equal(find(tree,n=>n.type===Chart).props.summary.totals.actual,2000);
    assert.equal(calls.filter(url=>!url.includes('analytics')).length,1,'switching scopes does not reload metadata');
    assert.equal(calls.length,2,'both sellers use the complete cached result');
    find(tree,n=>n.type==='button'&&text(n)==='Acompanhamento geral').props.onClick();tree=render();
    assert.equal(select(tree,'Empresa').props.value,'6');assert.equal(select(tree,'Supervisor').props.value,'20');assert.equal(select(tree,'Marca'),undefined);
    assert.equal(find(tree,n=>n.type===Chart).props.summary.totals.actual,2000);
  }finally{globalThis.fetch=oldFetch;}
});

test('cold tabs wait for their own figures, ignore late responses, and do not query the core in management',async()=>{
  const h=hooks(),oldFetch=globalThis.fetch,Chart=()=>null,Management=()=>null,requests=[];
  globalThis.fetch=async(url,init)=>String(url).includes('analytics')?new Promise(resolve=>requests.push({url,signal:init.signal,resolve})):Response.json(data);
  try{
    const {GoalsScreen}=await load('../app/goals-central-screen.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-model':{...legacy,currentGoalMonth:()=> '2026-11'},'./goals-central-model':model,'./goals-export':{},'./goals-management':{GoalManagement:Management},'./goals-charts':{GoalCharts:Chart}});
    const render=()=>{h.reset();const tree=GoalsScreen({online:true,onNotice(){}});h.run();return tree;};
    const reply=(i,actual)=>requests[i].resolve(Response.json({updatedAt:1,facts:[{date:'2026-11-03',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual,wallet:0}]}));
    render();await tick();let tree=render();
    find(tree,n=>n.type==='button'&&text(n)==='Metas por vendedor').props.onClick();tree=render();
    assert.equal(requests[0].signal.aborted,true);assert.match(requests[1].url,/&seller=4/);
    reply(0,999);await tick();tree=render();assert.equal(find(tree,n=>n.type===Chart),undefined);
    reply(1,250);await tick();tree=render();assert.equal(find(tree,n=>n.type===Chart).props.summary.totals.actual,250);
    find(tree,n=>n.type==='button'&&text(n)==='Gestão de metas').props.onClick();tree=render();
    assert.equal(requests.length,2);assert.equal(find(tree,n=>n.type===Chart),undefined);
    find(tree,n=>n.type===Management).props.onHistoryNeeded();tree=render();assert.match(requests[2].url,/&series=sales/);
    find(tree,n=>n.type==='button'&&text(n)==='Metas por vendedor').props.onClick();tree=render();
    assert.equal(requests.length,3);assert.equal(find(tree,n=>n.type===Chart).props.summary.totals.actual,250);
    reply(2,100);await tick();
  }finally{globalThis.fetch=oldFetch;}
});
test('management lists searchable sellers with only a supervisor filter and opens the selected top period',async()=>{
  const h=hooks(),{GoalManagement,GoalRegistrationPanel}=await load('../app/goals-management.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}});
  const payload={...data,catalog:{...data.catalog,sellers:[...data.catalog.sellers,{id:5,name:'Vendedor 5',active:true,region:'PR',supervisorId:20,company:1}]},campaigns:[campaign,{...campaign,id:'scheduled',status:'scheduled',assignments:[{sellerId:5,targetCents:200000}]}]};
  const period={start:'2026-11-03',end:'2026-11-23'},render=()=>{h.reset();return GoalManagement({data:payload,facts:[],month:'2026-11',period,busy:false,onSave:async()=>true,onError(){}});};let tree=render();
  const html=renderToStaticMarkup(tree);assert.doesNotMatch(html,/Edição em massa|Salvar alterações|Preencher|Reajustar|Referência da sugestão|Empresa do vendedor|<label>Regional|<label>Situação|Inativo/);
  assert.match(html,/goal-seller-list-row registered/);assert.match(html,/goal-seller-list-row scheduled/);
  find(tree,n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'Vendedor 5'}});tree=render();
  assert.ok(!find(tree,n=>n.type==='button'&&n.props.className==='goal-seller-list-row registered'));
  find(tree,n=>n.type==='button'&&n.props.className==='goal-seller-list-row scheduled').props.onClick();tree=render();
  let panel=find(tree,n=>n.type===GoalRegistrationPanel);assert.deepEqual(panel.props.initial.sellerIds,[5]);assert.equal(panel.props.initial.start,'2026-11-01');assert.equal(panel.props.initial.end,'2026-11-30');
  panel.props.onClose();tree=render();find(tree,n=>n.type==='button'&&text(n).trim()==='Nova meta').props.onClick();tree=render();panel=find(tree,n=>n.type===GoalRegistrationPanel);assert.deepEqual(panel.props.initial.sellerIds,[]);
});
test('registered goals are below New goal and above the seller matrix, with scoped edit and copy actions',async()=>{
  const h=hooks(),{GoalManagement,GoalRegistrationPanel}=await load('../app/goals-management.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}});
  let payload={...data,catalog:{...data.catalog,sellers:[data.catalog.sellers[0],{id:5,name:'Vendedor 5',active:true,region:'PR',supervisorId:20,company:1}]},campaigns:[{...campaign,description:'Meta conjunta',assignments:[{sellerId:4,targetCents:100000},{sellerId:5,targetCents:100000}]}]};
  const period={start:'2026-11-03',end:'2026-11-23'},render=()=>{h.reset();return GoalManagement({data:payload,facts:[],month:'2026-11',period,busy:false,onSave:async()=>true,onError(){}});};let tree=render();
  let html=renderToStaticMarkup(tree);assert.ok(html.indexOf('Nova meta')<html.indexOf('Metas cadastradas'));assert.ok(html.indexOf('Metas cadastradas')<html.indexOf('Matriz de metas'));
  const cards=renderToStaticMarkup(find(tree,n=>n.props['aria-label']==='Metas cadastradas'));assert.doesNotMatch(cards,/Vendedor 4|Vendedor 5/);assert.match(cards,/Total de 2 vendedores/);assert.match(cards,/Meta conjunta/);
  find(tree,n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'Inexistente'}});tree=render();assert.ok(find(tree,n=>n.props['aria-label']==='Metas cadastradas'));
  find(tree,n=>n.type==='button'&&text(n).trim()==='Editar').props.onClick();tree=render();let panel=find(tree,n=>n.type===GoalRegistrationPanel);assert.deepEqual(panel.props.initial.sellerIds,[4,5]);assert.equal(panel.props.initial.sourceId,campaign.id);
  panel.props.onClose();tree=render();const duplicate=find(tree,n=>n.type==='button'&&n.props['aria-label']==='Criar para outro vendedor');assert.equal(text(duplicate).trim(),'Duplicar');duplicate.props.onClick();tree=render();panel=find(tree,n=>n.type===GoalRegistrationPanel);assert.deepEqual(panel.props.initial.sellerIds,[]);assert.equal(panel.props.initial.sourceId,undefined);assert.equal(panel.props.initial.start,'2026-11-01');assert.equal(panel.props.initial.end,'2026-11-30');
  panel.props.onClose();payload={...payload,campaigns:[{...payload.campaigns[0],assignments:[{sellerId:4,targetCents:100000},{sellerId:5,targetCents:200000}]}]};tree=render();find(tree,n=>n.type==='button'&&text(n).trim()==='Editar').props.onClick();tree=render();assert.deepEqual(find(tree,n=>n.type===GoalRegistrationPanel).props.initial.sellerIds,[4]);
});

test('panel uses seller checklist, percentage preview, confirmation and immediate single-flight saving',async()=>{
  const h=hooks(),writes=[];let closed=0,finish;
  const {GoalRegistrationPanel}=await load('../app/goals-management.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}});
  const payload={...data,campaigns:[],catalog:{...data.catalog,sellers:[data.catalog.sellers[0],{id:5,name:'Vendedor 5',active:true,region:'MT',supervisorId:19,company:1}]}};
  const initial={description:'Meta novembro',type:'general',companies:[1],start:'2026-11-01',end:'2026-11-30',brand:'',group:0,status:'active',notes:'',amount:'',sellerIds:[4],allocations:[]};
  const render=()=>{h.reset();return GoalRegistrationPanel({data:payload,facts:[],period:{start:initial.start,end:initial.end},initial,eligibleSellerIds:[4,5],busy:false,historyReady:true,historyError:'',saveError:'',onClose(){closed++;},onSave:changes=>{writes.push(changes);return new Promise(r=>{finish=r;});}});};let tree=render();
  assert.doesNotMatch(renderToStaticMarkup(tree),/Cadastradas|Cadastro e metas existentes|goal-registered-list/);
  const input=(label,type='input')=>find(find(tree,n=>n.type==='label'&&text(n)===label),n=>n.type===type);
  input('Valor da meta por vendedor (R$)').props.onChange({target:{value:'10000'}});tree=render();
  assert.equal(input('Valor da meta por vendedor (R$)').props.value,'R$ 10.000');
  input('Valor da meta por vendedor (R$)').props.onBlur();tree=render();
  assert.match(input('Valor da meta por vendedor (R$)').props.value,/^R\$\s10\.000,00$/);
  assert.equal(input('Mês da meta').props.type,'month');
  assert.equal(input('Mês da meta').props.value,'2026-11');
  assert.doesNotMatch(renderToStaticMarkup(tree),/type="date"/);
  input('Mês da meta').props.onChange({target:{value:'2028-02'}});tree=render();
  find(tree,n=>n.type==='button'&&text(n).trim()==='Marca').props.onClick();tree=render();input('Marca','select').props.onChange({target:{value:'Feltrin'}});tree=render();input('Percentual (%)').props.onChange({target:{value:'40'}});tree=render();
  const label=find(tree,n=>n.type==='label'&&find(n,k=>k.type==='span'&&k.props.children==='Vendedor 5'));find(label,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=render();
  input('Situação','select').props.onChange({target:{value:'scheduled'}});tree=render();
  find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=render();assert.equal(writes.length,0);assert.equal(find(tree,n=>n.props.role==='alertdialog').props['aria-label'],'Confirmar cadastro de meta');
  const confirm=find(tree,n=>n.type==='button'&&text(n)==='Confirmar cadastro');confirm.props.onClick();confirm.props.onClick();assert.equal(writes.length,1);assert.equal(writes[0].length,2);assert.equal(writes[0][0].assignments.length,2);assert.equal(writes[0][1].assignments[0].targetCents,400000);assert.equal(writes[0][1].allocation.basisPoints,4000);assert.equal(writes[0][0].status,'scheduled');
  assert.deepEqual(writes[0].map(c=>[c.start,c.end]),[['2028-02-01','2028-02-29'],['2028-02-01','2028-02-29']]);
  finish(true);await tick();assert.equal(closed,1);
});

test('seller joins the existing goal and its allocations; deletion requires confirmation',async()=>{
  const h=hooks(),managementHooks=hooks(),writes=[],deletions=[];
  const modules={'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}};
  const {GoalRegistrationPanel}=await load('../app/goals-management.tsx',{...modules,react:h.react});
  const {GoalManagement}=await load('../app/goals-management.tsx',{...modules,react:managementHooks.react});
  const template={...campaign,id:'template',description:'Meta modelo',assignments:[{sellerId:5,targetCents:400000}]};
  const child={...template,id:'linked-brand',description:'Meta modelo · Feltrin',type:'brand',brand:'Feltrin',allocation:{parentId:template.id,basisPoints:5000},assignments:[{sellerId:5,targetCents:200000}]};
  const cancelled={...campaign,id:'cancelled',description:'Meta excluída',status:'cancelled'};
  const payload={...data,campaigns:[child,{...campaign,companies:[6]},template,cancelled],catalog:{...data.catalog,sellers:[data.catalog.sellers[0],{id:5,name:'Vendedor 5',active:true,supervisorId:19,company:1}]}};
  const period={start:campaign.start,end:campaign.end};
  const renderManagement=()=>{managementHooks.reset();return GoalManagement({data:payload,facts:[],month:'2026-11',period,busy:false,onSave:async changes=>{deletions.push(changes);return true;},onError(){}});};
  const managementTree=renderManagement();
  const list=find(managementTree,n=>n.props['aria-label']==='Metas cadastradas'),html=renderToStaticMarkup(list);
  assert.equal((html.match(/<article/g)||[]).length,2);
  const parentCard=find(list,n=>n.type==='article'&&find(n,k=>k.type==='h3'&&text(k)==='Meta modelo'));
  assert.match(renderToStaticMarkup(parentCard),/Feltrin.*50% da principal/);
  assert.doesNotMatch(html,/Vendedor 4|Vendedor 5|Meta excluída/);
  find(parentCard,n=>n.type==='button'&&text(n).trim()==='Excluir').props.onClick();
  let dialog=find(renderManagement(),n=>n.props.role==='alertdialog');assert.ok(dialog);assert.equal(deletions.length,0);
  find(dialog,n=>n.type==='button'&&text(n)==='Cancelar').props.onClick();assert.equal(deletions.length,0);
  find(parentCard,n=>n.type==='button'&&text(n).trim()==='Excluir').props.onClick();
  dialog=find(renderManagement(),n=>n.props.role==='alertdialog');
  find(dialog,n=>n.type==='button'&&text(n)==='Excluir meta').props.onClick();await tick();
  assert.deepEqual(deletions[0].map(c=>[c.id,c.status]),[[template.id,'cancelled'],[child.id,'cancelled']]);
  const initial={...registration.registrationFromGoal(payload,campaign,4),sourceId:undefined,description:'Nova meta',amount:''};
  const render=()=>{h.reset();return GoalRegistrationPanel({data:payload,facts:[],period,initial,eligibleSellerIds:[4,5],pickerSellerId:4,busy:false,historyReady:true,historyError:'',saveError:'',onClose(){},onSave:async changes=>{writes.push(changes);return true;}});};
  const select=tree=>find(find(tree,n=>n.props.className==='goal-existing-picker'),n=>n.type==='select');
  const amount=tree=>find(find(tree,n=>n.type==='label'&&text(n)==='Valor da meta por vendedor (R$)'),n=>n.type==='input').props.value;
  let tree=render();assert.match(renderToStaticMarkup(select(tree)),/Metas deste vendedor.*Adicionar à meta existente/);
  select(tree).props.onChange({target:{value:campaign.id}});tree=render();assert.match(amount(tree),/^R\$\s1\.000,00$/);
  select(tree).props.onChange({target:{value:template.id}});tree=render();assert.match(amount(tree),/^R\$\s4\.000,00$/);assert.equal(writes.length,0);
  find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=render();
  find(tree,n=>n.type==='button'&&text(n)==='Confirmar inclusão').props.onClick();await tick();
  const [general,brand]=writes[0];assert.equal(general.id,template.id);assert.equal(general.version,template.version);
  assert.deepEqual(general.assignments,[...template.assignments,{sellerId:4,targetCents:400000}]);
  assert.equal(brand.id,child.id);assert.deepEqual(brand.allocation,child.allocation);assert.deepEqual(brand.assignments,[...child.assignments,{sellerId:4,targetCents:200000}]);
});
test('failed save keeps the panel values and closed goals stay read-only; unavailable history is not shown as zero',async()=>{
  const h=hooks();let closed=0;
  const {GoalRegistrationPanel}=await load('../app/goals-management.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}});
  const initial={description:'Nova meta',type:'general',companies:[1],start:'2026-11-03',end:'2026-11-23',brand:'',group:0,status:'active',notes:'',amount:'2000',sellerIds:[4],allocations:[]};
  const render=()=>{h.reset();return GoalRegistrationPanel({data:{...data,campaigns:[]},facts:[],period:{start:initial.start,end:initial.end},initial,eligibleSellerIds:[4],busy:false,historyReady:false,historyError:'Falha',saveError:'',onClose(){closed++;},onSave:async()=>false});};let tree=render();
  assert.match(renderToStaticMarkup(tree),/Não foi possível consultar o histórico/);assert.doesNotMatch(renderToStaticMarkup(tree),/goal-history-bars/);
  assert.match(renderToStaticMarkup(tree),/Período atual: 03\/11\/2026 a 23\/11\/2026/);
  find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=render();find(tree,n=>n.type==='button'&&text(n)==='Confirmar cadastro').props.onClick();await tick();tree=render();assert.equal(closed,0);assert.ok(find(tree,n=>n.props.role==='alert'));
  find(tree,n=>n.type==='button'&&text(n)==='Voltar e revisar').props.onClick();tree=render();const value=find(find(tree,n=>n.type==='label'&&text(n)==='Valor da meta por vendedor (R$)'),n=>n.type==='input');assert.match(value.props.value,/^R\$\s2\.000,00$/);
  const ro=hooks(),module=await load('../app/goals-management.tsx',{'react':ro.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}}),dataset={...data,campaigns:[{...campaign,status:'closed'}]};
  const readonly=module.GoalRegistrationPanel({data:dataset,facts:[],period:{start:campaign.start,end:campaign.end},initial:registration.registrationFromGoal(dataset,dataset.campaigns[0],4),eligibleSellerIds:[4],busy:false,historyReady:true,historyError:'',saveError:'',onClose(){},onSave:async()=>true});
  assert.equal(find(readonly,n=>n.type==='fieldset').props.disabled,true);assert.ok(!find(readonly,n=>n.type==='button'&&text(n)==='Revisar meta'));
});
test('seller history uses the existing column chart with six months, axes and real historical goals only',async()=>{
  const {SellerHistory}=await load('../app/goals-management.tsx',{'react':React,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}});
  const facts=[{date:'2026-10-15',sellerId:4,actual:250,wallet:1000},{date:'2026-10-15',sellerId:5,actual:9999,wallet:0},{date:'2026-11-01',sellerId:4,actual:700,wallet:0}];
  const campaigns=[{...campaign,id:'october',start:'2026-10-01',end:'2026-10-31',assignments:[{sellerId:4,targetCents:20000},{sellerId:5,targetCents:999900}]},{...campaign,id:'category',type:'brand',brand:'Feltrin',start:'2026-10-01',end:'2026-10-31'},{...campaign,id:'draft',status:'draft',start:'2026-09-01',end:'2026-09-30'}];
  const tree=SellerHistory({campaigns,facts,sellerIds:[4],start:'2026-11-01',names:['Vendedor 4'],ready:true,error:''}),chart=find(tree,n=>n.type===sharedGoalCharts.GoalTimeChart);
  assert.equal(chart.props.columns,true);assert.equal(chart.props.showHeading,false);assert.deepEqual(chart.props.labels,['05/2026','06/2026','07/2026','08/2026','09/2026','10/2026']);
  assert.deepEqual(chart.props.series[0].values,[0,0,0,0,0,250]);assert.deepEqual(chart.props.series[1].values,[null,null,null,null,null,200]);
  const html=renderToStaticMarkup(tree);assert.match(html,/<line /);assert.match(html,/fill="#00855b"/);assert.match(html,/fill="#4b8ac7"/);assert.doesNotMatch(html,/goal-history-bars|9999/);assert.equal((html.match(/<h3>/g)||[]).length,1);
  assert.ok([...html.matchAll(/<rect x="([\d.]+)"[^>]*fill="#(?:00855b|4b8ac7)"/g)].every(match=>Number(match[1])>=55),'columns stay inside the plot without covering the value axis');
});

test('registration shows and requests history automatically when a seller is selected',async()=>{
  const h=hooks();let requests=0;const onHistoryNeeded=()=>{requests++;};
  const {GoalRegistrationPanel,SellerHistory}=await load('../app/goals-management.tsx',{'react':h.react,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-registration':registration,'./goals-export':{}});
  const initial={...registration.registrationFromGoal(data,campaign,4),sourceId:undefined,sellerIds:[]};
  const render=()=>{h.reset();const tree=GoalRegistrationPanel({data,facts:[],period:{start:initial.start,end:initial.end},initial,eligibleSellerIds:[4],busy:false,historyReady:false,historyError:'',onHistoryNeeded,saveError:'',onClose(){},onSave:async()=>true});h.run();return tree;};
  let tree=render();
  assert.equal(requests,0);assert.equal(find(tree,n=>n.type===SellerHistory),undefined);
  const checkbox=()=>find(tree,n=>n.type==='input'&&n.props.type==='checkbox');
  checkbox().props.onChange({target:{checked:true}});tree=render();
  assert.equal(requests,1);assert.deepEqual(find(tree,n=>n.type===SellerHistory).props.sellerIds,[4]);
  const html=renderToStaticMarkup(tree);
  assert.ok(html.indexOf('Vendas dos últimos 6 meses')<html.indexOf('Descrição'));
  assert.doesNotMatch(html,/<summary>Histórico de vendas/);
  checkbox().props.onChange({target:{checked:false}});tree=render();
  assert.equal(requests,1);assert.equal(find(tree,n=>n.type===SellerHistory),undefined);
});
test('charts render without React warnings, report filters preserve target scope and category growth',async()=>{
  const {GoalCharts,buildGoalReport}=await load('../app/goals-charts.tsx',{'react':React,'react/jsx-runtime':jsx,'./goals-central-model':model});
  const facts=[{date:'2026-11-04',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:500,wallet:50},{date:'2026-10-04',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:250,wallet:0}];
  const summary=model.summarizeGoals(data,facts,model.emptyGoalFilters,'2026-11-01','2026-11-30','2026-11-25');
  const original=console.error,warnings=[];console.error=(...a)=>warnings.push(a.join(' '));let html;
  try{html=renderToStaticMarkup(React.createElement(GoalCharts,{data,summary,start:'2026-11-01',end:'2026-11-30',individual:false,onFilter(){}}));}finally{console.error=original;}
  assert.equal(warnings.length,0);assert.match(html,/Evolução acumulada/);assert.match(html,/Histórico de metas/);
  const report=buildGoalReport(data,summary,summary.rows,'brand','2026-11-01','2026-11-30');assert.equal(report.rows[0][1],'');assert.equal(report.rows[0][2],500);assert.equal(report.rows[0][7],100);
});
test('individual performance opens automatically with independent brand and group values, without drill-down filters',async()=>{
  const {GoalCharts}=await load('../app/goals-charts.tsx',{'react':React,'react/jsx-runtime':jsx,'./goals-central-model':model});
  const payload={...data,catalog:{...data.catalog,brands:['Feltrin','Hydrogood'],groups:[{id:100,name:'Sementes'},{id:200,name:'Fertilizantes'}]},campaigns:[campaign,
    {...campaign,id:'brand-feltrin',type:'brand',brand:'Feltrin',assignments:[{sellerId:4,targetCents:60000}]},
    {...campaign,id:'brand-zero',type:'brand',brand:'Hydrogood',assignments:[{sellerId:4,targetCents:30000}]},
    {...campaign,id:'group-zero',type:'group',group:200,assignments:[{sellerId:4,targetCents:40000}]}]};
  const facts=[{date:'2026-11-04',sellerId:4,company:1,brand:'Feltrin',group:100,state:'MT',actual:500,wallet:50},{date:'2026-11-04',sellerId:8,company:1,brand:'Outra marca',group:999,state:'PR',actual:9000,wallet:500}];
  const summary=model.summarizeGoals(payload,facts,{...model.emptyGoalFilters,seller:'4'},'2026-11-01','2026-11-30','2026-11-25');
  const html=renderToStaticMarkup(React.createElement(GoalCharts,{data:payload,summary,start:'2026-11-01',end:'2026-11-30',individual:true,onFilter(){throw Error('Individual view must not set category filters');}}));
  assert.match(html,/<section class="goal-panel" aria-label="Desempenho por marca e grupo">/);
  assert.match(html,/<h3>Marca<\/h3>/);assert.match(html,/<h3>Grupo de produtos<\/h3>/);
  assert.match(html,/Feltrin: meta R\$ 600,00, realizado R\$ 500,00/);assert.match(html,/Sementes: meta não cadastrada, realizado R\$ 500,00/);
  assert.match(html,/Hydrogood: meta R\$ 300,00, realizado R\$ 0,00/);assert.match(html,/Fertilizantes: meta R\$ 400,00, realizado R\$ 0,00/);
  assert.doesNotMatch(html,/<button class="goal-bar-row"|Clique para filtrar|Outra marca|<h3>Regional<\/h3>/);
});
test('navigation stays before Comunicação, with responsive matrix and compact grids',async()=>{
  const source=await readFile(new URL('../app/sales-app.tsx',import.meta.url),'utf8');for(const name of ['DesktopSidebar','MobileNav']){const start=source.indexOf(`function ${name}`),end=source.indexOf('\nfunction ',start+1),section=source.slice(start,end===-1?undefined:end);assert.ok(section.indexOf('onClick={onGoals}')<section.indexOf('onClick={onCommunication}'));}
  const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');assert.match(css,/\.goals-table-scroll \{ overflow:auto/);assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/\.goals-page \[hidden\]/);
});

test('individual performance previews three brands and three groups and expands the rest together',async()=>{
  const h=hooks(),{GoalCharts}=await load('../app/goals-charts.tsx',{'react':h.react,'react/jsx-runtime':jsx,'./goals-central-model':model});
  const facts=[4,1,5,2,3].map(id=>({date:'2026-11-04',sellerId:4,company:1,brand:'Marca '+id,group:id,state:'MT',actual:id*100,wallet:0}));
  const payload={...data,catalog:{...data.catalog,groups:facts.map(f=>({id:f.group,name:'Grupo '+f.group}))}};
  const summary=model.summarizeGoals(payload,facts,{...model.emptyGoalFilters,seller:'4'},'2026-11-01','2026-11-30','2026-11-25');
  const render=()=>{h.reset();return GoalCharts({data:payload,summary,start:'2026-11-01',end:'2026-11-30',individual:true,onFilter(){}});};
  const rows=(tree,title)=>{
    const chart=find(tree,n=>n.props.title===title&&Array.isArray(n.props.rows));
    const html=renderToStaticMarkup(chart.type(chart.props));
    return [...html.matchAll(/<span>((?:Marca|Grupo) \d)<\/span>/g)].map(m=>m[1]);
  };
  let tree=render();
  assert.deepEqual(rows(tree,'Marca'),['Marca 5','Marca 4','Marca 3']);
  assert.deepEqual(rows(tree,'Grupo de produtos'),['Grupo 5','Grupo 4','Grupo 3']);
  const more=find(tree,n=>n.type==='button'&&text(n)==='Saiba mais');
  assert.equal(more.props['aria-expanded'],false);more.props.onClick();tree=render();
  assert.deepEqual(rows(tree,'Marca'),['Marca 5','Marca 4','Marca 3','Marca 2','Marca 1']);
  assert.deepEqual(rows(tree,'Grupo de produtos'),['Grupo 5','Grupo 4','Grupo 3','Grupo 2','Grupo 1']);
  const less=find(tree,n=>n.type==='button'&&text(n)==='Mostrar menos');
  assert.equal(less.props['aria-expanded'],true);less.props.onClick();tree=render();
  assert.equal(rows(tree,'Marca').length,3);
});

test('general performance details display brands and product groups without a regional chart',async()=>{
  const h=hooks(),{GoalCharts}=await load('../app/goals-charts.tsx',{'react':h.react,'react/jsx-runtime':jsx,'./goals-central-model':model});
  const summary=model.summarizeGoals(data,[],model.emptyGoalFilters,'2026-11-01','2026-11-30');
  const render=()=>{h.reset();return GoalCharts({data,summary,start:'2026-11-01',end:'2026-11-30',individual:false,onFilter(){}});};
  const panel=tree=>find(tree,n=>n.type==='details'&&find(n,k=>k.type==='summary'&&text(k)==='Desempenho por marca e grupo'));
  panel(render()).props.onToggle({currentTarget:{open:true}});
  const html=renderToStaticMarkup(panel(render()));
  assert.match(html,/<h3>Marca<\/h3>/);
  assert.match(html,/<h3>Grupo de produtos<\/h3>/);
  assert.doesNotMatch(html,/<h3>Regional<\/h3>/);
});
