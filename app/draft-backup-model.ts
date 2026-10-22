type Draft = { id: string; backupId?: string; updatedAt: number; sellerId?: number; cart?: unknown[] };

export const draftBackupIdentity = (draft: Pick<Draft, 'id' | 'backupId'>) => draft.backupId || draft.id;

// O relógio, a etapa da tela e saldos de consulta não são novas versões do pedido.
export function draftBackupContent(draft: object): string {
  const transient = new Set(['DISPONIVEL', 'LOT_DISPONIVEL', 'ESTOQUE', 'RESERVADO', 'IMAGEM', 'DTFABRICACAO', 'DTVAL']);
  const normalize = (value: unknown, root = false): unknown => {
    if (Array.isArray(value)) return value.map(item => normalize(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([key, v]) =>
      v !== undefined && !transient.has(key) && !(root && ['id', 'backupId', 'updatedAt', 'phase', 'sellerName'].includes(key)),
    ).map(([key, v]) => [key, normalize(v)]));
  };
  return JSON.stringify(normalize(draft, true));
}

export function uniqueDraftRevisions<T extends Draft>(drafts: T[]): T[] {
  const unique = new Map<string, T>();
  for (const draft of drafts) {
    const key = `${draft.sellerId || 0}:${draftBackupIdentity(draft)}:${draftBackupContent(draft)}`;
    const previous = unique.get(key);
    if (!previous || draft.updatedAt > previous.updatedAt) unique.set(key, draft);
  }
  return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function groupDraftBackups<T extends { draft: Draft; updated_at: number; backed_up_at: number }>(rows: T[]): Array<T & { versions: T[] }> {
  const groups = new Map<string, Map<string, T>>();
  for (const row of rows) {
    if (!row.draft?.id || !row.draft.cart?.length) continue;
    const key = `${row.draft.sellerId || 0}:${draftBackupIdentity(row.draft)}`;
    const group = groups.get(key) || new Map<string, T>();
    const signature = draftBackupContent(row.draft), previous = group.get(signature);
    if (!previous || row.updated_at > previous.updated_at || (row.updated_at === previous.updated_at && row.backed_up_at > previous.backed_up_at)) group.set(signature, row);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const sorted = [...group.values()].sort((a, b) => b.updated_at - a.updated_at || b.backed_up_at - a.backed_up_at);
    return { ...sorted[0], versions: sorted.slice(1) };
  }).sort((a, b) => b.updated_at - a.updated_at);
}
