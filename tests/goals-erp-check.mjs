// Integração opcional e somente leitura: fixtures em CTE/DUAL, sem gravar no ERP.
// node --env-file=.env.treinamento tests/goals-erp-check.mjs
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {loginSankhya,executeQuery} from '../app/api/_lib/sankhya.ts';
import {readGoalQueryRows} from '../app/api/_lib/goals-query.ts';
const source=await readFile(new URL('../app/api/_lib/goals-central.ts',import.meta.url),'utf8'),code=ts.transpileModule(source.replace(/^import[^\n]+\n/gm,''),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^export /gm,'');
const sqlFor=new Function('executeQuery',code+';return goalFactsSql;')(executeQuery);
const session=await loginSankhya(process.env.SANKHYA_ACCESS_USER,process.env.SANKHYA_ACCESS_PASSWORD);
const rows=(columns,data)=>data.map(row=>'SELECT '+row.map((v,i)=>(typeof v==='number'?v:`'${v}'`)+(i>=0?' '+columns[i]:'')).join(',')+' FROM DUAL').join(' UNION ALL ');
const headers=rows(['NUNOTA','CODTIPOPER','TIPMOV','STATUSNOTA','STATUSNFE','PENDENTE','CODEMP','CODVEND','CODPARC','VLRNOTA'],[
  [1,35,'V','L','A','N',1,4,1,40], // venda parcial
  [2,36,'D','L','T','N',1,4,1,10], // devolução vinculada
  [3,35,'V','L','D','N',1,4,1,500], // denegada
  [4,10,'V','L','A','N',1,4,1,200], // bonificação
  [5,35,'V','A','A','N',1,4,1,100], // não confirmada
  [6,5,'P','L','M','S',1,4,1,100], // pedido parcialmente faturado
  [7,36,'D','L','T','N',1,4,1,100], // devolução sem vínculo: não presumir
  [8,35,'V','L','A','N',1,4,1,90], // dois itens, desconto e valor de cabeçalho
]);
const items=rows(['NUNOTA','SEQUENCIA','CODPROD','QTDNEG','QTDENTREGUE','PENDENTE','VLRTOT','VLRDESC'],[
  [1,1,1,4,0,'N',40,0],[2,1,1,1,0,'N',10,0],[3,1,1,1,0,'N',500,0],[4,1,1,1,0,'N',200,0],[5,1,1,1,0,'N',100,0],
  [6,1,1,10,4,'S',100,0],[7,1,1,10,0,'N',100,0],[8,1,1,5,0,'N',50,10],[8,2,2,5,0,'N',50,0],
]);
const fixtures=`WITH TGFCAB AS (SELECT C.*,DATE '2026-11-10' DTNEG,CASE WHEN C.NUNOTA=8 THEN NULL ELSE DATE '2026-11-10' END DTENTSAI FROM (${headers}) C),
  TGFITE AS (${items}),TGFVAR AS (${rows(['NUNOTA','SEQUENCIA','NUNOTAORIG','SEQUENCIAORIG','QTDATENDIDA'],[[1,1,6,1,4],[2,1,1,1,1]])}),
  TGFPRO AS (${rows(['CODPROD','MARCA','CODGRUPOPROD'],[[1,'Feltrin',100],[2,'Forth',200]])}),
  TGFPAR AS (SELECT 1 CODPARC,1 CODCID FROM DUAL),TSICID AS (SELECT 1 CODCID,1 UF FROM DUAL),TSIUFS AS (SELECT 1 CODUF,'MT' UF FROM DUAL),`;
const settings={saleTops:[35],orderTops:[5],returnTops:[]},scope={sellerIds:[4],companies:[1]};
for(const wallet of [false,true]){
  const sql=sqlFor('2026-11-01','2026-11-30',scope,settings,wallet),result=await readGoalQueryRows(page=>executeQuery(session,page),fixtures+sql.replace(/^WITH /,''),1);
  const total=result.reduce((s,r)=>s+Number(r[wallet?'WALLET':'ACTUAL']),0);assert.ok(Math.abs(total-(wallet?60:120))<0.001);
  if(!wallet){assert.equal(result.find(r=>r.MARCA==='Feltrin').ACTUAL,70);assert.equal(result.find(r=>r.MARCA==='Forth').ACTUAL,50);}
  console.log(wallet?'Carteira parcial: aprovado (60)':'Faturamento, devolução, categorias, desconto e exclusões: aprovado (120)');
}
const seriesSql=sqlFor('2026-11-01','2026-11-30',scope,settings,false,true);
const series=await readGoalQueryRows(page=>executeQuery(session,page),fixtures+seriesSql.replace(/^WITH /,''));
assert.equal(series.length,1);assert.equal(series[0].ACTUAL,120);assert.equal(series[0].GOAL_DATE,'2026-11-01');
console.log('Série mensal do histórico: aprovado (120, sem carteira)');
