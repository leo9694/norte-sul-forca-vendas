import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ArrowLeft,Building2,Check,ChevronRight,CircleDollarSign,ClipboardList,LoaderCircle,Mail,Phone,Plus,Search,Trash2,UsersRound,X} from 'lucide-react';
import ts from 'typescript';
import * as detailsModel from '../app/client-details-model.ts';
import * as registrationModel from '../app/client-registration-model.ts';
import * as orderStatus from '../app/order-status.ts';

const source=await readFile(new URL('../app/sales-app.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('sales-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const compile=code=>ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const customers=[
  {CODPARC:101,NOMEPARC:'Mercado Central',CGCCPF:'11222333000181',TELEFONE:'(65) 3333-3333',EMAIL:'contato@mercado.example',CODTAB:4,GRUPOICMS:2},
  {CODPARC:104,NOMEPARC:'Agropecuária Flores e Sementes',TELEFONE:'(65) 3333-2222',CODTAB:null},
];
export function renderClients(overrides={}){
  const bindings={React,Building2,ChevronRight,CircleDollarSign,ClipboardList,LoaderCircle,Mail,Phone,Plus,Search,UsersRound,
    currentUserId:2,currentSellerId:7,selectedSellerId:8,selectedSellerName:'Representante 08',sellers:[{CODVEND:8,APELIDO:'Representante 08'}],
    query:'',canAnalyzeSellers:true,online:true,registrationOpen:false,registrationNotice:'',selectedClient:null,
    filtered:customers,portfolio:customers,configured:1,isLoading:false,...overrides};
  const body=declaration('ClientsScreen').body.statements.find(ts.isReturnStatement).getText(ast);
  const js=compile(declaration('Metric').getText(ast)+declaration('BrandMark').getText(ast)+'function Preview(){'+body+'}');
  const Preview=new Function(...Object.keys(bindings),js+';return Preview;')(...Object.values(bindings));
  return renderToStaticMarkup(React.createElement(Preview));
}

export async function renderClientPanel(kind){
  const details=kind==='details';
  const name=details?'ClientDetailsPanel':'ClientRegistrationForm';
  const raw=await readFile(new URL(details?'../app/client-details-panel.tsx':'../app/client-registration-form.tsx',import.meta.url),'utf8');
  const bindings={React,useState:React.useState,useRef:React.useRef,useId:React.useId,useEffect:React.useEffect,
    Building2,LoaderCircle,X,ArrowLeft,Check,Plus,Search,Trash2,...detailsModel,...registrationModel,...orderStatus,
    localStorage:{getItem:()=>null},RegistrationFeedbackPanel:()=>null};
  const js=compile(raw.replace(/^import[^\n]+\n/gm,'').replace('export function','function'));
  const Panel=new Function(...Object.keys(bindings),js+';return '+name+';')(...Object.values(bindings));
  return renderToStaticMarkup(React.createElement(Panel,{userId:2,sessionSellerId:7,sellerId:8,sellerName:'Representante 08',
    online:false,client:{...customers[0],RAZAOSOCIAL:'Mercado Central Ltda.',TIPPESSOA:'J'},orders:[],onClose(){},onCreated(){}}));
}

test('portfolio keeps a single create action, labeled filters, and native client buttons',()=>{
  const html=renderClients();
  assert.equal((html.match(/Novo cliente/g)||[]).length,1);
  assert.match(html,/clients-controls[\s\S]*aria-label="Buscar cliente por nome, código ou CPF\/CNPJ"[\s\S]*>Vendedor<\/span>/);
  assert.match(html,/<button type="button" class="client-card client-card-open" aria-label="Ver informações de Mercado Central"/);
  assert.match(html,/Cód. 101 · 11222333000181/);
  assert.match(html,/contato@mercado.example/);
  assert.match(html,/Tabela 4/);assert.match(html,/Sem tabela/);
  assert.doesNotMatch(html,/Grupo ICMS|Clientes e tabelas de preço respeitam/);
});
test('portfolio distinguishes loading, empty results and an empty portfolio',()=>{
  const pending=renderClients({isLoading:true});
  assert.match(pending,/role="status"[\s\S]*Carregando carteira/);
  assert.doesNotMatch(pending,/Mercado Central|2 clientes/);
  assert.match(renderClients({query:'inexistente',filtered:[]}),/Nenhum cliente encontrado\./);
  assert.match(renderClients({filtered:[]}),/Nenhum cliente nesta carteira\./);
});

test('client details retain the four tabs and the ICMS group, and registration keeps its four steps',async()=>{
  const details=await renderClientPanel('details');
  assert.equal((details.match(/role="tab"/g)||[]).length,4);
  assert.match(details,/Mercado Central[\s\S]*Cód. 101/);
  assert.match(details,/Grupo ICMS<\/dt><dd>2/);
  const registration=await renderClientPanel('registration');
  assert.match(registration,/Etapas do cadastro[\s\S]*Dados[\s\S]*Perfil[\s\S]*Contatos[\s\S]*Endereço/);
  assert.match(registration,/Fechar e limpar cadastro/);
  assert.doesNotMatch(registration,/Tipo de cadastro:|Etapa 1 de 4/);
});
