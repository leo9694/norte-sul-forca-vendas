import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

type Registration = { owner: number; request_id: string; fingerprint: string; payload: string; partner_id: number | null; phase: string; lease_until: number };
let database: DatabaseSync | null = null;
function db() {
  if (database) return database;
  const filename = process.env.CLIENT_REGISTRATION_DATABASE_PATH || path.join(process.cwd(), 'data', 'client-registrations.sqlite');
  mkdirSync(path.dirname(filename), { recursive: true });
  database = new DatabaseSync(filename);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS client_registrations (
      owner INTEGER NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
      partner_id INTEGER, phase TEXT NOT NULL DEFAULT 'pending', lease_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY(owner,request_id)
    )`);
  return database;
}
const scope = (id: string) => createHash('sha256').update(`${process.env.SANKHYA_OM_BASE_URL || 'local'}:${id}`).digest('hex');
export function claimClientRegistration(owner: number, id: string, payload: unknown): Registration {
  const sql = db(), key = scope(id), text = JSON.stringify(payload), fingerprint = createHash('sha256').update(text).digest('hex');
  sql.exec('BEGIN IMMEDIATE');
  try {
    sql.prepare('INSERT OR IGNORE INTO client_registrations(owner,request_id,fingerprint,payload,updated_at) VALUES(?,?,?,?,?)').run(owner, key, fingerprint, text, Date.now());
    let record = sql.prepare('SELECT * FROM client_registrations WHERE owner=? AND request_id=?').get(owner, key) as Registration;
    if (record.phase !== 'done' && record.lease_until > Date.now()) throw new Error('REGISTRATION_BUSY');
    if (record.phase === 'creating' || record.phase === 'uncertain') throw new Error('REGISTRATION_UNCERTAIN');
    if (record.fingerprint !== fingerprint) {
      const oldData = JSON.parse(record.payload), newData = JSON.parse(text);
      delete oldData.contacts; delete newData.contacts;
      const onlyContactsChanged = record.phase === 'contacts' && record.partner_id && JSON.stringify(oldData) === JSON.stringify(newData);
      if (!onlyContactsChanged && (record.phase !== 'pending' || record.partner_id)) throw new Error('REGISTRATION_CHANGED');
      sql.prepare('UPDATE client_registrations SET fingerprint=?,payload=? WHERE owner=? AND request_id=?').run(fingerprint, text, owner, key);
      record = { ...record, fingerprint };
    }
    if (record.phase !== 'done') sql.prepare('UPDATE client_registrations SET lease_until=?,updated_at=? WHERE owner=? AND request_id=?').run(Date.now() + 10 * 60_000, Date.now(), owner, key);
    sql.exec('COMMIT');
    return record;
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
}
export function checkpointClientRegistration(owner: number, id: string, phase: string, partnerId?: number) {
  db().prepare('UPDATE client_registrations SET phase=?,partner_id=COALESCE(?,partner_id),updated_at=? WHERE owner=? AND request_id=?')
    .run(phase, partnerId ?? null, Date.now(), owner, scope(id));
}
export function releaseClientRegistration(owner: number, id: string) {
  db().prepare('UPDATE client_registrations SET lease_until=0,updated_at=? WHERE owner=? AND request_id=?').run(Date.now(), owner, scope(id));
}
