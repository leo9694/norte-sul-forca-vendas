"use client";

export type OfflineRow = Record<string, string | number | null>;

export type OfflineSnapshot = {
  version: 1;
  syncedAt: number;
  seller: {
    user: string;
    userId: number;
    sellerId: number;
    sellerName: string;
  };
  clients: OfflineRow[];
  partnerCompanies?: OfflineRow[];
  orders: OfflineRow[];
  tables: OfflineRow[];
  negotiations: OfflineRow[];
  operations?: OfflineRow[];
  products: OfflineRow[];
  productGroups?: OfflineRow[];
};

const DB_NAME = "norte-sul-forca-vendas";
const STORE_NAME = "seller-snapshots";
const DRAFT_STORE_NAME = "seller-drafts";
const DRAFT_HISTORY_STORE = "draft-history";
const DB_VERSION = 3;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "seller.sellerId" });
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        database.createObjectStore(DRAFT_STORE_NAME, { keyPath: "sellerId" });
      }
      if (!database.objectStoreNames.contains(DRAFT_HISTORY_STORE)) {
        database.createObjectStore(DRAFT_HISTORY_STORE, { keyPath: ["sellerId", "draft.id", "draft.updatedAt"] })
          .createIndex("sellerId", "sellerId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir os dados offline."));
    request.onblocked = () => reject(new Error("Feche outras abas do app para atualizar o armazenamento offline."));
  });
}

let draftWriteQueue: Promise<void> = Promise.resolve();

export function saveOfflineDrafts<T>(sellerId: number, drafts: T[]) {
  const snapshot = structuredClone(drafts);
  const write = draftWriteQueue.then(() => writeOfflineDrafts(sellerId, snapshot));
  draftWriteQueue = write.catch(() => {});
  return write;
}

async function writeOfflineDrafts<T>(sellerId: number, drafts: T[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([DRAFT_STORE_NAME, DRAFT_HISTORY_STORE], "readwrite");
      drafts.forEach(draft => {
        const record = draft as { id?: string; updatedAt?: number; cart?: unknown[] };
        if (record.id && record.updatedAt && record.cart?.length) {
          transaction.objectStore(DRAFT_HISTORY_STORE).put({ sellerId, draft });
        }
      });
      transaction.objectStore(DRAFT_STORE_NAME).put({ sellerId, drafts, updatedAt: Date.now() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Não foi possível salvar os rascunhos offline."));
      transaction.onabort = () => reject(transaction.error ?? new Error("O salvamento dos rascunhos foi cancelado."));
    });
  } finally {
    database.close();
  }
}

export async function getOfflineDraftHistory<T>(sellerId: number): Promise<T[]> {
  const database = await openDatabase();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(DRAFT_HISTORY_STORE, "readonly")
        .objectStore(DRAFT_HISTORY_STORE).index("sellerId").getAll(sellerId);
      request.onsuccess = () => resolve(request.result.map(record => record.draft as T));
      request.onerror = () => reject(request.error ?? new Error("Não foi possível consultar o histórico local."));
    });
  } finally { database.close(); }
}

export async function getOfflineDrafts<T>(sellerId: number) {
  const database = await openDatabase();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(DRAFT_STORE_NAME, "readonly").objectStore(DRAFT_STORE_NAME).get(sellerId);
      request.onsuccess = () => {
        const drafts = (request.result as { drafts?: T[] } | undefined)?.drafts;
        resolve(Array.isArray(drafts) ? drafts : []);
      };
      request.onerror = () => reject(request.error ?? new Error("Não foi possível ler os rascunhos offline."));
    });
  } finally {
    database.close();
  }
}

export async function saveOfflineSnapshot(snapshot: OfflineSnapshot) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(snapshot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Não foi possível salvar a carga offline."));
      transaction.onabort = () => reject(transaction.error ?? new Error("A carga offline foi cancelada."));
    });
  } finally {
    database.close();
  }
}

export async function getOfflineSnapshot(sellerId: number) {
  const database = await openDatabase();
  try {
    return await new Promise<OfflineSnapshot | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(sellerId);
      request.onsuccess = () => resolve((request.result as OfflineSnapshot | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Não foi possível ler a carga offline."));
    });
  } finally {
    database.close();
  }
}

export async function getLatestOfflineSnapshot() {
  const database = await openDatabase();
  try {
    return await new Promise<OfflineSnapshot | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const snapshots = (request.result as OfflineSnapshot[])
          .filter((item) => item?.seller?.sellerId)
          .sort((left, right) => right.syncedAt - left.syncedAt);
        resolve(snapshots[0] ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error("Não foi possível ler os dados offline."));
    });
  } finally {
    database.close();
  }
}
