import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Barcode,CalendarDays,CheckCircle2,ChevronRight,CircleDollarSign,Copy,FileText,LoaderCircle,MoreVertical,Plus,Search,Send} from 'lucide-react';
import ts from 'typescript';
import * as status from '../app/order-status.ts';

const source=await readFile(new URL('../app/sales-app.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source.slice(source.indexOf('function OrdersScreen('),source.indexOf('function ClientsScreen(')),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}
}).outputText;
const props={
  orders:[
    {NUNOTA:101,CODPARC:11,NOMEPARC:'Mercado faturado',CODTIPOPER:5,DTNEG:'10/11/2026',DTFAT:'12/11/2026',FATURADO:'S',STATUS_FATURAMENTO:'L',NFE_DISPONIVEL:'S',BOLETO_DISPONIVEL:'S',VLRNOTA:4200},
    {NUNOTA:102,CODPARC:12,NOMEPARC:'Cliente em conferência',CODTIPOPER:6,DTNEG:'12/11/2026',STATUS_CONFERENCIA:'D',NFE_DISPONIVEL:'S',BOLETO_DISPONIVEL:'S',VLRNOTA:780},
  ],
  drafts:[{id:'draft-1',partner:{CODPARC:13,NOMEPARC:'Cliente do rascunho'},updatedAt:1794470400000,cart:[],sellerName:'Representante 01'}],
  online:true,currentSellerId:1,currentSellerName:'Representante 01',loading:false,canAnalyzeSellers:false,sellers:[],selectedSellerId:1,appliedFrom:'2026-11-01',appliedTo:'2026-11-26',
};
const money=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function renderOrders(overrides={},filter='Todos',withPeriod=false){
  let hook=0;
  const bindings={Barcode,CalendarDays,CheckCircle2,ChevronRight,CircleDollarSign,Copy,FileText,LoaderCircle,MoreVertical,Plus,Search,Send,...status,React,useRef:React.useRef,useEffect:React.useEffect,
    useState:initial=>React.useState(++hook===2?filter:hook===3?withPeriod:initial),
    BrandMark:()=>null,currentMonthStart:()=> '2026-11-01',inputDate:()=> '2026-11-26',
    sankhyaDate:value=>value||'—',cartTotal:()=>120,money};
  const Component=new Function(...Object.keys(bindings),code+';return OrdersScreen;')(...Object.values(bindings));
  return renderToStaticMarkup(React.createElement(Component,{...props,...overrides}));
}

test('orders keep draft and sent actions separate and only expose available invoices and slips',()=>{
  const html=renderOrders();
  assert.match(html,/aria-label="Rascunhos"[\s\S]*Cliente do rascunho[\s\S]*Continuar[\s\S]*aria-label="Pedidos enviados"/);
  assert.match(html,/Mercado faturado[\s\S]*Faturamento: 12\/11\/2026[\s\S]*aria-label="Abrir DANFE"[\s\S]*aria-label="Abrir boleto"/);
  assert.match(html,/PED-102[\s\S]*Bonificação[\s\S]*Conferência divergente/);
  assert.doesNotMatch(html.slice(html.indexOf('PED-102')),/Faturamento:|Abrir DANFE|Abrir boleto/);
  assert.doesNotMatch(html,/Ver todos|Rascunho automático/);
  assert.match(renderOrders({online:false}),/disabled="" aria-label="Abrir DANFE"/);
});

test('sales and bonuses in the order summary use fiscal totals, not the listed orders',()=>{
  const html=renderOrders({invoiceTotals:{SALES_VALUE:3010.5,BONUS_VALUE:92.1}});
  assert.match(html,/Vendas faturadas[\s\S]*3\.010,50[\s\S]*Bonificação faturada[\s\S]*92,10/);
  assert.match(renderOrders(),/Vendas faturadas<\/small><strong>—/);
});

test('draft filter hides sent loading state and date panel has one current-month action',()=>{
  const html=renderOrders({loading:true},'Rascunhos',true);
  assert.match(html,/aria-pressed="true">Rascunhos/);
  assert.doesNotMatch(html,/Carregando pedidos|Mercado faturado/);
  assert.equal((html.match(/>Este mês</g)||[]).length,1);
  assert.match(renderOrders({drafts:[],loading:true},'Rascunhos'),/Nenhum rascunho encontrado/);
});

test('reopening Orders uses the seller and period held by the parent, not the login seller',()=>{
  const sellers=[{CODVEND:1,APELIDO:'Gerente'},{CODVEND:8,APELIDO:'Representante 08'}];
  const html=renderOrders({canAnalyzeSellers:true,sellers,selectedSellerId:8,appliedFrom:'2026-10-01',appliedTo:'2026-10-31'},'Todos',true);
  assert.match(html,/<option value="8" selected="">Representante 08<\/option>/);
  assert.match(html,/value="2026-10-01"/);assert.match(html,/value="2026-10-31"/);
  assert.doesNotMatch(code,/kind=dashboardSellers/);
  assert.doesNotMatch(renderOrders({sellers}),/orders-seller-switch/);
});

test('an authorized seller filter stays visible without options and while offline',()=>{
  assert.match(renderOrders({canAnalyzeSellers:true,selectedSellerId:8}),/<span>Vendedor<\/span><select disabled=""><option value="8" disabled="" selected="">Vendedor 8/);
  const sellers=[{CODVEND:8,APELIDO:'Representante 08'}];
  assert.match(renderOrders({canAnalyzeSellers:true,sellers,selectedSellerId:8,online:false}),/<select disabled=""><option value="8" selected="">Representante 08/);
});
