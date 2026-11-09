import { requireSession, canAnalyzeOtherSellers } from '../../_lib/sankhya';
import { loadPromotions } from '../../_lib/promotions';
export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const seller = Number(new URL(request.url).searchParams.get('seller') || session.sellerId);
    if (!Number.isSafeInteger(seller) || seller <= 0) return Response.json({ error: 'Vendedor inválido.' }, { status: 400 });
    if (seller !== session.sellerId && !await canAnalyzeOtherSellers(session)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
    return Response.json(await loadPromotions(session, seller), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const auth = error instanceof Error && error.message === 'AUTH_REQUIRED';
    return Response.json({ error: auth ? 'Sessão expirada.' : 'Não foi possível atualizar os descontos promocionais. Tente novamente.' }, { status: auth ? 401 : 503 });
  }
}
