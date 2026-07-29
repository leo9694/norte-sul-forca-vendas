const SESSION_COOKIE = "fv_sankhya_session";
const encoder = new TextEncoder();

export type SankhyaSession = {
  jsessionid: string;
  user: string;
  expiresAt: number;
};

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuração ausente: ${name}`);
  return value;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env("SESSION_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signed));
}

export async function encodeSession(session: SankhyaSession) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(session)));
  return `${payload}.${await signature(payload)}`;
}

export async function decodeSession(cookie?: string | null) {
  if (!cookie) return null;
  const [payload, sentSignature] = cookie.split(".");
  if (!payload || !sentSignature || (await signature(payload)) !== sentSignature) return null;
  try {
    const session = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload)),
    ) as SankhyaSession;
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(value: string, maxAge = 60 * 60 * 8) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

function omUrl(module: "mge" | "mgecom", serviceName: string) {
  const configured = env("SANKHYA_OM_BASE_URL");
  const base = configured.replace(/\/mge\/?$/, "/");
  return `${base}${module}/service.sbr?serviceName=${encodeURIComponent(serviceName)}&outputType=json`;
}

async function parseSankhyaJson<T>(response: Response) {
  const bytes = await response.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);
  return JSON.parse(text) as T;
}

export async function loginSankhya(username: string, password: string) {
  const body = {
    serviceName: "MobileLoginSP.login",
    requestBody: {
      NOMUSU: { $: username },
      INTERNO: { $: password },
      KEEPCONNECTED: { $: "S" },
    },
  };
  const response = await fetch(omUrl("mge", body.serviceName), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await parseSankhyaJson<{
    status: string;
    statusMessage?: string;
    responseBody?: { jsessionid?: { $?: string } };
  }>(response);
  const jsessionid = result.responseBody?.jsessionid?.$;
  if (!response.ok || result.status !== "1" || !jsessionid) {
    throw new Error(result.statusMessage || "Usuário ou senha inválidos.");
  }
  return { jsessionid, user: username, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
}

export async function callSankhya(
  session: SankhyaSession,
  module: "mge" | "mgecom",
  serviceName: string,
  requestBody: unknown,
) {
  const response = await fetch(omUrl(module, serviceName), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `JSESSIONID=${session.jsessionid}`,
    },
    body: JSON.stringify({ serviceName, requestBody }),
  });
  const result = await parseSankhyaJson<{
    status: string;
    statusMessage?: string;
    responseBody?: Record<string, unknown>;
  }>(response);
  if (!response.ok || result.status !== "1") {
    throw new Error(result.statusMessage || "O Sankhya não concluiu a operação.");
  }
  return result;
}

export async function executeQuery(session: SankhyaSession, sql: string) {
  const result = await callSankhya(session, "mge", "DbExplorerSP.executeQuery", { sql });
  const responseBody = result.responseBody as {
    fieldsMetadata?: Array<{ name: string }>;
    rows?: unknown[][];
  };
  const fields = responseBody.fieldsMetadata?.map((field) => field.name) ?? [];
  return (responseBody.rows ?? []).map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index]])),
  );
}

export async function requireSession(request: Request) {
  const session = await decodeSession(readSessionCookie(request));
  if (!session) throw new Error("AUTH_REQUIRED");
  return session;
}
