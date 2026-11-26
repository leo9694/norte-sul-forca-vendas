import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ArrowRight,Building2,CalendarDays,CircleDollarSign,ClipboardList,CloudCheck,CloudOff,FileText,Filter,LoaderCircle,PackageCheck,RefreshCw,ShoppingBag,UserRound,UsersRound} from 'lucide-react';
import ts from 'typescript';

const source=await readFile(new URL('../app/sales-app.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('sales-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const compile=code=>ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const range={from:'2026-11-01',to:'2026-11-26'};
const summary={SALES_VALUE:987654.32,BONUS_VALUE:321.45,ORDER_COUNT:74,AVG_TICKET:13346.68,CLIENT_COUNT:46,SELLER_COUNT:12,OPEN_ORDER_COUNT:9,OPEN_VALUE:6200};
const group={CODGRUPOPROD:4,DESCRGRUPOPROD:'Sementes',SALES_VALUE:summary.SALES_VALUE};
const money=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const compactMoney=value=>'R$ '+new Intl.NumberFormat('pt-BR',{notation:'compact'}).format(value);
const noop=()=>{};
export function renderOverview(manager=false,overrides={}){
  const name=manager?'GeneralSalesScreen':'HomeScreen';
  const block=declaration(name).body.statements.find(ts.isReturnStatement);
  const bindings={React,ArrowRight,Building2,CalendarDays,CircleDollarSign,ClipboardList,CloudCheck,CloudOff,FileText,Filter,LoaderCircle,PackageCheck,RefreshCw,ShoppingBag,UserRound,UsersRound,money,compactMoney,
    BrandMark:()=>null,useRef:React.useRef,useEffect:React.useEffect,formatPeriod:value=>value.split('-').reverse().join('/'),online:true,
    notice:'',error:'',reportError:'',loading:false,generatingReport:false,detail:null,periodLabel:'01/11/2026 a 26/11/2026',
    applied:{...range,company:0},appliedPeriod:range,dateFrom:range.from,dateTo:range.to,
    monthStart:range.from,todayValue:range.to,yearStart:'2026-01-01',twelveMonthsStart:'2025-12-01',
    companies:[{CODEMP:1,NOMEFANTASIA:'Distribuidora Norte Sul'}],company:0,groupTotal:summary.SALES_VALUE,maxGroup:summary.SALES_VALUE,confirmedOrders:74,openOrders:9,totalOrders:83,
    data:{summary,monthly:[],sellers:[{CODVEND:8,APELIDO:'Representante 08',ORDER_COUNT:74,AVG_TICKET:summary.AVG_TICKET,SALES_VALUE:summary.SALES_VALUE}],groups:[group],companies:[{...summary,CODEMP:1,NOMEFANTASIA:'Distribuidora Norte Sul'}]},
    dashboard:{summary,dailySales:[{SALE_DATE:'05/11/2026',SALES_VALUE:4200},{SALE_DATE:'06/11/2026',SALES_VALUE:2950}],topProducts:[{CODPROD:4,DESCRPROD:'Sementes para o jardim',QUANTITY:40,SALES_VALUE:4200}],topClients:[{CODPARC:11,NOMEPARC:'Mercado Central',ORDER_COUNT:3,SALES_VALUE:6200}],salesByGroup:[group],clientPortfolio:{NEW_CLIENTS:3,RECURRING_CLIENTS:38,REACTIVATED_CLIENTS:5,INACTIVE_30:24,INACTIVE_60:14,INACTIVE_90:8}},
    dashboardSellers:[{CODVEND:8,APELIDO:'Representante 08'}],selectedSellerId:8,
    currentMonthStart:()=>range.from,inputDate:()=>range.to,maxDaily:4200,maxProduct:40,groupSalesTotal:summary.SALES_VALUE,maxGroupSales:summary.SALES_VALUE,
    setCompany:noop,setDateFrom:noop,setDateTo:noop,setApplied:noop,setAppliedPeriod:noop,setSelectedSellerId:noop,
    selectPeriod:noop,selectCurrentMonth:noop,selectLastThreeMonths:noop,generateCompleteReport:noop,openDashboardDetail:noop,
    panelPdfButton:(kind,label)=>React.createElement('button',{className:'panel-pdf-button','aria-label':'Gerar PDF de '+label},'PDF'),...overrides};
  const js=compile(declaration('MonthlySalesChart').getText(ast)+'\nfunction Preview(){'+block.getText(ast)+'}');
  const Preview=new Function(...Object.keys(bindings),js+';return Preview;')(...Object.values(bindings));
  return renderToStaticMarkup(React.createElement(Preview));
}

test('seller overview groups filters and keeps access to panel PDFs and drilldowns',()=>{
  const html=renderOverview();
  assert.match(html,/aria-label="Período do desempenho"[\s\S]*Vendedor[\s\S]*Representante 08/);
  assert.match(html,/Produtos mais vendidos[\s\S]*Gerar PDF de Mix de vendas[\s\S]*Ver detalhes/);
  assert.match(html,/Carteira de clientes[\s\S]*30\+ dias sem comprar[\s\S]*60\+ dias[\s\S]*90\+ dias/);
  assert.match(html,/Vendas no período[\s\S]*987\.654,32[\s\S]*Bonificação[\s\S]*321,45[\s\S]*Notas de venda/);
  assert.doesNotMatch(html,/Saiba mais|clientes únicos|Acompanhe seus resultados/);
});
test('consolidated overview retains company filter, billed and open orders, and the company breakdown',()=>{
  const html=renderOverview(true);
  assert.match(html,/Filtros do monitoramento geral[\s\S]*Todas as empresas/);
  assert.match(html,/Status dos pedidos[\s\S]*Faturados[\s\S]*Em aberto/);
  assert.match(html,/Desempenho por empresa[\s\S]*Distribuidora Norte Sul[\s\S]*data-label="Participação"/);
  assert.doesNotMatch(html,/Dados atualizados conforme|Pipeline|Monitoramento das empresas/);
});
