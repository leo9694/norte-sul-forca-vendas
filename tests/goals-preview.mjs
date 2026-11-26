// Prévia isolada para QA visual. Não usa credenciais, APIs ou bancos do aplicativo.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as model from '../app/goals-central-model.ts';
import * as legacy from '../app/goals-model.ts';
import * as registration from '../app/goals-registration.ts';
import * as fflate from 'fflate';
async function compile(file,modules){const source=await readFile(new URL(file,import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,exports={};new Function('require','exports',code)(id=>{if(!(id in modules))throw Error(id);return modules[id];},exports);return exports;}
const sellers=Array.from({length:6},(_,i)=>({id:i+1,name:`Representante ${String(i+1).padStart(2,'0')}`,active:true,company:1,region:i<3?'Mato Grosso':'Paraná',regionId:i<3?1:2,supervisorId:i<3?1:4}));
const base={id:'general',description:'Faturamento de novembro',type:'general',companies:[1,6,8],start:'2026-11-01',end:'2026-11-30',brand:'',group:0,status:'active',notes:'',version:1,assignments:sellers.slice(0,5).map(s=>({sellerId:s.id,targetCents:1000000})),createdBy:7,createdName:'Gestor de teste',createdAt:1794000000000,updatedAt:1794000000000,editable:true};
const data={canViewAll:true,canManage:true,canConfigure:true,ownSellerId:1,settings:model.defaultGoalSettings,updatedAt:Date.now(),campaigns:[base,{...base,id:'brand',description:'Marca Feltrin',type:'brand',brand:'Feltrin'},{...base,id:'group',description:'Sementes',type:'group',group:100}],catalog:{sellers,companies:[{id:1,name:'Distribuidora 1'},{id:6,name:'Distribuidora 6'},{id:8,name:'Distribuidora 8'}],brands:['Feltrin','Forth Jardim'],groups:[{id:100,name:'Sementes'},{id:200,name:'Fertilizantes'}]}};
const facts=sellers.flatMap((s,i)=>Array.from({length:24},(_,day)=>({date:`2026-11-${String(day+1).padStart(2,'0')}`,sellerId:s.id,company:1,brand:'Feltrin',group:100,state:'MT',actual:i===5?0:100+(5-i)*65,wallet:day===23?600:0})));
data.campaigns.push({...base,id:'scheduled',status:'scheduled',assignments:[{sellerId:6,targetCents:2000000}]});
facts.push(...sellers.flatMap((s,i)=>Array.from({length:6},(_,m)=>({date:`2026-${String(m+5).padStart(2,'0')}-15`,sellerId:s.id,company:1,brand:'Feltrin',group:100,state:'MT',actual:30000+m*2500+i*1500,wallet:0}))));
const common={'react':React,'react/jsx-runtime':jsx,'lucide-react':icons,'./goals-central-model':model,'./goals-model':legacy,'./goals-registration':registration};
const charts=await compile('../app/goals-charts.tsx',common),exp=await compile('../app/goals-export.ts',{'fflate':fflate}),management=await compile('../app/goals-management.tsx',{...common,'./goals-export':exp,'./goals-charts':charts});
const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
const exportSource=await readFile(new URL('../app/goals-export.ts',import.meta.url),'utf8'),browserExports=ts.transpileModule(exportSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from 'fflate'","from '/fflate.js'");
const server=createServer(async(req,res)=>{
  if(req.url==='/fflate.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../node_modules/fflate/esm/browser.js',import.meta.url)));return;}
  if(req.url==='/exports.js'){res.setHeader('Content-Type','text/javascript');res.end(browserExports);return;}
  const url=new URL(req.url,'http://localhost'),seller=url.pathname==='/seller',manage=url.pathname==='/manage';
  if(url.pathname==='/mobile'){res.setHeader('Content-Type','text/html');res.end('<iframe style="width:390px;height:740px;border:1px solid #ccc" src="'+(url.searchParams.has('register')?'/register':'/seller')+'"></iframe>');return;}
  const payload=seller?{...data,canViewAll:false,canManage:false,canConfigure:false,catalog:{...data.catalog,sellers:[sellers[0]]},campaigns:data.campaigns.map(c=>({...c,assignments:[c.assignments[0]]}))}:data;
  let index=0;const core='|/api/goals/central?action=analytics&start=2026-10-01&end=2026-11-30';
  const seeds={0:'2026-11',1:{generation:0,value:payload,scope:''},2:{[core+(seller?'&seller=1':'')]:{facts:seller?facts.filter(f=>f.sellerId===1):facts,updatedAt:Date.now(),expires:Date.now()+90000}},3:seller?'seller':manage?'manage':'general',5:'1'};
  const {GoalsScreen}=await compile('../app/goals-central-screen.tsx',{...common,'react':{...React,useEffect(){},useState(initial){const i=index++;return[i in seeds?seeds[i]:typeof initial==='function'?initial():initial,()=>{}];}},'./goals-charts':charts,'./goals-management':management,'./goals-export':exp});
  const empty=url.searchParams.has('empty'),initial={description:'Meta de vendas',type:'general',companies:[1,6,8],start:base.start,end:base.end,brand:'',group:0,status:'active',notes:'',amount:empty?'':'100000',sellerIds:empty?[]:[1],allocations:empty?[]:[{key:'a',type:'brand',brand:'Feltrin',group:0,percent:'40'},{key:'b',type:'group',brand:'',group:100,percent:'50'}]};
  const tree=url.pathname==='/register'?React.createElement('div',{className:'page goals-page'},React.createElement(management.GoalRegistrationPanel,{data,facts,period:{start:base.start,end:base.end},initial,eligibleSellerIds:sellers.map(s=>s.id),busy:false,historyReady:true,historyError:'',saveError:'',onClose(){},onSave:async()=>true})):React.createElement(GoalsScreen,{online:true,onNotice(){}});
  const html=renderToStaticMarkup(tree);res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--font-manrope:Arial}body{padding:20px}.page{max-width:1400px;margin:auto}@media(max-width:600px){body{padding:5px}.page{padding:10px}}</style><nav><a href="/">Geral</a> · <a href="/seller">Vendedor</a> · <a href="/manage">Gestão</a> · <a href="/mobile">Celular</a></nav>${html}<p id="xlsx-test">Verificando Excel…</p><script type="module">import{goalsWorkbook,readGoalsWorkbook}from'/exports.js';try{const input=[['CODVEND','Vendedor','Meta'],[1,'Teste',1234.56],[2,'Zero',0]],rows=readGoalsWorkbook(goalsWorkbook(input));if(rows[1][2]!=='1234.56'||rows[2][2]!=='0')throw Error('Valores incorretos');document.getElementById('xlsx-test').textContent='Excel: exportação e importação aprovadas';}catch(e){document.getElementById('xlsx-test').textContent='ERRO EXCEL: '+e.message;}</script></html>`);
});
server.listen(0,'127.0.0.1',()=>console.log('GOALS_PREVIEW_URL=http://127.0.0.1:'+server.address().port));
