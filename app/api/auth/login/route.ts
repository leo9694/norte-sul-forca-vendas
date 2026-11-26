import {
  createApplicationSession,
  encodeSession,
  sessionCookieHeader,
} from "../../_lib/sankhya";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json() as {
      username?: string;
      password?: string;
    };
    if (!username?.trim() || !password) {
      return Response.json({ error: "Informe usuário e senha." }, { status: 400 });
    }
    const session = await createApplicationSession(username.trim(), password);
    const encoded = await encodeSession(session);
    return Response.json(
      {
        ok: true,
        user: session.user,
        userId: session.userId,
        sellerId: session.sellerId,
        sellerName: session.sellerName,
        canAnalyzeSellers: session.canAnalyzeSellers,
      },
      { headers: { "Set-Cookie": sessionCookieHeader(encoded) } },
    );
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return Response.json({ error: "O Sankhya demorou para concluir o login. Tente novamente." }, { status: 504 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Falha ao entrar." },
      { status: 401 },
    );
  }
}
