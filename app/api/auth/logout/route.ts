import {
  clearSessionCookieHeader,
} from "../../_lib/sankhya";

export async function POST() {
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookieHeader() } },
  );
}
