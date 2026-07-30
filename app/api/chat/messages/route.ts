import { addMessage, listMessages } from "../../../../db/chat";
import { requireSession } from "../../_lib/sankhya";
import { sendChatPush } from "../_lib/push";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const id = new URL(request.url).searchParams.get("conversation") ?? "";
    const rows = await listMessages(id, session.userId);
    if (!rows) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
    return Response.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar as mensagens.";
    return Response.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const payload = await request.json() as { conversationId?: string; body?: string };
    const id = String(payload.conversationId || "");
    const body = String(payload.body || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!body) return Response.json({ error: "Digite uma mensagem." }, { status: 400 });
    const result = await addMessage(id, { id: session.userId, name: session.user }, body);
    if (!result) return Response.json({ error: "Conversa não encontrada." }, { status: 404 });
    await sendChatPush(result.recipientUserId, session.user, body, id);
    return Response.json({ message: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar a mensagem.";
    return Response.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}
