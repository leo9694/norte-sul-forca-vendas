import test from 'node:test';
import assert from 'node:assert/strict';
import { draftBackupContent, groupDraftBackups, uniqueDraftRevisions } from '../app/draft-backup-model.ts';
import { duplicateOrder } from '../app/order-duplication.ts';

const make = (updatedAt = 1, quantity = 2) => ({ id: 'draft-1', sellerId: 123, sellerName: 'Vendedora', updatedAt, phase: 'products', partner: { CODPARC: 3923, NOMEPARC: 'Cliente' }, companyCode: 1, priceCode: 2, priceName: 'Tabela', negotiation: 23, operation: 5, observation: '', cart: [{ CODPROD: 1, quantity, VLRVENDA: 10, adjustmentPercent: -5, CODLOCAL: 1010101, CONTROLE: 'A', DISPONIVEL: 100 }] });
const row = draft => ({ draft_id: `${draft.id}-${draft.updatedAt}`, draft, updated_at: draft.updatedAt, backed_up_at: draft.updatedAt });

test('timestamps, screen phase, property order and stock do not create another revision', () => {
  const original = make();
  assert.equal(draftBackupContent(original), draftBackupContent({ ...make(100), phase: 'review', cart: [{ ...original.cart[0], DISPONIVEL: 50 }] }));
  assert.equal(draftBackupContent(original), draftBackupContent(Object.fromEntries(Object.entries(original).reverse())));
  assert.equal(uniqueDraftRevisions([original, make(100)]).length, 1);
});
test('meaningful product removals, quantities, notes, prices and discounts remain recoverable', () => {
  const original = make();
  for (const changed of [{ ...make(2, 1) }, { ...make(2), cart: [] }, { ...make(2), observation: 'Nova observação' },
    { ...make(2), cart: [{ ...original.cart[0], VLRVENDA: 11 }] }, { ...make(2), cart: [{ ...original.cart[0], adjustmentPercent: -10 }] }]) {
    assert.notEqual(draftBackupContent(original), draftBackupContent(changed));
    assert.equal(uniqueDraftRevisions([original, changed]).length, 2);
  }
});
test('recovery shows one card per order and merges cloud/local equivalent revisions', () => {
  const rows = [row(make(1)), row(make(2)), row(make(3, 3)), row({ ...make(4, 3), id: 'restored', backupId: 'draft-1' }), row({ ...make(5), id: 'another-order' })];
  const groups = groupDraftBackups(rows);
  assert.equal(groups.length, 2); // Dois pedidos reais, não agrupa apenas pelo cliente.
  const main = groups.find(group => group.draft.backupId === 'draft-1');
  assert.equal(main.draft.cart[0].quantity, 3); assert.equal(main.versions.length, 1);
  assert.equal(main.versions[0].draft.cart[0].quantity, 2);
  assert.equal(groupDraftBackups([row(make(1)), row({ ...make(2), cart: [] })])[0].draft.cart.length, 1);
});
test('explicit duplication creates an independent backup, not another revision of its source', () => {
  const source = { ...make(), backupId: 'original-root' };
  const copy = duplicateOrder(source, source.partner, 123, 'Vendedora');
  assert.equal(copy.backupId, undefined);
  assert.equal(groupDraftBackups([row(source), row(copy)]).length, 2);
});
