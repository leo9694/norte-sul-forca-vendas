import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { groupDraftBackups } from '../app/draft-backup-model.ts';

const directory = await mkdtemp(path.join(tmpdir(), 'fv-backup-compaction-'));
const filename = path.join(directory, 'drafts.sqlite');
process.env.DRAFT_BACKUP_DATABASE_PATH = filename;
const source = (await readFile(new URL('../db/drafts.ts', import.meta.url), 'utf8')).replace('"../app/draft-backup-model"', JSON.stringify(new URL('../app/draft-backup-model.ts', import.meta.url).href));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { saveDraftBackup, listDraftBackups } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const make = (updatedAt, quantity = 2) => ({ id: 'draft-original', updatedAt, sellerId: 123, sellerName: 'Vendedora', phase: 'products', partner: { CODPARC: 3923, NOMEPARC: 'Cliente' }, cart: [{ CODPROD: 1, quantity, VLRVENDA: 10 }] });
listDraftBackups(999); // Inicializa a estrutura sem compactar os usuários dos testes abaixo.

test('legacy compaction removes only equivalent revisions and preserves meaningful and unreadable records', () => {
  const db = new DatabaseSync(filename);
  const insert = db.prepare('INSERT INTO draft_backup_history(owner_user_id,draft_id,updated_at,payload,backed_up_at,revision_key) VALUES(?,?,?,?,?,?)');
  for (let time = 1; time <= 100; time++) insert.run(1, 'draft-original', time, JSON.stringify({ ...make(time), phase: time % 2 ? 'header' : 'review' }), time, `legacy-${time}`);
  db.prepare('INSERT INTO draft_backup_versions(owner_user_id,draft_id,updated_at,payload,backed_up_at) VALUES(?,?,?,?,?)').run(1, 'draft-original', 101, JSON.stringify(make(101, 3)), 101);
  insert.run(1, 'broken', 1, 'NOT JSON', 1, 'preserve-unreadable');
  insert.run(2, 'other-user', 1, JSON.stringify({ ...make(1), id: 'other-user' }), 1, 'other-owner');
  const backups = listDraftBackups(1);
  assert.equal(backups.length, 2);
  assert.deepEqual(backups.map(b => b.total_units).sort(), [2, 3]);
  assert.equal(groupDraftBackups(backups).length, 1);
  assert.equal(groupDraftBackups(backups)[0].versions.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM draft_backup_history WHERE owner_user_id=1').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM draft_backup_versions WHERE owner_user_id=1').get().n, 0);
  assert.equal(db.prepare('SELECT payload FROM draft_backup_history WHERE revision_key=?').get('preserve-unreadable').payload, 'NOT JSON');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM draft_backup_history WHERE owner_user_id=2').get().n, 1);
  db.close();
});

test('repeated autosaves maintain one recoverable content, while item removal keeps the earlier version', () => {
  for (let time = 1; time <= 100; time++) saveDraftBackup(5, { ...make(time), phase: time % 2 ? 'header' : 'review' });
  const db = new DatabaseSync(filename);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM draft_backups WHERE owner_user_id=5').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM draft_backup_history WHERE owner_user_id=5').get().n, 1);
  assert.equal(listDraftBackups(5).length, 1);
  saveDraftBackup(5, make(101, 1));
  let groups = groupDraftBackups(listDraftBackups(5));
  assert.equal(groups.length, 1); assert.equal(groups[0].total_units, 1);
  assert.equal(groups[0].versions[0].total_units, 2);
  saveDraftBackup(5, { ...make(102), cart: [] });
  groups = groupDraftBackups(listDraftBackups(5));
  assert.equal(groups[0].total_units, 1); // Um formulário vazio não apaga a emergência.
  assert.ok(groups[0].versions.some(version => version.total_units === 2));
  db.close();
});

test('restoration keeps one backup lineage and still leaves explicit duplicated orders independent', () => {
  saveDraftBackup(10, make(1));
  saveDraftBackup(10, { ...make(2), id: 'restored-id', backupId: 'draft-original' });
  assert.equal(listDraftBackups(10).length, 1);
  assert.equal(listDraftBackups(10)[0].draft_id, 'draft-original');
  const db = new DatabaseSync(filename);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM draft_backups WHERE owner_user_id=10').get().n, 1);
  saveDraftBackup(10, { ...make(3), id: 'intentional-duplicate' });
  assert.equal(groupDraftBackups(listDraftBackups(10)).length, 2);
  db.close();
});
