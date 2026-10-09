import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshDraftPrices } from '../app/draft-prices.ts';
import { readFile } from 'node:fs/promises';

const item = { CODPROD: 3799, CODLOCAL: 1010101, CONTROLE: '50355', VLRVENDA: 11.8, NUTAB: 2236, quantity: 7, adjustmentPercent: -5 };
const price = { ...item, CODEMP: 8, CODTAB: 8, VLRVENDA: 13.8, NUTAB: 2602 };

test('refreshes the historical price from the load without losing quantity or adjustment', () => {
  const cart = [structuredClone(item)];
  const result = refreshDraftPrices(cart, [price], 8, 8);
  assert.equal(result[0].VLRVENDA, 13.8);
  assert.equal(result[0].NUTAB, 2602);
  assert.equal(result[0].quantity, 7);
  assert.equal(result[0].adjustmentPercent, -5);
  assert.equal(cart[0].VLRVENDA, 11.8);
  assert.equal(refreshDraftPrices(result, [price], 8, 8), result);
});

test('never takes a price from another company, table or lot and never removes unavailable items', () => {
  const cart = [item];
  for (const changed of [{ CODEMP: 6 }, { CODTAB: 63 }, { CONTROLE: 'other' }, { CODLOCAL: 9 }, { VLRVENDA: 0 }]) {
    assert.equal(refreshDraftPrices(cart, [{ ...price, ...changed }], 8, 8), cart);
  }
  assert.equal(refreshDraftPrices(cart, [], 8, 8), cart);
});

test('every price query restricts derived-table exceptions to the effective version', async () => {
  for (const file of ['data', 'sync', 'orders']) {
    const source = await readFile(new URL(`../app/api/sankhya/${file}/route.ts`, import.meta.url), 'utf8');
    const joins = source.match(/JOIN HERANCA_PRECOS H[^\n]*\n\s*AND \(T.NUTAB = H.NUTAB_FONTE OR H.ACEITA_HISTORICO = 'S'\)/g) ?? [];
    assert.equal(joins.length, file === 'data' ? 2 : 1);
  }
});
