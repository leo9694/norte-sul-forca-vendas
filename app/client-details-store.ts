"use client";
import type { ClientDetails } from './client-details-model';

// Banco separado: não altera nem migra o armazenamento dos pedidos e rascunhos.
function openDetailsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('norte-sul-client-details', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('details');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Armazenamento indisponível.'));
  });
}
export async function readClientDetails(userId: number, sellerId: number, partnerId: number): Promise<ClientDetails | null> {
  const db = await openDetailsDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('details', 'readonly').objectStore('details').get([userId, sellerId, partnerId]);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveClientDetails(userId: number, sellerId: number, partnerId: number, data: ClientDetails) {
  const db = await openDetailsDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('details', 'readwrite');
      transaction.objectStore('details').put(data, [userId, sellerId, partnerId]);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
