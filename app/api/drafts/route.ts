import { listDraftBackups, saveDraftBackup } from "../../../db/drafts";
import { canAnalyzeOtherSellers, requireSession } from "../_lib/sankhya";

function validDraft(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  const partner = draft.partner as Record<string, unknown> | undefined;
  return (
    /^[a-zA-Z0-9_-]{1,120}$/.test(String(draft.id || ""))
    && Number.isFinite(Number(draft.updatedAt))
    && Number(draft.updatedAt) > 0
    && Number.isInteger(Number(draft.sellerId))
    && Number(draft.sellerId) > 0
    && Boolean(partner)
    && Number.isInteger(Number(partner?.CODPARC))
    && Number(partner?.CODPARC) > 0
    && String(partner?.NOMEPARC || "").trim().length > 0
    && Array.isArray(draft.cart)
    && draft.cart.length <= 500
    && draft.cart.every((item) => {
      const product = item as Record<string, unknown>;
      return Number.isInteger(Number(product.CODPROD)) && Number(product.CODPROD) > 0
        && Number.isFinite(Number(product.quantity)) && Number(product.quantity) > 0;
    })
  );
}

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return Response.json({ rows: listDraftBackups(session.userId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível consultar os rascunhos salvos.";
    return Response.json(
      { error: message === "AUTH_REQUIRED" ? "Sessão expirada." : "Não foi possível consultar os rascunhos salvos." },
      { status: message === "AUTH_REQUIRED" ? 401 : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const body = await request.json() as { draft?: unknown };
    if (!validDraft(body.draft)) {
      return Response.json({ error: "Rascunho inválido." }, { status: 400 });
    }
    const encoded = JSON.stringify(body.draft);
    if (encoded.length > 2_000_000) {
      return Response.json({ error: "O rascunho excedeu o tamanho permitido." }, { status: 413 });
    }
    const sellerId = Number(body.draft.sellerId);
    if (sellerId !== session.sellerId && !(await canAnalyzeOtherSellers(session))) {
      return Response.json({ error: "Você não possui permissão para salvar este rascunho." }, { status: 403 });
    }
    saveDraftBackup(session.userId, body.draft);
    return Response.json({ saved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar o backup do rascunho.";
    return Response.json(
      { error: message === "AUTH_REQUIRED" ? "Sessão expirada." : "Não foi possível salvar o backup do rascunho." },
      { status: message === "AUTH_REQUIRED" ? 401 : 500 },
    );
  }
}
