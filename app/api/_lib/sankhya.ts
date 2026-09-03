const SESSION_COOKIE = "fv_sankhya_session";
const encoder = new TextEncoder();
const SESSION_DURATION_HOURS = 12;
const SESSION_DURATION_SECONDS = SESSION_DURATION_HOURS * 60 * 60;
const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;
const TECHNICAL_SESSION_REUSE_MS = 15 * 60 * 1000;

export type SankhyaSession = {
  jsessionid: string;
  login: string;
  canAnalyzeSellers: boolean;
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

let cachedTechnicalSession: AuthenticatedSankhyaSession | null = null;
let cachedTechnicalSessionAt = 0;
let technicalLoginPromise: Promise<AuthenticatedSankhyaSession> | null = null;

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

function omResourceUrl(module: "mge" | "mgecom", resourcePath: string, sessionId: string, params: Record<string, string | number> = {}) {
  const configured = env("SANKHYA_OM_BASE_URL");
  const base = configured.replace(/\/mge\/?$/, "/");
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    mgeSession: sessionId,
  });
  return `${base}${module}/${resourcePath.replace(/^\/+/, "")}?${query}`;
}

export function sankhyaProductImageUrl(productCode: number) {
  const base = env("SANKHYA_OM_BASE_URL").replace(/\/mge\/?$/, "/mge/");
  return `${base}Produto@IMAGEM@CODPROD=${encodeURIComponent(String(productCode))}.dbimage`;
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

async function callSankhyaOnce(
  jsessionid: string,
  module: "mge" | "mgecom",
  serviceName: string,
  requestBody: unknown,
) {
  const response = await fetch(omUrl(module, serviceName, jsessionid), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `JSESSIONID=${jsessionid}`,
    },
    body: JSON.stringify({ serviceName, requestBody }),
  });
  const result = await parseSankhyaJson<{
    status: string;
    statusMessage?: string;
    responseBody?: Record<string, unknown>;
  }>(response);
  if (!response.ok || result.status !== "1") {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`SANKHYA_AUTH_REQUIRED: ${result.statusMessage || "Não autorizado."}`);
    }
    throw new Error(result.statusMessage || "O Sankhya não concluiu a operação.");
  }
  return result;
}

function isSankhyaAuthenticationError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /sankhya_auth_required|nao autorizado|sessao.*(?:expir|inval|nao foi reconhecida)|session.*expired|not authorized|authentication required|efetue.*login/.test(message);
}

async function getTechnicalSession(forceRefresh = false) {
  const reusable = cachedTechnicalSession
    && Date.now() - cachedTechnicalSessionAt < TECHNICAL_SESSION_REUSE_MS;
  if (!forceRefresh && reusable) return cachedTechnicalSession as AuthenticatedSankhyaSession;
  if (technicalLoginPromise) return technicalLoginPromise;

  technicalLoginPromise = loginSankhya(
    env("SANKHYA_ACCESS_USER"),
    env("SANKHYA_ACCESS_PASSWORD"),
  ).then((session) => {
    cachedTechnicalSession = session;
    cachedTechnicalSessionAt = Date.now();
    return session;
  }).finally(() => {
    technicalLoginPromise = null;
  });
  return technicalLoginPromise;
}

export async function callSankhya(
  session: SankhyaSession,
  module: "mge" | "mgecom",
  serviceName: string,
  requestBody: unknown,
) {
  try {
    return await callSankhyaOnce(session.jsessionid, module, serviceName, requestBody);
  } catch (error) {
    if (!isSankhyaAuthenticationError(error)) throw error;
    const renewedSession = await getTechnicalSession(true);
    session.jsessionid = renewedSession.jsessionid;
    return callSankhyaOnce(session.jsessionid, module, serviceName, requestBody);
  }
}

async function downloadSankhyaFileOnce(
  session: SankhyaSession,
  module: "mge" | "mgecom",
  resourcePath: string,
  params: Record<string, string | number>,
) {
  const response = await fetch(omResourceUrl(module, resourcePath, session.jsessionid, params), {
    headers: { Cookie: `JSESSIONID=${session.jsessionid}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("SANKHYA_AUTH_REQUIRED");
    throw new Error("O Sankhya não disponibilizou o arquivo solicitado.");
  }
  return {
    buffer: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

export async function downloadSankhyaFile(
  session: SankhyaSession,
  module: "mge" | "mgecom",
  resourcePath: string,
  params: Record<string, string | number>,
) {
  try {
    return await downloadSankhyaFileOnce(session, module, resourcePath, params);
  } catch (error) {
    if (!isSankhyaAuthenticationError(error)) throw error;
    const renewedSession = await getTechnicalSession(true);
    session.jsessionid = renewedSession.jsessionid;
    return downloadSankhyaFileOnce(session, module, resourcePath, params);
  }
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

function privilegedSellerAnalysisGroup(value: unknown) {
  const group = String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  return group === "diretoria" || group === "gerente" || group === "supervisor";
}

function supervisorSellerType(value: unknown) {
  const type = String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  return type === "s" || type === "supervisor";
}

export async function canAnalyzeOtherSellers(session: SankhyaSession) {
  const rows = await executeQuery(session, `
    SELECT G.NOMEGRUPO, V.TIPVEND
      FROM TSIUSU U
      LEFT JOIN TSIGRU G ON G.CODGRUPO = U.CODGRUPO
      LEFT JOIN TGFVEN V ON V.CODVEND = U.CODVEND
     WHERE U.CODUSU = ${session.userId}
  `);
  return rows.some((row) => privilegedSellerAnalysisGroup(row.NOMEGRUPO) || supervisorSellerType(row.TIPVEND));
}

export async function createApplicationSession(username: string, password: string) {
  const authenticatedUser = await loginSankhya(username, password);
  try {
    const technicalSession = await getTechnicalSession();
    const rows = await executeQuery(technicalSession as SankhyaSession, `
      SELECT U.CODUSU, U.NOMEUSU, U.NOMEUSUCPLT, U.CODVEND,
             U.CODGRUPO, G.NOMEGRUPO, V.APELIDO, V.ATIVO, V.TIPVEND
        FROM TSIUSU U
        LEFT JOIN TSIGRU G ON G.CODGRUPO = U.CODGRUPO
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
      login: username.trim(),
      canAnalyzeSellers: privilegedSellerAnalysisGroup(userData.NOMEGRUPO) || supervisorSellerType(userData.TIPVEND),
      user: String(userData.NOMEUSUCPLT || userData.NOMEUSU || username),
      userId: authenticatedUser.userId,
      sellerId,
      sellerName: String(userData.APELIDO || userData.NOMEUSU || username),
      expiresAt: Date.now() + SESSION_DURATION_MS,
    } satisfies SankhyaSession;
  } finally {
    await callSankhyaOnce(
      authenticatedUser.jsessionid,
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
  const technicalSession = await getTechnicalSession();
  return { ...session, jsessionid: technicalSession.jsessionid };
}
