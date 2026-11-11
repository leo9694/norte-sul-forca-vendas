import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { applyPromotions, promotionUnitPrice } from '../app/promotional-prices.ts';
import { duplicateOrder } from '../app/order-duplication.ts';
import { refreshDraftPrices } from '../app/draft-prices.ts';
const context = { partner: 10, company: 8, table: 4, negotiation: 23, date: '2026-11-09' };
const item = { CODPROD: 100, CODLOCAL: 1010101, CONTROLE: 'A', CODVOL: 'UN', VLRVENDA: 100, NUTAB: 123, quantity: 5, adjustmentPercent: -10 };
const rule = { NUPROMOCAO: 774, DTINICIAL: '09062026 00:00:00', DTFINAL: '30122026 00:00:00', PERCENTUAL: 25, CODEMP: 8, GRUPODESCPROD: 'DESC25', GRUPODESCPARC: '***************', GRUPODESCVEND: '***************' };
const dataset = (rules = [rule]) => ({ rules, bands: [], partners: [{ CODPARC: 10, GRUPODESCPARC: 'CLIENTE' }], products: [{ CODPROD: 100, GRUPODESCPROD: 'DESC25' }], negotiations: [{ CODTIPVENDA: 23, DESCPROM: 'D' }], parameters: [], seller: 20, sellerGroup: 'VENDEDOR' });

const goldenPromotion = () => ({ ...dataset([{ ...rule, NUPROMOCAO: 778, DTINICIAL: '08112026 00:00:00', DTFINAL: '30112027 00:00:00',
  CODPARC: 0, CODPROD: 0, CODEMP: 0, CODLOCAL: 0, CODTAB: null, GRUPODESCPARC: 'DESC379', GRUPODESCPROD: 'GOLDEN', PERCENTUAL: 15.59 }]),
  partners: [{ CODPARC: 1193, GRUPODESCPARC: 'DESC379' }], products: [{ CODPROD: 100, GRUPODESCPROD: 'GOLDEN' }], seller: 4 });
const goldenContext = { ...context, partner: 1193, company: 1 };

test('promotion 778 applies DESC379/GOLDEN in every company and keeps other groups at the table price', () => {
  const data = goldenPromotion();
  for (const company of [1, 8]) {
    const result = applyPromotions([item], data, { ...goldenContext, company });
    assert.equal(result[0].promotionId, 778);
    assert.ok(Math.abs(result[0].promotionalPrice - 84.41) < 1e-8);
    assert.equal(applyPromotions(result, data, { ...goldenContext, company }), result);
  }
  for (const changed of [ { ...data, partners: [{ CODPARC: 1193, GRUPODESCPARC: 'DESC380' }] }, { ...data, products: [{ CODPROD: 100, GRUPODESCPROD: 'OUTRO' }] } ]) {
    assert.equal(applyPromotions([item], changed, goldenContext)[0].promotionId, 0);
  }
});

test('ERP group padding and case differences cannot silently discard the customer/product/seller promotion', () => {
  const data = goldenPromotion();
  data.partners[0].GRUPODESCPARC = 'desc379        ';
  data.products[0].GRUPODESCPROD = 'GOLDEN         ';
  data.rules[0].GRUPODESCVEND = 'VENDEDOR       ';
  data.sellerGroup = 'vendedor';
  const result = applyPromotions([item], data, goldenContext);
  assert.equal(result[0].promotionId, 778);
  assert.ok(Math.abs(result[0].promotionalPrice - 84.41) < 1e-8);
});

test('duplicating the last order for 1193 applies current promotion without touching the original sent order', () => {
  const source = { id: 'sent-1193', updatedAt: 1, phase: 'review', partner: { CODPARC: 1193 }, cart: [item], companyCode: 1, priceCode: 4, priceName: 'Agro', negotiation: 23 };
  const original = structuredClone(source);
  const copy = duplicateOrder(source, source.partner, 4, 'Vendedor');
  copy.cart = applyPromotions(refreshDraftPrices(copy.cart,[{...item,CODEMP:1,CODTAB:4,CONTROLE:' '}],1,4,true), goldenPromotion(), goldenContext);
  assert.equal(copy.cart[0].promotionId, 778);
  assert.ok(Math.abs(promotionUnitPrice(copy.cart[0]) - 84.41) < 1e-8);
  assert.deepEqual(source, original);
});

test('applies the existing group/company percentage once and preserves base, quantity and typed adjustment', () => {
  const data = dataset(), cart = [item];
  const result = applyPromotions(cart, data, context);
  assert.equal(result[0].promotionalPrice, 75);
  assert.equal(result[0].VLRVENDA, 100);
  assert.equal(result[0].quantity, 5);
  assert.equal(result[0].adjustmentPercent, -10);
  assert.equal(promotionUnitPrice(result[0]) * .9, 67.5);
  assert.equal(applyPromotions(result, data, context), result);
  assert.equal(cart[0].promotionId, undefined);
});
test('never leaks discounts across customers, groups, companies, tables, sellers, locations, volumes or controls', () => {
  for (const override of [{ CODPARC: 11 }, { GRUPODESCPARC: 'OUTRO' }, { GRUPODESCPROD: 'OUTRO' }, { CODPROD: 101 }, { CODEMP: 1 }, { CODTAB: 2 }, { CODVEND: 21 }, { GRUPODESCVEND: 'OUTRO' }, { CODLOCAL: 10 }, { CODVOL: 'CX' }, { USADESCCTRL: 'S', CONTROLE: 'B' }]) {
    const result = applyPromotions([item], dataset([{ ...rule, ...override }]), context);
    assert.equal(result[0].promotionId, 0, JSON.stringify(override));
    assert.equal(result[0].promotionalPrice, 100);
  }
});
test('expired, future, deleted and disabled promotions remove stale discounts without losing draft items', () => {
  const discounted = applyPromotions([item], dataset(), context);
  for (const data of [dataset([]), dataset([{ ...rule, DTFINAL: '08112026 00:00:00' }]), dataset([{ ...rule, DTINICIAL: '10112026 00:00:00' }]), { ...dataset(), negotiations: [{ CODTIPVENDA: 23, DESCPROM: 'N' }] }]) {
    const result = applyPromotions(discounted, data, context);
    assert.equal(result.length, 1); assert.equal(result[0].promotionalPrice, 100); assert.equal(result[0].adjustmentPercent, -10);
  }
});
test('uses specificity/latest promotion or greatest discount according to ERP setting, never adds competing promotions', () => {
  const data = dataset([rule, { ...rule, NUPROMOCAO: 775, PERCENTUAL: 10, CODPARC: 10 }]);
  assert.equal(applyPromotions([item], data, context)[0].promotionalPrice, 90);
  data.parameters = [{ CHAVE: 'USAMAIDESCPROMO', LOGICO: 'S' }];
  assert.equal(applyPromotions([item], data, context)[0].promotionalPrice, 75);
  data.parameters = []; data.rules = [rule, { ...rule, NUPROMOCAO: 776, PERCENTUAL: 30 }];
  assert.equal(applyPromotions([item], data, context)[0].promotionId, 776);
});
test('quantity changes recalculate bands without compounding; fixed promotional price uses base-independent value', () => {
  const data = dataset([{ ...rule, USADESCQTD: 'S' }]);
  data.bands = [{ NUPROMOCAO: 774, QTDE: 5, PERCDESC: 10, TIPDESC: 'P' }, { NUPROMOCAO: 774, QTDE: 10, PERCDESC: 30, TIPDESC: 'P' }];
  let result = applyPromotions([item], data, context);
  assert.equal(result[0].promotionalPrice, 90);
  result = applyPromotions([{ ...result[0], quantity: 8 }], data, context);
  assert.equal(result[0].promotionalPrice, 70);
  result = applyPromotions([{ ...result[0], quantity: 1 }], data, context);
  assert.equal(result[0].promotionalPrice, 90);
  assert.equal(applyPromotions([item], dataset([{ ...rule, PERCENTUAL: 0, VLRVENDA: 55 }]), context)[0].promotionalPrice, 55);
});
test('duplicated order recomputes promotions for destination and does not mutate sent source', () => {
  const source = { id: 'sent-1', updatedAt: 1, phase: 'review', partner: { CODPARC: 10 }, cart: applyPromotions([item], dataset([{ ...rule, CODPARC: 10 }]), context), priceCode: 4, priceName: 'Tabela', companyCode: 8 };
  const copy = duplicateOrder(source, { CODPARC: 11 }, 20, 'Vendedor');
  copy.cart = applyPromotions(refreshDraftPrices(copy.cart,[{...item,CODEMP:8,CODTAB:4,CONTROLE:' '}],8,4,true), dataset([{ ...rule, CODPARC: 10 }]), { ...context, partner: 11 });
  assert.equal(copy.cart[0].promotionalPrice, 100);
  assert.equal(source.cart[0].promotionalPrice, 75);
  assert.notEqual(copy.id, source.id);
});
test('unsupported or invalid promotions block submission instead of silently inventing prices', () => {
  for (const override of [{ USADESCESP: 'S' }, { USADESCQTD: 'S' }, { PERCENTUAL: 100 }, { VLRDESC: 10 }]) assert.ok(applyPromotions([item], dataset([{ ...rule, ...override }]), context)[0].promotionError);
});

test('TOPs 5 and 6 do not use stale draft lots to obtain lot-specific promotions', () => {
  const data = dataset([{ ...rule, USADESCCTRL: 'S', CONTROLE: 'A' }]);
  for (const operation of [5, 6]) {
    assert.equal(applyPromotions([item], data, { ...context, operation })[0].promotionId, 0);
    assert.equal(applyPromotions([item], dataset(), { ...context, operation })[0].promotionId, 774);
  }
});
test('promotions endpoint authenticates and enforces seller permission before querying discounts', async () => {
  const source = await readFile(new URL('../app/api/sankhya/promotions/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const [expired, manager, seller, expected] of [[true,false,20,401], [false,false,21,403], [false,false,0,400], [false,false,20,200], [false,true,21,200]]) {
    let calls = 0;
    const GET = new Function('requireSession','canAnalyzeOtherSellers','loadPromotions', js.replace('export async function GET','return async function GET'))(async () => { if(expired) throw Error('AUTH_REQUIRED'); return { sellerId:20 }; }, async () => manager, async () => { calls++; return dataset(); });
    assert.equal((await GET(new Request(`http://local?seller=${seller}`))).status,expected);
    assert.equal(calls,expected===200?1:0);
  }
});
