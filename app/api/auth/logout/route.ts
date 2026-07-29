import {
  callSankhya,
  clearSessionCookieHeader,
  decodeSession,
  readSessionCookie,
} from "../../_lib/sankhya";

export async function POST(request: Request) {
  const session = await decodeSession(readSessionCookie(request));
  if (session) {
    await callSankhya(session, "mge", "MobileLoginSP.logout", {}).catch(() => null);
  }
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookieHeader() } },
  );
}
