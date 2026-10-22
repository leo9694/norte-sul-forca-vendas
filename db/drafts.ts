import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { draftBackupContent } from "../app/draft-backup-model";

export type StoredDraftBackup = {
  draft_id: string;
  seller_id: number;
  seller_name: string;
  partner_id: number;
  partner_name: string;
  item_count: number;
  total_units: number;
  updated_at: number;
  backed_up_at: number;
  draft: Record<string, unknown>;
};

const dataDirectory = path.resolve(process.cwd(), "data");
const databasePath = process.env.DRAFT_BACKUP_DATABASE_PATH
  ? path.resolve(process.env.DRAFT_BACKUP_DATABASE_PATH)
  : path.join(dataDirectory, "draft-backups.sqlite");
let database: DatabaseSync | null = null;

function getDatabase() {
  if (database) return database;
  mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS draft_backups (
      owner_user_id INTEGER NOT NULL,
      draft_id TEXT NOT NULL,
      seller_id INTEGER NOT NULL,
      seller_name TEXT NOT NULL,
      partner_id INTEGER NOT NULL,
      partner_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      total_units REAL NOT NULL DEFAULT 0,
      recovery_payload TEXT,
      recovery_item_count INTEGER NOT NULL DEFAULT 0,
      recovery_total_units REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      backed_up_at INTEGER NOT NULL,
      PRIMARY KEY (owner_user_id, draft_id)
    );
    CREATE INDEX IF NOT EXISTS draft_backups_owner_updated
      ON draft_backups (owner_user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS draft_backup_versions (
      owner_user_id INTEGER NOT NULL,
      draft_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      backed_up_at INTEGER NOT NULL,
      PRIMARY KEY (owner_user_id, draft_id, updated_at)
    );
    CREATE TABLE IF NOT EXISTS draft_backup_history (
      owner_user_id INTEGER NOT NULL,
      draft_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      backed_up_at INTEGER NOT NULL,
      revision_key TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, draft_id, revision_key)
    );
  `);
  return database;
}

function draftDetails(draft: Record<string, unknown>) {
  const partner = draft.partner as Record<string, unknown>;
  const cart = draft.cart as Array<Record<string, unknown>>;
  return {
    draftId: String(draft.backupId || draft.id),
    sellerId: Number(draft.sellerId),
    sellerName: String(draft.sellerName || ""),
    partnerId: Number(partner.CODPARC),
    partnerName: String(partner.NOMEPARC),
    itemCount: cart.length,
    totalUnits: cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    updatedAt: Number(draft.updatedAt),
    payload: JSON.stringify(draft),
  };
}

const compactedOwners = new Set<number>();
const revisionKey = (draft: object) => createHash('sha256').update(draftBackupContent(draft)).digest('hex');

// Migra apenas cópias equivalentes. Toda versão com conteúdo diferente é preservada.
function compactHistory(ownerUserId: number) {
  if (compactedOwners.has(ownerUserId)) return;
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const history = db.prepare('SELECT * FROM draft_backup_history WHERE owner_user_id=?').all(ownerUserId);
    const legacy = db.prepare('SELECT * FROM draft_backup_versions WHERE owner_user_id=?').all(ownerUserId);
    const valid: Array<{ row: Record<string, unknown>; legacy: boolean; draftId: string; key: string }> = [];
    const unique = new Map<string, { draftId: string; key: string; payload: string; updatedAt: number; savedAt: number }>();
    for (const [rows, old] of [[history, false], [legacy, true]] as const) for (const row of rows) {
      try {
        const draft = JSON.parse(String(row.payload)) as Record<string, unknown>;
        const details = draftDetails(draft), key = revisionKey(draft);
        const mapKey = `${details.draftId}:${key}`, previous = unique.get(mapKey);
        if (!previous || details.updatedAt > previous.updatedAt) unique.set(mapKey, { draftId: details.draftId, key, payload: details.payload, updatedAt: details.updatedAt, savedAt: Number(row.backed_up_at) });
        valid.push({ row, legacy: old, draftId: details.draftId, key });
      } catch { /* Não apaga um registro que não conseguiu interpretar. */ }
    }
    const insert = db.prepare(`INSERT INTO draft_backup_history(owner_user_id,draft_id,updated_at,payload,backed_up_at,revision_key)
      VALUES(?,?,?,?,?,?) ON CONFLICT(owner_user_id,draft_id,revision_key) DO UPDATE SET
      updated_at=excluded.updated_at,payload=excluded.payload,backed_up_at=excluded.backed_up_at
      WHERE excluded.updated_at >= draft_backup_history.updated_at`);
    for (const item of unique.values()) insert.run(ownerUserId, item.draftId, item.updatedAt, item.payload, item.savedAt, item.key);
    for (const item of valid) {
      if (item.legacy) db.prepare('DELETE FROM draft_backup_versions WHERE owner_user_id=? AND draft_id=? AND updated_at=? AND payload=?')
        .run(ownerUserId, String(item.row.draft_id), Number(item.row.updated_at), String(item.row.payload));
      else if (item.row.revision_key !== item.key || item.row.draft_id !== item.draftId) db.prepare('DELETE FROM draft_backup_history WHERE owner_user_id=? AND draft_id=? AND revision_key=?')
        .run(ownerUserId, String(item.row.draft_id), String(item.row.revision_key));
    }
    db.exec('COMMIT'); compactedOwners.add(ownerUserId);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function saveDraftBackup(ownerUserId: number, draft: Record<string, unknown>) {
  const details = draftDetails(draft);
  const backedUpAt = Date.now();
  const db = getDatabase();
  compactHistory(ownerUserId);
  db.exec("BEGIN IMMEDIATE");
  try {
  const archive = (payload: string, updatedAt: number, savedAt: number) => {
    db.prepare(`INSERT INTO draft_backup_history
      (owner_user_id, draft_id, updated_at, payload, backed_up_at, revision_key)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_user_id,draft_id,revision_key) DO UPDATE SET
      payload=excluded.payload,updated_at=excluded.updated_at,backed_up_at=excluded.backed_up_at
      WHERE excluded.updated_at >= draft_backup_history.updated_at`)
      .run(ownerUserId, details.draftId, updatedAt, payload, savedAt,
        revisionKey(JSON.parse(payload)));
  };
  const previous = db.prepare(`SELECT payload, updated_at, backed_up_at FROM draft_backups
    WHERE owner_user_id = ? AND draft_id = ? AND item_count > 0`)
    .get(ownerUserId, details.draftId) as { payload: string; updated_at: number; backed_up_at: number } | undefined;
  if (previous) archive(previous.payload, previous.updated_at, previous.backed_up_at);
  // Preserva também edições atrasadas ou com o mesmo horário de outro aparelho.
  if (details.itemCount) archive(details.payload, details.updatedAt, backedUpAt);
  db.prepare(`
    INSERT INTO draft_backups (
      owner_user_id, draft_id, seller_id, seller_name, partner_id, partner_name,
      payload, item_count, total_units, recovery_payload, recovery_item_count,
      recovery_total_units, updated_at, backed_up_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_user_id, draft_id) DO UPDATE SET
      seller_id = excluded.seller_id,
      seller_name = excluded.seller_name,
      partner_id = excluded.partner_id,
      partner_name = excluded.partner_name,
      payload = excluded.payload,
      item_count = excluded.item_count,
      total_units = excluded.total_units,
      recovery_payload = CASE
        WHEN excluded.item_count > 0 THEN excluded.payload
        ELSE draft_backups.recovery_payload
      END,
      recovery_item_count = CASE
        WHEN excluded.item_count > 0 THEN excluded.item_count
        ELSE draft_backups.recovery_item_count
      END,
      recovery_total_units = CASE
        WHEN excluded.item_count > 0 THEN excluded.total_units
        ELSE draft_backups.recovery_total_units
      END,
      updated_at = excluded.updated_at,
      backed_up_at = excluded.backed_up_at
    WHERE excluded.updated_at >= draft_backups.updated_at
  `).run(
    ownerUserId, details.draftId, details.sellerId, details.sellerName,
    details.partnerId, details.partnerName, details.payload, details.itemCount,
    details.totalUnits, details.itemCount ? details.payload : null,
    details.itemCount, details.totalUnits, details.updatedAt, backedUpAt,
  );
  db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listDraftBackups(ownerUserId: number): StoredDraftBackup[] {
  compactHistory(ownerUserId);
  const rows = getDatabase().prepare(`
    SELECT draft_id, seller_id, seller_name, partner_id, partner_name,
           item_count, total_units, recovery_payload, recovery_item_count,
           recovery_total_units, payload, updated_at, backed_up_at
      FROM draft_backups
     WHERE owner_user_id = ?
     ORDER BY updated_at DESC
  `).all(ownerUserId) as Array<Record<string, string | number | null>>;

  const latest = rows.flatMap((row) => {
    try {
      const useRecovery = Number(row.item_count) === 0 && Number(row.recovery_item_count) > 0;
      const payload = String(useRecovery ? row.recovery_payload : row.payload);
      return [{
        draft_id: String(row.draft_id),
        seller_id: Number(row.seller_id),
        seller_name: String(row.seller_name),
        partner_id: Number(row.partner_id),
        partner_name: String(row.partner_name),
        item_count: Number(useRecovery ? row.recovery_item_count : row.item_count),
        total_units: Number(useRecovery ? row.recovery_total_units : row.total_units),
        updated_at: Number(row.updated_at),
        backed_up_at: Number(row.backed_up_at),
        draft: JSON.parse(payload) as Record<string, unknown>,
      }];
    } catch {
      return [];
    }
  });
  const versions = getDatabase().prepare(`
    SELECT draft_id, updated_at, payload, backed_up_at FROM draft_backup_versions WHERE owner_user_id = ?
    UNION
    SELECT draft_id, updated_at, payload, backed_up_at FROM draft_backup_history WHERE owner_user_id = ?
    ORDER BY updated_at DESC
  `).all(ownerUserId, ownerUserId) as Array<Record<string, string | number>>;
  const historical = versions.flatMap((row) => {
    try {
      const draft = JSON.parse(String(row.payload)) as Record<string, unknown>;
      const details = draftDetails(draft);
      if (latest.some((item) => item.draft_id === details.draftId && draftBackupContent(item.draft) === draftBackupContent(draft))) return [];
      return [{
        draft_id: `${details.draftId}-version-${revisionKey(draft).slice(0, 16)}`,
        seller_id: details.sellerId, seller_name: details.sellerName,
        partner_id: details.partnerId, partner_name: `${details.partnerName} · Versão anterior`,
        item_count: details.itemCount, total_units: details.totalUnits,
        updated_at: details.updatedAt, backed_up_at: Number(row.backed_up_at), draft,
      }];
    } catch { return []; }
  });
  return [...latest, ...historical];
}
