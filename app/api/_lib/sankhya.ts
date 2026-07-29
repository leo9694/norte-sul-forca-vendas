const SESSION_COOKIE = "fv_sankhya_session";
const encoder = new TextEncoder();
const SESSION_DURATION_HOURS = 12;
const SESSION_DURATION_SECONDS = SESSION_DURATION_HOURS * 60 * 60;
const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;

export type SankhyaSession = {
  jsessionid: string;
  user: string;
  userId: number;
  sellerId: number;
  sellerName: string;
  expiresAt: number;
};

type AuthenticatedSankhyaSession = {
  jsessionid: string;
  user: string;
  userId: number;
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

export function sessionCookieHeader(value: string, maxAge = SESSION_DURATION_SECONDS) {
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

function omUrl(module: "mge" | "mgecom", serviceName: string, sessionId?: string) {
  const configured = env("SANKHYA_OM_BASE_URL");
  const base = configured.replace(/\/mge\/?$/, "/");
  const session = sessionId ? `&mgeSession=${encodeURIComponent(sessionId)}` : "";
  return `${base}${module}/service.sbr?serviceName=${encodeURIComponent(serviceName)}&outputType=json${session}`;
}

async function parseSankhyaJson<T>(response: Response) {
  const bytes = await response.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(bytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    const readable = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/^login/i.test(readable)) {
      throw new Error("A sessão do Sankhya não foi reconhecida pelo serviço solicitado.");
    }
    throw new Error(
      readable
        ? `O Sankhya retornou uma resposta inválida: ${readable.slice(0, 180)}`
        : "O Sankhya retornou uma resposta vazia ou inválida.",
    );
  }
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
    responseBody?: {
      jsessionid?: { $?: string };
      idusu?: { $?: string };
    };
  }>(response);
  const jsessionid = result.responseBody?.jsessionid?.$;
  const encodedUserId = result.responseBody?.idusu?.$?.replace(/\s/g, "");
  const userId = encodedUserId ? Number(atob(encodedUserId)) : 0;
  if (!response.ok || result.status !== "1" || !jsessionid || !Number.isInteger(userId) || userId <= 0) {
    throw new Error(result.statusMessage || "Usuário ou senha inválidos.");
  }
  return {
    jsessionid,
    user: username,
    userId,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
}

export async function callSankhya(
  session: SankhyaSession,
  module: "mge" | "mgecom",
  serviceName: string,
  requestBody: unknown,
) {
  const response = await fetch(omUrl(module, serviceName, session.jsessionid), {
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

export async function createApplicationSession(username: string, password: string) {
  const authenticatedUser = await loginSankhya(username, password);
  let technicalSession: AuthenticatedSankhyaSession | null = null;
  try {
    technicalSession = await loginSankhya(
      env("SANKHYA_ACCESS_USER"),
      env("SANKHYA_ACCESS_PASSWORD"),
    );
    const rows = await executeQuery(technicalSession as SankhyaSession, `
      SELECT U.CODUSU, U.NOMEUSU, U.NOMEUSUCPLT, U.CODVEND,
             V.APELIDO, V.ATIVO
        FROM TSIUSU U
        LEFT JOIN TGFVEN V ON V.CODVEND = U.CODVEND
       WHERE U.CODUSU = ${authenticatedUser.userId}
    `);
    const userData = rows[0] as Record<string, unknown> | undefined;
    const sellerId = Number(userData?.CODVEND || 0);
    if (!userData || !Number.isInteger(sellerId) || sellerId <= 0) {
      throw new Error("Seu usuário não possui um vendedor vinculado no cadastro do Sankhya.");
    }
    if (String(userData.ATIVO || "N") !== "S") {
      throw new Error("O vendedor vinculado ao seu usuário está inativo no Sankhya.");
    }
    return {
      jsessionid: technicalSession.jsessionid,
      user: String(userData.NOMEUSUCPLT || userData.NOMEUSU || username),
      userId: authenticatedUser.userId,
      sellerId,
      sellerName: String(userData.APELIDO || userData.NOMEUSU || username),
      expiresAt: Date.now() + SESSION_DURATION_MS,
    } satisfies SankhyaSession;
  } finally {
    await callSankhya(
      authenticatedUser as SankhyaSession,
      "mge",
      "MobileLoginSP.logout",
      {},
    ).catch(() => null);
  }
}

export async function requireSession(request: Request) {
  const session = await decodeSession(readSessionCookie(request));
  if (
    !session ||
    !Number.isInteger(session.userId) ||
    !Number.isInteger(session.sellerId) ||
    session.sellerId <= 0
  ) {
    throw new Error("AUTH_REQUIRED");
  }
  return session;
}
