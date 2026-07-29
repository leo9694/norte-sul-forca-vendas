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
  orders: OfflineRow[];
  tables: OfflineRow[];
  negotiations: OfflineRow[];
  products: OfflineRow[];
};

const DB_NAME = "norte-sul-forca-vendas";
const STORE_NAME = "seller-snapshots";
const DB_VERSION = 1;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "seller.sellerId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir os dados offline."));
  });
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
