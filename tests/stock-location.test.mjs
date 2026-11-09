import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { priceInheritanceCtes } from '../app/api/_lib/price-inheritance.ts';
import { allocateOrderLots } from '../app/stock-lots.ts';
import { applyPromotions, promotionUnitPrice } from '../app/promotional-prices.ts';

test('online catalog, groups and lots only query stock from location 1010101', async () => {
  const source = await readFile(new URL('../app/api/sankhya/data/route.ts', import.meta.url), 'utf8');
  const queries = source.match(/FROM TGFEST\s+WHERE[\s\S]*?GROUP BY/g) ?? [];
  assert.equal(queries.length, 2);
  for (const query of queries) assert.match(query, /AND CODLOCAL = 1010101/);
  assert.match(source, /JOIN TGFEST E[^`]*AND E.CODLOCAL = 1010101/);
  // A price defined for all locations remains valid for the selected stock.
  assert.match(source, /PR.CODLOCAL = E.CODLOCAL OR PR.CODLOCAL = 0/);
});

test('offline load filters the location before summing available stock', async () => {
  const source = await readFile(new URL('../app/api/sankhya/sync/route.ts', import.meta.url), 'utf8');
  assert.match(source, /FROM TGFEST\s+WHERE CODEMP IN[^`]*AND CODLOCAL = 1010101[^`]*GROUP BY CODEMP, CODPROD, CODLOCAL, CONTROLE/);
});

test('older offline loads cannot display other locations or mix companies', async () => {
  const source = await readFile(new URL('../app/sales-app.tsx', import.meta.url), 'utf8');
  const declaration = source.match(/const offlineProductMatchesCompany = [\s\S]*?;/)[0];
  const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const matches = company => new Function('companyCode', js + '; return offlineProductMatchesCompany;')(company);
  assert.equal(matches(8)({ CODEMP: 8, CODLOCAL: 1010101 }), true);
  assert.equal(matches(8)({ CODEMP: 8, CODLOCAL: 1010102 }), false);
  assert.equal(matches(8)({ CODEMP: 6, CODLOCAL: 1010101 }), false);
  assert.equal(matches(1)({ CODLOCAL: 1010101 }), true);
  assert.equal(matches(1)({ CODLOCAL: 1010102 }), false);
  assert.equal(matches(8)({ CODEMP: 8 }), false);
});

async function orderApi(location, quantity = 1, stockRows = null, promo = {}) {
  const source = await readFile(new URL('../app/api/sankhya/orders/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const queries = [], sent = [];
  const executeQuery = async (_session, sql) => {
    queries.push(sql);
    if (sql.includes('WITH ')) return stockRows ?? [{ CODPROD: 3799, AGRUPMIN: 1, CODLOCAL: 1010101, CONTROLE: '50355', DISPONIVEL: 3, NUTAB: 2602, VLRVENDA: 13.8 }];
    if (sql.includes('FROM TGFPAR P')) return [{ GRUPOICMS: 1 }];
    if (sql.includes('FROM TGFTOP')) return [{ DHALTER: '14102026 00:00:00' }];
    if (sql.includes('FROM TGFTPV')) return [{ DHALTER: '14102026 00:00:00' }];
    return [{ CODTAB: 8 }];
  };
  const POST = new Function('requireSession', 'executeQuery', 'canAnalyzeOtherSellers', 'callSankhya', 'priceInheritanceCtes', 'allocateOrderLots', 'loadPromotions', 'applyPromotions', 'promotionUnitPrice',
    js.replace('export async function POST', 'return async function POST'))(
      async () => ({ sellerId: 123 }), executeQuery, async () => false,
      async (...args) => { sent.push(args.at(-1)); return { responseBody: { pk: { NUNOTA: { $: '1234' } } } }; }, priceInheritanceCtes, allocateOrderLots,
      async () => ({ rules: [], bands: [], partners: [], products: [], negotiations: [], parameters: [], seller: 123, sellerGroup: '', ...promo.data }), applyPromotions, promotionUnitPrice);
  const response = await POST(new Request('http://local/api/sankhya/orders', {
    method: 'POST', body: JSON.stringify({ partner: 7212, company: 8, priceCode: 8, operation: 5, negotiation: 23,
      items: [{ product: 3799, quantity, location, control: '50355', unitPrice: 13.8, priceTable: 2602, volume: 'UN', ...promo.item }] }),
  }));
  return { response, body: await response.json(), queries, sent };
}

test('order submission rejects other stock locations before consulting or sending to Sankhya', async () => {
  for (const location of [1010102, 0, undefined]) {
    const result = await orderApi(location);
    assert.equal(result.response.status, 400);
    assert.match(result.body.error, /somente itens do local de estoque 1010101/);
    assert.equal(result.queries.length, 0);
    assert.equal(result.sent.length, 0);
  }
});

test('order validation only uses location 1010101 and sends this origin to Sankhya', async () => {
  const result = await orderApi(1010101);
  assert.equal(result.response.status, 200);
  assert.equal(result.sent[0].nota.itens.item[0].CODLOCALORIG.$, '1010101');
  assert.match(result.queries.find(sql => sql.includes('FROM TGFEST')), /AND CODLOCAL = 1010101/);
  const insufficient = await orderApi(1010101, 4);
  assert.equal(insufficient.response.status, 400);
  assert.match(insufficient.body.error, /Estoque insuficiente/);
  assert.equal(insufficient.sent.length, 0);
});

test('order submission includes separate lot lines in expiry order', async () => {
  const base = { CODPROD: 3799, AGRUPMIN: 1, CODLOCAL: 1010101, NUTAB: 2602, VLRVENDA: 13.8 };
  const result = await orderApi(1010101, 8, [
    { ...base, CONTROLE: '50355', DISPONIVEL: 20, DTVAL: '01122026 00:00:00' },
    { ...base, CONTROLE: 'soon', DISPONIVEL: 3, DTVAL: '01112026 00:00:00' },
  ]);
  assert.equal(result.response.status, 200);
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.sent[0].nota.itens.item.map(row => [row.CONTROLE.$, row.QTDNEG.$]), [['soon', '3'], ['50355', '5']]);
});

test('server verifies promotion against ERP rules and preserves promotional plus typed discounts across lot splitting', async () => {
  const promo = { data: { rules: [{ NUPROMOCAO:774, CODPROD:3799, CODEMP:8, DTINICIAL:'01012020 00:00:00', DTFINAL:'31122999 00:00:00', PERCENTUAL:25 }], negotiations:[{CODTIPVENDA:23,DESCPROM:'D'}] }, item: { promotionId:774, promotionalPrice:10.35, adjustmentPercent:-10 } };
  const result = await orderApi(1010101, 1, null, promo);
  assert.equal(result.response.status,200);
  const line = result.sent[0].nota.itens.item[0];
  assert.equal(line.VLRUNIT.$,'13.8'); assert.equal(line.NUPROMOCAO.$,'774');
  assert.ok(Math.abs(Number(line.PERCDESC.$)-32.5)<1e-8);
  assert.ok(Math.abs(Number(line.PERCDESCPROM.$)-25)<1e-8);
  assert.equal(line.PERCDESCDIGITADO.$,'10');
  for (const item of [{}, {promotionId:774,promotionalPrice:1}, {promotionId:775,promotionalPrice:10.35}, {promotionId:774,promotionalPrice:'invalid'}]) {
    const invalid = await orderApi(1010101,1,null,{data:promo.data,item});
    assert.equal(invalid.response.status,400); assert.equal(invalid.sent.length,0); assert.match(invalid.body.error,/promoção.*mudou/);
  }
});
