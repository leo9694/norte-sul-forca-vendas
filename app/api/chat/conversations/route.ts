import { createConversation, listConversations } from "../../../../db/chat";
import { executeQuery, requireSession } from "../../_lib/sankhya";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return Response.json({ rows: await listConversations(session.userId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar as conversas.";
    return Response.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const payload = await request.json() as { recipientUserId?: number };
    const recipientUserId = Number(payload.recipientUserId || 0);
    if (!Number.isInteger(recipientUserId) || recipientUserId <= 0 || recipientUserId === session.userId) {
      return Response.json({ error: "Selecione outro usuário do Sankhya." }, { status: 400 });
    }
    const users = await executeQuery(session, `
      SELECT U.CODUSU, NVL(NULLIF(TRIM(U.NOMEUSUCPLT), ''), U.NOMEUSU) NOME
        FROM TSIUSU U
       WHERE U.CODUSU = ${recipientUserId}
    `);
    const recipient = users[0] as Record<string, unknown> | undefined;
    if (!recipient) return Response.json({ error: "Usuário do Sankhya não encontrado." }, { status: 404 });

    const conversation = await createConversation(
      { id: session.userId, name: session.user },
      { id: recipientUserId, name: String(recipient.NOME) },
    );
    return Response.json({ conversation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível iniciar a conversa.";
    return Response.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}
