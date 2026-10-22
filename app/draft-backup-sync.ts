import { draftBackupContent, draftBackupIdentity } from './draft-backup-model';
type Draft = { id: string; backupId?: string; updatedAt: number; sellerId?: number; sellerName?: string };

// Confirma somente respostas de sucesso; falhas nunca removem pedidos locais.
export function createDraftBackupSync<T extends Draft>({ sessionSellerId, save, onProblem, now = Date.now }: {
  sessionSellerId: number;
  save: (draft: T) => Promise<unknown>;
  onProblem: (message: string) => void;
  now?: () => number;
}) {
  const synced = new Map<string, string>();
  const retries = new Map<string, { at: number; attempts: number }>();
  const denied = new Map<string, number>();
  let running = false;
  let stopped = false;
  let notified = false;

  return {
    stop() { stopped = true; },
    async sync(drafts: T[]) {
      if (running || stopped) return;
      running = true;
      // Ignora apenas na fila de backup; mantém o pedido e o vendedor locais.
      // Registros antigos sem vendedor pertencem ao dono da fila local.
      const eligible = drafts.filter(draft => Number(draft.sellerId ?? sessionSellerId) === sessionSellerId);
      const unique = new Map<string, T>();
      for (const draft of eligible) {
        const key = `${draftBackupIdentity(draft)}:${draft.sellerId ?? sessionSellerId}`;
        const previous = unique.get(key);
        if (!previous || draft.updatedAt > previous.updatedAt) unique.set(key, draft);
      }
      try {
        for (const [key, draft] of unique) {
          if (stopped) break;
          const permissionKey = key, content = draftBackupContent(draft);
          if (synced.get(key) === content || (retries.get(permissionKey)?.at ?? 0) > now() || (denied.get(permissionKey) ?? 0) > now()) continue;
          try {
            await save(draft);
            synced.set(key, content);
            retries.delete(permissionKey);
            denied.delete(permissionKey);
          } catch (error) {
            if (stopped) break;
            const status = Number((error as { status?: number })?.status);
            let message = "Backup na nuvem pendente. O pedido continua salvo neste aparelho; tentaremos novamente automaticamente.";
            if (status === 401 || status === 409) {
              stopped = true;
              message = "A sessão expirou ou mudou em outra aba. Seus rascunhos continuam neste aparelho. Entre novamente com o usuário que os criou para concluir o backup.";
            } else if (status === 403) {
              denied.set(permissionKey, now() + 10 * 60_000);
              message = `Backup sem permissão para o vendedor ${draft.sellerName || draft.sellerId}. O rascunho continua neste aparelho. Entre com o usuário responsável ou autorizado para sincronizar.`;
            } else {
              const attempts = (retries.get(permissionKey)?.attempts ?? 0) + 1;
              retries.set(permissionKey, { attempts, at: now() + Math.min(30_000 * 2 ** Math.min(attempts - 1, 5), 10 * 60_000) });
              if (status === 400 || status === 413) {
                denied.set(permissionKey, now() + 10 * 60_000);
                message = "Um rascunho não foi aceito pelo backup. Os dados continuam neste aparelho; revise o pedido antes de tentar novamente.";
              }
            }
            if (!notified || status === 401 || status === 409) { notified = true; onProblem(message); }
          }
        }
        if (!stopped && [...unique].every(([key, draft]) => synced.get(key) === draftBackupContent(draft))) {
          notified = false;
          onProblem("");
        }
      } finally { running = false; }
    },
  };
}
