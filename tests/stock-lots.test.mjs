import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateOrderLots, compareLotExpiry } from '../app/stock-lots.ts';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const item = { product: 3799, quantity: 8, location: 1010101, control: 'later', unitPrice: 13.8, priceTable: 2602, adjustmentPercent: -5, volume: 'UN' };
const lot = (control, available, date) => ({ CODPROD: 3799, CODLOCAL: 1010101, CONTROLE: control, DISPONIVEL: available, DTVAL: date, NUTAB: 2602, VLRVENDA: 13.8, AGRUPMIN: 1 });
const lots = [lot('later', 20, '01122026 00:00:00'), lot('soon', 3, '01112026 00:00:00'), lot('next', 4, '15/11/2026'), lot('undated', 99, null)];

test('allocates across successive expiry dates, not the largest or previously selected lot', () => {
  const before = structuredClone(lots), original = structuredClone(item);
  const result = allocateOrderLots([item], lots);
  assert.deepEqual(result.map(row => [row.control, row.quantity]), [['soon', 3], ['next', 4], ['later', 1]]);
  assert.equal(result.reduce((sum, row) => sum + row.quantity, 0), 8);
  assert.ok(result.every(row => row.adjustmentPercent === -5 && row.unitPrice === 13.8 && row.location === 1010101));
  assert.deepEqual(item, original);
  assert.deepEqual(lots, before);
});

test('uses undated lots last and handles date formats consistently', () => {
  assert.equal(compareLotExpiry({ DTVAL: '01112026 00:00:00' }, { DTVAL: '2026-11-01' }), 0);
  assert.ok(compareLotExpiry({ DTVAL: '15/11/2026' }, { DTVAL: null }) < 0);
  assert.deepEqual(allocateOrderLots([{ ...item, quantity: 30 }], lots).map(row => [row.control, row.quantity]), [['soon', 3], ['next', 4], ['later', 20], ['undated', 3]]);
});

test('only fails when aggregate stock is insufficient and never borrows another location', () => {
  assert.throws(() => allocateOrderLots([{ ...item, quantity: 4 }], [lots[1], { ...lots[0], CODLOCAL: 1010102 }]), /Estoque insuficiente/);
  assert.throws(() => allocateOrderLots([{ ...item, quantity: 127 }], lots), /Estoque insuficiente/);
});

test('duplicate product lines share the same remaining stock', () => {
  assert.throws(() => allocateOrderLots([{ ...item, quantity: 2 }, { ...item, quantity: 2 }], [lots[1]]), /Estoque insuficiente/);
  const result = allocateOrderLots([{ ...item, quantity: 2 }, { ...item, quantity: 2 }], lots);
  assert.deepEqual(result.map(row => [row.control, row.quantity]), [['soon', 2], ['soon', 1], ['next', 1]]);
});

test('preserves price and grouping validation instead of changing commercial totals silently', () => {
  assert.throws(() => allocateOrderLots([item], [{ ...lots[1], VLRVENDA: 99 }, lots[0]]), /preço/);
  assert.throws(() => allocateOrderLots([{ ...item, priceTable: 1 }], lots), /tabela/);
  assert.throws(() => allocateOrderLots([{ ...item, quantity: 7 }], lots.map(row => ({ ...row, AGRUPMIN: 5 }))), /múltiplos/);
  const result = allocateOrderLots([{ ...item, quantity: 10 }], [lot('soon', 6, '2026-11-01'), lot('later', 4, '2026-12-01')].map(row => ({ ...row, AGRUPMIN: 5 })));
  assert.deepEqual(result.map(row => row.quantity), [6, 4]);
});

test('the editor allows product totals greater than a single lot and preserves reductions', async () => {
  const source = await readFile(new URL('../app/sales-app.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const setQuantity =', source.indexOf('function NewOrderV2'));
  const js = ts.transpileModule(source.slice(start, source.indexOf('  const quantityOf =', start)), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let cart = [{ CODPROD: 3799, CODLOCAL: 1010101, CONTROLE: 'soon', VLRVENDA: 13.8, quantity: 3 }];
  const setQuantity = new Function('setCart', js + '; return setQuantity;')(update => { cart = update(cart); });
  const product = { ...cart[0], AGRUPMIN: 1, LOT_DISPONIVEL: 3, DISPONIVEL: 10 };
  setQuantity(product, 1);
  assert.equal(cart[0].quantity, 4);
  setQuantity({ ...product, DISPONIVEL: 0 }, -1);
  assert.equal(cart[0].quantity, 3);
});
