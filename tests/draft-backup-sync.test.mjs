import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftBackupSync } from '../app/draft-backup-sync.ts';
import { draftSessionConflict } from '../app/api/_lib/draft-session.ts';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const draft = { id: 'draft-1', updatedAt: 1, sellerId: 123, sellerName: 'Zenaide', partner: { CODPARC: 3923, NOMEPARC: 'Cliente' }, cart: [{ CODPROD: 1, quantity: 2 }] };
const failure = status => Object.assign(new Error('failure'), { status });

test('silently ignores another seller without requests, retries or local changes', async () => {
  let time = 0;
  const sent = [], warnings = [];
  const queue = createDraftBackupSync({ sessionSellerId: 123, now: () => time,
    save: async value => sent.push(value), onProblem: message => warnings.push(message) });
  const foreign = { ...draft, sellerId: 1, sellerName: 'NORTE SUL' };
  const original = structuredClone(foreign);
  for (time = 0; time <= 1200000; time += 5000) await queue.sync([foreign]);
  assert.deepEqual(sent, []);
  assert.deepEqual(warnings.filter(Boolean), []);
  assert.deepEqual(foreign, original);
});

test('backs up current seller and legacy drafts in a mixed queue, not foreign archived drafts', async () => {
  const sent = [], warnings = [];
  const queue = createDraftBackupSync({ sessionSellerId: 123, save: async value => sent.push(value.id), onProblem: message => warnings.push(message) });
  const pending = [draft, { ...draft, id: 'foreign-archived', sellerId: 1 }, { ...draft, id: 'legacy', sellerId: undefined }];
  const original = structuredClone(pending);
  await queue.sync(pending);
  await queue.sync(pending);
  assert.deepEqual(sent, ['draft-1', 'legacy']);
  assert.deepEqual(warnings.filter(Boolean), []);
  assert.deepEqual(pending, original);
  const ownQueue = createDraftBackupSync({ sessionSellerId: 1, save: async value => sent.push(value.id), onProblem: () => {} });
  await ownQueue.sync([pending[1]]);
  assert.equal(sent.at(-1), 'foreign-archived');
});

test('permission failures do not loop every 5s or block the other drafts', async () => {
  let time = 0;
  const sent = [], warnings = [];
  const queue = createDraftBackupSync({ sessionSellerId: 123, now: () => time, onProblem: message => warnings.push(message), save: async value => {
    sent.push(value.id);
    if (value.id === draft.id) throw failure(403);
  } });
  const pending = [structuredClone(draft), { ...draft, id: 'draft-2' }];
  const original = structuredClone(pending);
  await queue.sync(pending);
  for (time = 5000; time < 600000; time += 5000) await queue.sync(pending);
  assert.deepEqual(sent, ['draft-1', 'draft-2']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Zenaide/);
  assert.deepEqual(pending, original);
  await queue.sync([{ ...draft, updatedAt: 2 }]);
  assert.equal(sent.length, 3); // Rechecks permission after the cooldown, not every edit.
  assert.equal(warnings.length, 1);
});

test('temporary failures back off, retry successfully and confirm only successful versions', async () => {
  let time = 0, calls = 0;
  const warnings = [];
  const queue = createDraftBackupSync({ sessionSellerId: 123, now: () => time, onProblem: message => warnings.push(message), save: async () => {
    if (++calls <= 2) throw failure(500);
  } });
  await queue.sync([draft]);
  time = 5000; await queue.sync([draft]);
  assert.equal(calls, 1);
  await queue.sync([{ ...draft, updatedAt: 2 }]);
  assert.equal(calls, 1); // Continued typing must not defeat the retry backoff.
  time = 30000; await queue.sync([draft]);
  time = 35000; await queue.sync([draft]);
  assert.equal(calls, 2);
  time = 90000; await queue.sync([draft]);
  await queue.sync([draft]);
  assert.equal(calls, 3);
  assert.deepEqual(warnings.filter(Boolean).length, 1);
  assert.equal(warnings.at(-1), '');
  await queue.sync([{ ...draft, updatedAt: 2 }]);
  assert.equal(calls, 4);
});

test('session mismatch or expiry stops the queue without discarding any draft', async () => {
  for (const status of [401, 409]) {
    let calls = 0;
    const warnings = [];
    const queue = createDraftBackupSync({ sessionSellerId: 123, save: async () => { calls++; throw failure(status); }, onProblem: message => warnings.push(message) });
    await queue.sync([draft, { ...draft, id: 'draft-2' }]);
    await queue.sync([draft]);
    assert.equal(calls, 1);
    assert.match(warnings[0], /Entre novamente/);
  }
});

test('stopping the queue prevents late failures from updating another session', async () => {
  let reject;
  const warnings = [];
  const queue = createDraftBackupSync({ sessionSellerId: 123, save: () => new Promise((_resolve, fail) => { reject = fail; }), onProblem: message => warnings.push(message) });
  const pending = queue.sync([draft]);
  queue.stop();
  reject(failure(403));
  await pending;
  assert.deepEqual(warnings, []);
});

test('concurrent timer ticks do not send duplicate backups', async () => {
  let calls = 0, finish;
  const queue = createDraftBackupSync({ sessionSellerId: 123, save: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, onProblem: () => {} });
  const pending = queue.sync([draft, draft]);
  await queue.sync([draft]);
  assert.equal(calls, 1);
  finish();
  await pending;
  await queue.sync([draft]);
  assert.equal(calls, 1);
});

test('backend prevents a stale tab from reading or saving backups under a different account', async () => {
  const session = { userId: 116, sellerId: 123 };
  for (const headers of [{ 'X-FV-User-Id': '151' }, { 'X-FV-Seller-Id': '1' }]) {
    assert.equal(draftSessionConflict(new Request('http://local', { headers }), session).status, 409);
  }
  assert.equal(draftSessionConflict(new Request('http://local', { headers: { 'X-FV-User-Id': '116', 'X-FV-Seller-Id': '123' } }), session), null);
  assert.equal(draftSessionConflict(new Request('http://local'), session), null); // Compatibility with already installed clients.
});

test('backend still rejects unauthorized sellers and accepts authorized managers', async () => {
  const source = await readFile(new URL('../app/api/drafts/route.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/export async function /g, 'async function ');
  const factory = new Function('requireSession', 'canAnalyzeOtherSellers', 'saveDraftBackup', 'listDraftBackups', 'draftSessionConflict', js + '; return {POST, GET};');
  for (const authorized of [false, true]) {
    const saved = [];
    const api = factory(async () => ({ userId: 116, sellerId: 1 }), async () => authorized, (...args) => saved.push(args), () => [], draftSessionConflict);
    const request = headers => new Request('http://local', { method: 'POST', headers, body: JSON.stringify({ draft }) });
    const mismatch = await api.POST(request({ 'X-FV-User-Id': '151' }));
    assert.equal(mismatch.status, 409);
    assert.equal(saved.length, 0);
    const response = await api.POST(request({}));
    assert.equal(response.status, authorized ? 200 : 403);
    assert.equal(saved.length, authorized ? 1 : 0);
    if (authorized) assert.deepEqual(saved[0], [116, draft]);
  }
});
