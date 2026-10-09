type Draft = { id: string; updatedAt: number };
type Entry<T> = { draft: T; removed?: boolean };

const prefix = (owner: number) => `norte-sul-vendas:draft-record:${owner}:`;

// Um registro por pedido evita que uma aba apague os pedidos criados em outra.
export function writeDraftRecord<T extends Draft>(storage: Storage, owner: number, draft: T, removed = false) {
  storage.setItem(`${prefix(owner)}${draft.id}`, JSON.stringify({ draft, removed }));
}

export function readDraftRecords<T extends Draft>(storage: Storage, owner: number) {
  const drafts: T[] = [];
  const removed = new Set<string>();
  const archived: T[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix(owner))) continue;
    try {
      const entry = JSON.parse(storage.getItem(key) || "null") as Entry<T> | null;
      if (!entry?.draft?.id) continue;
      if (entry.removed) {
        removed.add(entry.draft.id);
        archived.push(entry.draft);
      }
      else drafts.push(entry.draft);
    } catch { /* Um registro inválido não invalida os outros pedidos. */ }
  }
  return { drafts, removed, archived };
}
