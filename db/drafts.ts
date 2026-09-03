import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
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
  `);
  return database;
}

function draftDetails(draft: Record<string, unknown>) {
  const partner = draft.partner as Record<string, unknown>;
  const cart = draft.cart as Array<Record<string, unknown>>;
  return {
    draftId: String(draft.id),
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

export function saveDraftBackup(ownerUserId: number, draft: Record<string, unknown>) {
  const details = draftDetails(draft);
  const backedUpAt = Date.now();
  getDatabase().prepare(`
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
}

export function listDraftBackups(ownerUserId: number): StoredDraftBackup[] {
  const rows = getDatabase().prepare(`
    SELECT draft_id, seller_id, seller_name, partner_id, partner_name,
           item_count, total_units, recovery_payload, recovery_item_count,
           recovery_total_units, payload, updated_at, backed_up_at
      FROM draft_backups
     WHERE owner_user_id = ?
     ORDER BY updated_at DESC
     LIMIT 250
  `).all(ownerUserId) as Array<Record<string, string | number | null>>;

  return rows.flatMap((row) => {
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
}
