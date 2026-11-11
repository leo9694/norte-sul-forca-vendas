import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { adjustedUnitPrice, displayedAdjustment, manualAdjustmentFromDisplay } from '../app/promotional-prices.ts';

const golden = { CODPROD:1058, CODLOCAL:1010101, CONTROLE:' ', DESCRPROD:'Golden', CODVOL:'UN', VLRVENDA:4.49,
  promotionalPrice:4.49*(1-15.59/100), promotionId:778, adjustmentPercent:0, quantity:10 };

test('shows the promotion against the table price without changing any order value when the field is left unchanged', () => {
  assert.equal(displayedAdjustment(golden), '-15,59');
  assert.equal(adjustedUnitPrice(golden).toFixed(2),'3.79');
  assert.equal((adjustedUnitPrice(golden)*10).toFixed(2),'37.90');
  for (const value of ['-15,59','-15.59','', 'inválido','-100']) assert.equal(manualAdjustmentFromDisplay(golden,value), undefined);
  assert.equal(golden.adjustmentPercent,0);
});

test('editing the displayed percentage translates only the additional adjustment, so the promotion is not applied twice', () => {
  const adjusted = { ...golden, adjustmentPercent: manualAdjustmentFromDisplay(golden,'-20') };
  assert.equal(displayedAdjustment(adjusted),'-20');
  assert.ok(Math.abs(adjustedUnitPrice(adjusted)-golden.VLRVENDA*.8)<1e-8);
  assert.equal(manualAdjustmentFromDisplay(adjusted,'-15,59'),0);
  const added = { ...golden, adjustmentPercent:-5 };
  assert.equal(displayedAdjustment(added),'-19,81');
  assert.equal(manualAdjustmentFromDisplay(added,'-19,81'),undefined);
  const regular = { VLRVENDA:10, adjustmentPercent:0 };
  assert.ok(Math.abs(manualAdjustmentFromDisplay(regular,'10')-10)<1e-8);
  assert.equal(displayedAdjustment({ ...regular, adjustmentPercent:10 }), '10');
});

const source = await readFile(new URL('../app/sales-app.tsx',import.meta.url),'utf8');
const ast = ts.createSourceFile('sales-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const compile = code => ts.transpileModule(code,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
const fieldSource = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text==='OrderAdjustmentField');
const OrderAdjustmentField = new Function('React','displayedAdjustment',compile(fieldSource.getText(ast))+';return OrderAdjustmentField;')(React,displayedAdjustment);

test('percentage input renders the actual discount in both product selection and review', () => {
  for (const review of [false,true]) {
    const html = renderToStaticMarkup(React.createElement(OrderAdjustmentField,{item:golden,review,onEdit:()=>{}}));
    assert.match(html,/value="-15,59"/);
    assert.match(html,/aria-label="Desconto ou acréscimo percentual de Golden"/);
  }
});

test('review renders both unit prices, the discounted color class and an accessible remove button', () => {
  let row;
  const walk = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr)
      && attr.name.getText(ast)==='className' && attr.initializer?.getText(ast)==='"review-item"')
      && ts.isReturnStatement(node.parent)) row = node.parent.parent.parent;
    ts.forEachChild(node,walk);
  };
  walk(ast);
  assert.ok(row && ts.isArrowFunction(row));
  const js = compile(`const row = ${row.getText(ast)};`);
  const icon=()=>React.createElement('svg');
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
  const render = new Function('React','adjustedUnitPrice','money','cartItemTotal','Minus','Plus','Trash2','OrderAdjustmentField','setQuantity','setAdjustment','removeCartItem',js+';return row;')(
    React,adjustedUnitPrice,money,item=>adjustedUnitPrice(item)*item.quantity,icon,icon,icon,OrderAdjustmentField,()=>{},()=>{},()=>{});
  const html=renderToStaticMarkup(render(golden,0));
  assert.match(html,/<span title="Preço de tabela">R\$\s4,49<\/span>/);
  assert.doesNotMatch(html,/Tabela:/);
  assert.match(html,/class="review-discounted-price">Com desconto: R\$\s3,79 \/ UN/);
  assert.match(html,/aria-label="Remover Golden do carrinho"/);
  const regular=renderToStaticMarkup(render({...golden,promotionalPrice:undefined},0));
  assert.doesNotMatch(regular,/review-discounted-price|Com desconto/);
});

test('removing one line preserves other lines of the same product and does not mutate the prior cart', () => {
  const code=source.match(/const removeCartItem = [^\n]+/)[0];
  const sameProduct={...golden,quantity:2};
  const original=[golden,sameProduct,{...golden,CODPROD:1018}];
  let cart=original;
  const remove=new Function('setCart',compile(code)+';return removeCartItem;')(update=>{cart=update(cart);});
  remove(1);
  assert.equal(cart.length,2);
  assert.equal(cart[0],golden); assert.equal(cart[1].CODPROD,1018); assert.equal(original.length,3);
});

test('product card displays the final unit price above a smaller red table price', async () => {
  const flow = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text==='NewOrderV2');
  let row;
  const walk = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr)
      && attr.name.getText(ast)==='className' && attr.initializer?.getText(ast)==='"product-price"')) {
      for (let parent=node.parent; parent; parent=parent.parent) {
        if (ts.isArrowFunction(parent)) { row=parent; break; }
      }
    }
    ts.forEachChild(node,walk);
  };
  walk(flow);
  assert.ok(row);
  const js=compile(`const row = ${row.getText(ast)};`);
  const icon=()=>React.createElement('svg'), noop=()=>{};
  const render=new Function('React','promotionalProduct','adjustedUnitPrice','cartItemOf','quantityOf','money','setProductImagePreview','productImageUrl','Sprout','PackageCheck','openProductDetails','setQuantity','Minus','Plus','OrderAdjustmentField','setAdjustment',js+';return row;')(
    React,()=>golden,adjustedUnitPrice,()=>golden,()=>10,value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value),noop,()=>'/product.png',icon,icon,noop,noop,icon,icon,OrderAdjustmentField,noop);
  const html=renderToStaticMarkup(render(golden));
  assert.match(html,/<strong>R\$\s3,79<\/strong><small class="product-table-price">Tabela: R\$\s4,49<\/small>/);
  const css=await readFile(new URL('../app/globals.css',import.meta.url),'utf8');
  assert.match(css,/\.product-price \.product-table-price \{[^}]*color: #b13c35;[^}]*font-size: 9px/);
  assert.match(css,/\.review-unit-prices \{[^}]*font-size: 10px/);
});
