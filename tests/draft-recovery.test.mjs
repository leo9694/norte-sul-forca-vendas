import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

test('decreasing quantity with zero stock preserves the remaining items', async () => {
  const source = await readFile(new URL('../app/sales-app.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const setQuantity =', source.indexOf('function NewOrderV2'));
  const code = source.slice(start, source.indexOf('  const quantityOf =', start));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let cart = [{ CODPROD: 1, CONTROLE: '', CODLOCAL: 0, quantity: 5 },
    { CODPROD: 2, CONTROLE: '', CODLOCAL: 0, quantity: 2 }];
  const setQuantity = new Function('setCart', `${js}; return setQuantity;`)(update => { cart = update(cart); });
  const product = { CODPROD: 1, CONTROLE: '', CODLOCAL: 0, DISPONIVEL: 0 };
  setQuantity(product, -1);
  assert.equal(cart[0].quantity, 4);
  assert.equal(cart.length, 2);
  setQuantity(product, 1);
  assert.equal(cart[0].quantity, 4);
  setQuantity(product, -4);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].CODPROD, 2);
});

test('backup retains recoverable products after partial removal and ignores late requests', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'fv-draft-recovery-'));
  process.env.DRAFT_BACKUP_DATABASE_PATH = path.join(folder, 'drafts.sqlite');
  const source = await readFile(new URL('../db/drafts.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { saveDraftBackup, listDraftBackups } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const make = (updatedAt, codes) => ({ id: 'draft-test', sellerId: 10, sellerName: 'Vendedora',
    partner: { CODPARC: 3923, NOMEPARC: 'Cliente teste' }, updatedAt,
    cart: codes.map(CODPROD => ({ CODPROD, quantity: 5 })) });
  saveDraftBackup(1, make(100, [1, 2, 3]));
  saveDraftBackup(1, make(200, [1, 3]));
  let backups = listDraftBackups(1);
  assert.equal(backups[0].item_count, 2);
  assert.ok(backups.some(row => row.draft.cart.length === 3));
  saveDraftBackup(1, make(150, [1]));
  assert.equal(listDraftBackups(1)[0].item_count, 2);
  assert.ok(listDraftBackups(1).some(row => row.draft.updatedAt === 150));
  saveDraftBackup(1, make(300, []));
  backups = listDraftBackups(1);
  assert.ok(backups.some(row => row.draft.cart.length === 3));
  assert.equal(backups[0].item_count, 2);
  assert.deepEqual(listDraftBackups(2), []);
  for (const codes of [[10], [11], [12]]) {
    saveDraftBackup(1, { ...make(400, codes), id: 'same-time' });
  }
  const concurrent = listDraftBackups(1).filter(row => row.draft.id === 'same-time');
  assert.deepEqual(concurrent.map(row => row.draft.cart[0].CODPROD).sort(), [10, 11, 12]);
});

test('individual local records survive another tab overwriting the legacy list and retain offline deletions for backup', async () => {
  const source = await readFile(new URL('../app/draft-journal.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { writeDraftRecord, readDraftRecords } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key),
    key: index => [...values.keys()][index], get length() { return values.size; } };
  const first = { id: 'first', updatedAt: 1, cart: [1, 2] };
  const second = { id: 'second', updatedAt: 2, cart: [3] };
  writeDraftRecord(storage, 1, first);
  writeDraftRecord(storage, 1, second);
  storage.setItem('norte-sul-vendas:drafts:1', '[]');
  assert.equal(readDraftRecords(storage, 1).drafts.length, 2);
  writeDraftRecord(storage, 1, first, true);
  assert.equal(readDraftRecords(storage, 1).drafts.length, 1);
  assert.deepEqual(readDraftRecords(storage, 1).archived[0].cart, [1, 2]);
  assert.equal(readDraftRecords(storage, 2).drafts.length, 0);
});

test('saving only closes the editor after persistence succeeds', async () => {
  const source = await readFile(new URL('../app/sales-app.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const saveAndClose =', source.indexOf('function NewOrderV2'));
  const code = source.slice(start, source.indexOf('  const sendOrder =', start));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let closed = false;
  let error = '';
  const make = save => new Function('onSaveDraft', 'currentDraft', 'onSaved', 'setError', `${js}; return saveAndClose;`)
    (save, () => ({ id: 'test' }), () => { closed = true; }, value => { error = value; });
  await make(async () => { throw new Error('quota'); })();
  assert.equal(closed, false);
  assert.ok(error);
  let confirm;
  const pending = make(() => new Promise(resolve => { confirm = resolve; }))();
  assert.equal(closed, false);
  confirm();
  await pending;
  assert.equal(closed, true);
});
