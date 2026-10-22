import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateOrder } from '../app/order-duplication.ts';

const source = () => ({
  id: 'original', updatedAt: 1000, phase: 'review', sellerId: 123, sellerName: 'Vendedor',
  partner: { CODPARC: 1, NOMEPARC: 'Cliente original', CODTAB: 4 }, companyCode: 1, operation: 6,
  priceCode: 4, priceName: 'Agro', negotiation: 53, negotiationName: 'Bonificação', observation: 'Observação original',
  cart: [{ CODPROD: 3799, CONTROLE: 'LOTE-A', CODLOCAL: 1010101, CODVOL: 'UN', VLRVENDA: 20, NUTAB: 100, quantity: 8, adjustmentPercent: -5 },
    { CODPROD: 3799, CONTROLE: 'LOTE-B', CODLOCAL: 1010101, CODVOL: 'UN', VLRVENDA: 20, NUTAB: 100, quantity: 2, adjustmentPercent: -5 }],
});
test('same-client duplicate has independent identity and copies all lines, adjustments and conditions', () => {
  const original = source(), snapshot = structuredClone(original);
  const copy = duplicateOrder(original, original.partner, 123, 'Vendedor');
  assert.notEqual(copy.id, original.id); assert.match(copy.id, /^draft-/);
  assert.ok(copy.updatedAt > original.updatedAt); assert.equal(copy.phase, 'header');
  for (const field of ['cart', 'partner', 'operation', 'companyCode', 'priceCode', 'priceName', 'negotiation', 'negotiationName', 'observation']) assert.deepEqual(copy[field], original[field]);
  copy.cart[0].quantity = 99; copy.partner.NOMEPARC = 'Alterado';
  assert.deepEqual(original, snapshot);
});
test('another client receives the complete copied order but cannot inherit the source company/table', () => {
  const original = source(), partner = { CODPARC: 2, NOMEPARC: 'Outro cliente', CODTAB: 63 };
  const copy = duplicateOrder(original, partner, 123, 'Vendedor');
  assert.deepEqual(copy.partner, partner); assert.equal(copy.companyCode, 0);
  assert.equal(copy.priceCode, 0); assert.equal(copy.priceName, '');
  assert.deepEqual(copy.cart, original.cart); assert.equal(copy.observation, original.observation);
  assert.equal(copy.operation, 6); assert.equal(copy.negotiation, 53);
  assert.notEqual(duplicateOrder(original, partner, 123, 'Vendedor').id, copy.id);
});
test('empty orders and invalid destination clients cannot create a copy', () => {
  const original = source();
  assert.throws(() => duplicateOrder({ ...original, cart: [] }, original.partner, 123, 'Vendedor'), /não possui itens/);
  assert.throws(() => duplicateOrder(original, { CODPARC: 0 }, 123, 'Vendedor'), /Selecione o cliente/);
});
