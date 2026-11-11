import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { applyPromotions } from '../app/promotional-prices.ts';
import { refreshDraftPrices } from '../app/draft-prices.ts';
import { duplicateOrder } from '../app/order-duplication.ts';

test('promotion load normalizes the partner-group join and includes pricing metadata for products copied from old orders', async () => {
  const source = await readFile(new URL('../app/api/_lib/promotions.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const queries = [];
  const executeQuery = async (_session, sql) => {
    queries.push(sql);
    if (sql.startsWith('SELECT D.*')) return [{ NUPROMOCAO: 778, DTINICIAL: '08112026 00:00:00', DTFINAL: '30112027 00:00:00', GRUPODESCPARC: 'DESC379', GRUPODESCPROD: 'GOLDEN', PERCENTUAL: 15.59, CODEMP: 0 }];
    if (sql.includes('FROM TGFPAR P LEFT JOIN TGFCPL C')) return [{ CODPARC: 1193, GRUPODESCPARC: 'DESC379' }];
    if (sql.includes('FROM TGFPRO')) return [{ CODPROD: 100, GRUPODESCPROD: 'GOLDEN' }];
    if (sql.includes('FROM TGFTPV')) return [{ CODTIPVENDA: 37, DESCPROM: 'D' }];
    return [];
  };
  const load = new Function('executeQuery', 'readAllQueryRows', js.replace('export async function loadPromotions', 'return async function loadPromotions'))(executeQuery, (query, sql) => query(sql));
  const data = await load({ sellerId: 4 });
  const rules = queries[0];
  assert.match(rules, /UPPER\(TRIM\(D.GRUPODESCPARC\)\)=UPPER\(TRIM\(C.GRUPODESCPARC\)\)\)/);
  assert.match(rules, /P.CODVEND=4 AND P.CLIENTE='S' AND P.ATIVO='S'/);
  assert.match(rules, /NVL\(D.CODPARC,0\)=0 OR D.CODPARC=P.CODPARC/);
  const products = queries.find(sql => sql.includes('FROM TGFPRO'));
  assert.doesNotMatch(products, /AD_MOBILIDADE|ATIVO=/);
  const cart = applyPromotions([{ CODPROD: 100, CODLOCAL: 1010101, CODVOL: 'UN', CONTROLE: '', VLRVENDA: 100, quantity: 5 }], data,
    { partner: 1193, company: 1, table: 4, negotiation: 37, date: '2026-11-09' });
  assert.equal(cart[0].promotionId, 778);
  assert.ok(Math.abs(cart[0].promotionalPrice - 84.41) < 1e-8);
});

test('1058 duplicate uses fresh table price and promotion without carrying the old 18.47% surcharge', async () => {
  const source = await readFile(new URL('../app/sales-app.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('sales-app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const walk = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onDuplicate' && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression?.getText(ast).includes('await saveDraft')) handler = node.initializer.expression;
    ts.forEachChild(node, walk);
  };
  walk(ast);
  assert.ok(handler);
  const js = ts.transpileModule(`const duplicate = ${handler.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events = [];
  const data = { rules: [{ NUPROMOCAO: 778, DTINICIAL: '01012020 00:00:00', DTFINAL: '31122999 00:00:00', GRUPODESCPARC: 'DESC379', GRUPODESCPROD: 'GOLDEN', PERCENTUAL: 15.59, CODEMP: 0 }],
    bands: [], products: [{ CODPROD: 1058, GRUPODESCPROD: 'GOLDEN' }], partners: [{ CODPARC: 1193, GRUPODESCPARC: 'DESC379' }], negotiations: [{ CODTIPVENDA: 37, DESCPROM: 'D' }], parameters: [], seller: 4, sellerGroup: '' };
  const original = { id: 'original', updatedAt:1, phase:'review', sellerId: 4, partner: { CODPARC: 1193 }, companyCode: 1, priceCode: 4, priceName:'Agro', negotiation: 37,
    cart: [{ CODPROD: 1058, CODLOCAL: 1010101, CODVOL: 'UN', CONTROLE: 'old lot', VLRVENDA: 3.79, quantity: 10, promotionalPrice: 3.79, promotionId: 778, adjustmentPercent: 18.47 }] };
  const draft = duplicateOrder(original, original.partner, 4, 'Vendedor');
  const api = async (url, options) => {
    assert.equal(options.cache, 'no-store');
    if (url.includes('order-prices')) { events.push('prices'); return { company:1,priceCode:4,priceName:'Agro',rows:[{CODEMP:1,CODTAB:4,CODPROD:1058,CODLOCAL:1010101,CONTROLE:' ',VLRVENDA:4.49,NUTAB:200}] }; }
    events.push('fetch'); assert.match(url, /seller=4/); return data;
  };
  let saved;
  const noop = () => {};
  const create = fetch => new Function('online', 'sellerId', 'offlineData', 'api', 'applyPromotions', 'saveDraft', 'setActiveDraft', 'setStartingPartner', 'setOrderSellerId', 'setOrderSellerName', 'sellerName', 'pushHistoryView', 'setScreen', 'setToast', 'refreshDraftPrices', js + '; return duplicate;')(
    true, 1, { promotions: { ...data, rules: [] } }, fetch, applyPromotions, async value => { saved = value; events.push('save'); }, noop, noop, noop, noop, 'Gestor', noop, noop, noop, refreshDraftPrices);
  await create(api)(draft);
  assert.deepEqual(events, ['prices', 'fetch', 'save']);
  assert.equal(saved.cart[0].promotionId, 778);
  assert.equal(saved.cart[0].VLRVENDA, 4.49);
  assert.equal(saved.cart[0].adjustmentPercent, 0);
  assert.equal(saved.cart[0].promotionalPrice.toFixed(2), '3.79');
  assert.equal((saved.cart[0].promotionalPrice * saved.cart[0].quantity).toFixed(2), '37.90');
  assert.equal(original.cart[0].adjustmentPercent, 18.47);
  saved = null;
  await assert.rejects(create(async () => { throw Error('Falha de consulta'); })(draft), /Falha de consulta/);
  assert.equal(saved, null);
});
