import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

test('sent orders and drafts show the actual customer code before the name, with full text in the tooltip', async () => {
  const source = await readFile(new URL('../app/sales-app.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('sales-app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const labels = [];
  const walk = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr)
      && attr.name.getText(ast) === 'className' && attr.initializer?.getText(ast) === '"order-client"')) {
      labels.push(node.children.find(child => ts.isJsxElement(child) && child.openingElement.tagName.getText(ast) === 'strong'));
    }
    ts.forEachChild(node, walk);
  };
  walk(ast);
  assert.equal(labels.length, 2);
  for (const label of labels) {
    const js = ts.transpileModule(`const Label = () => ${label.getText(ast)};`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const code of [1193, '0101']) {
      const client = { CODPARC: code, NOMEPARC: 'Nilo & Filial' };
      const Label = new Function('React', 'draft', 'order', js + ';return Label;')(React, { partner: client }, client);
      const html = renderToStaticMarkup(React.createElement(Label));
      assert.equal(html, `<strong title="${code} - Nilo &amp; Filial">${code} - Nilo &amp; Filial</strong>`);
    }
  }
});
