import {
  encodeSession,
  loginSankhya,
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
    const session = await loginSankhya(username.trim(), password);
    const encoded = await encodeSession(session);
    return Response.json(
      { ok: true, user: session.user },
      { headers: { "Set-Cookie": sessionCookieHeader(encoded) } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Falha ao entrar." },
      { status: 401 },
    );
  }
}
