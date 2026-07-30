import {
  removePushSubscription,
  savePushSubscription,
} from "../../../../db/chat";
import { requireSession } from "../../_lib/sankhya";

type SubscriptionPayload = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
};

function validateSubscription(payload: SubscriptionPayload) {
  const endpoint = String(payload.endpoint || "");
  const p256dh = String(payload.keys?.p256dh || "");
  const auth = String(payload.keys?.auth || "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw new Error("Assinatura de notificação inválida.");
  }
  return {
    endpoint,
    expiration_time: payload.expirationTime == null ? null : Number(payload.expirationTime),
    p256dh,
    auth,
  };
}

export async function GET(request: Request) {
  try {
    await requireSession(request);
    return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível preparar as notificações.";
    return Response.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const subscription = validateSubscription(await request.json() as SubscriptionPayload);
    await savePushSubscription(session.userId, subscription);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível ativar as notificações.";
    return Response.json({ error: message }, {
      status: message === "AUTH_REQUIRED" ? 401 : message.includes("inválida") ? 400 : 500,
    });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession(request);
    const endpoint = String((await request.json() as { endpoint?: string }).endpoint || "");
    if (endpoint) await removePushSubscription(session.userId, endpoint);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível desativar as notificações.";
    return Response.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}
