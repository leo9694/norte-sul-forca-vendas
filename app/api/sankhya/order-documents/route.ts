import { callSankhya, canAnalyzeOtherSellers, downloadSankhyaFile, executeQuery, requireSession, type SankhyaSession } from "../../_lib/sankhya";
import { normalizeOrderDocuments, publicDocumentError } from "../../_lib/order-documents.js";

type Row = Record<string, unknown>;

function positiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nfeKey(value: string | null) {
  const normalized = String(value || "").replace(/\D/g, "");
  return normalized.length === 44 ? normalized : "";
}

function documentKey(result: Record<string, unknown>) {
  const body = result.responseBody as Record<string, unknown> | undefined;
  const document = body?.documento as Record<string, unknown> | string | undefined;
  const boleto = body?.boleto as Record<string, unknown> | string | undefined;
  const value = typeof document === "object" ? document?.valor ?? document?.$ : document
    || (typeof boleto === "object" ? boleto?.valor ?? boleto?.$ : boleto);
  return typeof value === "object" && value ? String((value as Record<string, unknown>).$ || "").trim() : String(value || "").trim();
}

function validatedPdf(buffer: Uint8Array) {
  const prefix = new TextDecoder("windows-1252").decode(buffer.slice(0, 1024));
  const pdfOffset = prefix.indexOf("%PDF");
  if (pdfOffset >= 0) return { buffer: buffer.slice(pdfOffset), contentType: "application/pdf" };

  const text = new TextDecoder().decode(buffer).trim();
  const encodedPdf = text.match(/(?:base64,)?(JVBERi0[A-Za-z0-9+/=\s]+)/)?.[1]?.replace(/\s/g, "");
  if (encodedPdf) {
    try {
      const binary = atob(encodedPdf);
      const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      if (new TextDecoder().decode(decoded.slice(0, 4)) === "%PDF") return { buffer: decoded, contentType: "application/pdf" };
    } catch {
      // Segue para a mensagem padronizada de documento indisponível.
    }
  }
  throw new Error("DOCUMENT_NOT_AVAILABLE");
}

async function storedDanfe(session: SankhyaSession, nunota: number) {
  const lengthRows = await executeQuery(session, `
    SELECT DBMS_LOB.GETLENGTH(P.PDFDANFE) TAMANHO
      FROM TGFPDF P
     WHERE P.NUNOTA = ${nunota}
       AND P.TIPO = 'N'
       AND P.PDFDANFE IS NOT NULL
  `);
  const length = Number(lengthRows[0]?.TAMANHO || 0);
  if (!length) return null;
  const chunkSize = 2000;
  const chunks = await executeQuery(session, `
    SELECT X.NIVEL IDX,
           RAWTOHEX(DBMS_LOB.SUBSTR(P.PDFDANFE, ${chunkSize}, ((X.NIVEL - 1) * ${chunkSize}) + 1)) HEXPDF
      FROM (SELECT PDFDANFE FROM TGFPDF WHERE NUNOTA = ${nunota} AND TIPO = 'N' AND PDFDANFE IS NOT NULL AND ROWNUM = 1) P
      CROSS JOIN (SELECT LEVEL NIVEL FROM DUAL CONNECT BY LEVEL <= ${Math.ceil(length / chunkSize)}) X
     ORDER BY X.NIVEL
  `);
  const hex = chunks.sort((left, right) => Number(left.IDX) - Number(right.IDX)).map((item) => String(item.HEXPDF || "")).join("");
  return hex ? Uint8Array.from(hex.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) || []) : null;
}

async function storedBoleto(session: SankhyaSession, nunota: number) {
  try {
    return await downloadSankhyaFile(session, "mge", "download.mge", {
      fileName: `Repo://Sistema/boletos/boleto_${nunota}.pdf`,
      pkValues: JSON.stringify({ NUNOTA: nunota, TIPO: "N" }),
      tableName: "TGFPDF",
      entityName: "ArquivoPdf",
    });
  } catch {
    return null;
  }
}

async function noteByNunota(session: SankhyaSession, nunota: number) {
  const rows = await executeQuery(session, `
    SELECT C.NUNOTA, C.NUMNOTA, C.SERIENOTA, C.CODEMP, C.CODPARC, P.NOMEPARC,
           C.CODVEND, C.TIPMOV, C.VLRNOTA, C.DTNEG, C.STATUSNOTA, C.STATUSNFE,
           (SELECT MAX(N.CHAVENFE) FROM TGFNFE N WHERE N.NUNOTA = C.NUNOTA) CHAVENFE,
           CASE WHEN EXISTS (SELECT 1 FROM TGFNFE N WHERE N.NUNOTA = C.NUNOTA AND N.XML IS NOT NULL) THEN 'S' ELSE 'N' END POSSUIXML,
           (SELECT MIN(F.DTVENC) FROM TGFFIN F WHERE F.NUNOTA = C.NUNOTA) DTVENC
      FROM TGFCAB C
      JOIN TGFPAR P ON P.CODPARC = C.CODPARC
     WHERE C.NUNOTA = ${nunota}
  `);
  return rows[0] as Row | undefined;
}

async function resolveInvoice(session: SankhyaSession, requestedNunota: number, requestedKey: string) {
  if (requestedKey) {
    const rows = await executeQuery(session, `
      SELECT N.NUNOTA
        FROM TGFNFE N
       WHERE N.CHAVENFE = '${requestedKey}'
         AND ROWNUM = 1
    `);
    const invoiceNunota = Number(rows[0]?.NUNOTA || 0);
    return invoiceNunota ? noteByNunota(session, invoiceNunota) : undefined;
  }

  const requested = await noteByNunota(session, requestedNunota);
  if (!requested) return undefined;
  if (String(requested.TIPMOV) !== "P") return requested;

  const rows = await executeQuery(session, `
    SELECT * FROM (
      SELECT DISTINCT DEST.NUNOTA
        FROM TGFVAR V
        JOIN TGFCAB DEST ON DEST.NUNOTA = V.NUNOTA
       WHERE V.NUNOTAORIG = ${requestedNunota}
         AND DEST.TIPMOV <> 'P'
       ORDER BY DEST.NUNOTA DESC
    ) WHERE ROWNUM = 1
  `);
  const invoiceNunota = Number(rows[0]?.NUNOTA || 0);
  return invoiceNunota ? noteByNunota(session, invoiceNunota) : null;
}

async function assertPermission(session: SankhyaSession, requestedNunota: number, invoice: Row | null | undefined) {
  const requested = requestedNunota ? await noteByNunota(session, requestedNunota) : invoice;
  const sellerId = Number(requested?.CODVEND || invoice?.CODVEND || 0);
  if (!sellerId) throw new Error("NOT_FOUND");
  if (sellerId !== session.sellerId && !(await canAnalyzeOtherSellers(session))) throw new Error("FORBIDDEN");
}

async function financialTitles(session: SankhyaSession, invoiceNunota: number) {
  return executeQuery(session, `
    SELECT F.NUFIN, F.VLRDESDOB, F.DTVENC, F.DHBAIXA, F.VLRBAIXA,
           F.CODEMP, F.CODCTABCOINT, C.CODBCO, C.NURFEMODBOLETO,
           NVL(B.NOMEBCO, TO_CHAR(C.CODBCO)) NOMEBCO,
           'N' CANCELADO
      FROM TGFFIN F
      LEFT JOIN TSICTA C ON C.CODCTABCOINT = F.CODCTABCOINT
      LEFT JOIN TSIBCO B ON B.CODBCO = C.CODBCO
     WHERE F.NUNOTA = ${invoiceNunota}
     ORDER BY F.DTVENC, F.NUFIN
  `) as Promise<Row[]>;
}

async function danfe(session: SankhyaSession, nunota: number) {
  try {
    const result = await callSankhya(session, "mge", "ImpressaoNotasSP.imprimeDocumentos", {
      notas: { pedidoWeb: "false", gerarpdf: "true", ownerServiceCall: "CentralNotas", nota: [{ nuNota: nunota, tipoImp: 9 }] },
    });
    const key = documentKey(result);
    if (key) {
      const file = await downloadSankhyaFile(session, "mge", "visualizadorArquivos.mge", { hidemail: "S", download: "S", chaveArquivo: key });
      return validatedPdf(file.buffer);
    }
  } catch {
    // Algumas notas possuem apenas o DANFE já armazenado no TGFPDF.
  }
  const stored = await storedDanfe(session, nunota);
  if (!stored) throw new Error("DOCUMENT_NOT_AVAILABLE");
  return validatedPdf(stored);
}

async function boleto(session: SankhyaSession, invoiceNunota: number, nufin?: number) {
  try {
    const titles = await financialTitles(session, invoiceNunota);
    const selectedTitles = titles.filter((item) => (!nufin || Number(item.NUFIN) === nufin)
      && !item.DHBAIXA && Number(item.VLRBAIXA || 0) <= 0 && Number(item.CODCTABCOINT || 0) > 0);
    const title = selectedTitles[0];
    if (title) {
      const account = Number(title.CODCTABCOINT || 0);
      const bank = Number(title.CODBCO || 0);
      const company = Number(title.CODEMP || 0);
      const reports: Record<number, number> = { 1: 11, 237: 61, 341: 271, 422: 267, 748: 12, 756: 191 };
      const report = Number(title.NURFEMODBOLETO || reports[bank] || 0);
      if (account && bank && company && report) {
        const result = await callSankhya(session, "mge", "BoletoSP.buildPreVisualizacao", {
          configBoleto: {
            agrupamentoBoleto: "4", ordenacaoParceiro: "1", dupRenegociadas: false, gerarNumeroBoleto: false,
            codigoConta: String(bank), codBco: String(account), codEmp: String(company), nossoNumComecando: "",
            alterarTipoTitulo: false, tipoTitulo: "-1", bcoIgualConta: false, empIgualConta: false,
            reimprimir: true, tipoReimpressao: "S", registraConta: false, codigoRelatorio: report,
            codCtaBcoInt: "", boletoRapido: false, telaImpressaoBoleto: true,
            boleto: { binicial: "", bfinal: "" }, titulo: selectedTitles.map((item) => ({ $: Number(item.NUFIN) })),
          },
        });
        const key = documentKey(result);
        if (key) {
          const file = await downloadSankhyaFile(session, "mge", "visualizadorArquivos.mge", { chaveArquivo: key, download: "S" });
          return validatedPdf(file.buffer);
        }
      }
    }
  } catch {
    // Tenta abaixo o boleto que o Sankhya já armazenou para a nota.
  }
  try {
    const result = await callSankhya(session, "mge", "ImpressaoNotasSP.imprimeDocumentos", {
      notas: { pedidoWeb: "false", gerarpdf: "true", ownerServiceCall: "CentralNotas", nota: [{ nuNota: invoiceNunota, tipoImp: 3 }] },
    });
    const key = documentKey(result);
    if (key) {
      const file = await downloadSankhyaFile(session, "mge", "visualizadorArquivos.mge", { hidemail: "S", download: "S", chaveArquivo: key });
      return validatedPdf(file.buffer);
    }
  } catch {
    // Última tentativa: arquivo de boleto já armazenado no repositório do Sankhya.
  }
  const stored = await storedBoleto(session, invoiceNunota);
  if (!stored) throw new Error("DOCUMENT_NOT_AVAILABLE");
  return validatedPdf(stored.buffer);
}

async function xml(session: SankhyaSession, invoiceNunota: number) {
  const lengthRows = await executeQuery(session, `SELECT DBMS_LOB.GETLENGTH(N.XML) TAMANHO FROM TGFNFE N WHERE N.NUNOTA = ${invoiceNunota} AND N.XML IS NOT NULL AND ROWNUM = 1`);
  const length = Number(lengthRows[0]?.TAMANHO || 0);
  if (!length) throw new Error("DOCUMENT_NOT_AVAILABLE");
  const chunkSize = 3000;
  const chunks = await executeQuery(session, `
    SELECT X.NIVEL IDX, DBMS_LOB.SUBSTR(N.XML, ${chunkSize}, ((X.NIVEL - 1) * ${chunkSize}) + 1) XMLCHUNK
      FROM TGFNFE N
      CROSS JOIN (SELECT LEVEL NIVEL FROM DUAL CONNECT BY LEVEL <= ${Math.ceil(length / chunkSize)}) X
     WHERE N.NUNOTA = ${invoiceNunota}
       AND N.XML IS NOT NULL
     ORDER BY X.NIVEL
  `);
  const content = chunks.sort((left, right) => Number(left.IDX) - Number(right.IDX)).map((item) => String(item.XMLCHUNK || "")).join("");
  if (!content) throw new Error("DOCUMENT_NOT_AVAILABLE");
  return new TextEncoder().encode(content);
}

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const nunota = positiveInteger(url.searchParams.get("nunota"));
    const key = nfeKey(url.searchParams.get("key"));
    const action = String(url.searchParams.get("action") || "info").toLowerCase();
    if ((!nunota && !key) || !["info", "danfe", "xml", "boleto"].includes(action)) {
      return Response.json({ error: "Informe um pedido/nota e uma ação válidos." }, { status: 400 });
    }

    const invoice = await resolveInvoice(session, nunota, key);
    await assertPermission(session, nunota, invoice);
    if (invoice === undefined) return Response.json({ error: "Pedido ou nota não encontrado." }, { status: 404 });
    if (invoice === null) {
      return action === "info"
        ? Response.json(normalizeOrderDocuments(null))
        : Response.json({ error: "Pedido ainda não faturado." }, { status: 409 });
    }
    const invoiceNunota = Number(invoice.NUNOTA);

    if (action === "info") {
      return Response.json(normalizeOrderDocuments(invoice, await financialTitles(session, invoiceNunota)));
    }
    if (action === "danfe") {
      const file = await danfe(session, invoiceNunota);
      return new Response(file.buffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="danfe-${invoiceNunota}.pdf"`, "Cache-Control": "private, no-store" } });
    }
    if (action === "xml") {
      const file = await xml(session, invoiceNunota);
      return new Response(file, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="nfe-${invoiceNunota}.xml"`, "Cache-Control": "private, no-store" } });
    }

    const requestedNufin = url.searchParams.get("nufin");
    const nufin = requestedNufin ? positiveInteger(requestedNufin) : undefined;
    if (requestedNufin && !nufin) return Response.json({ error: "Título financeiro inválido." }, { status: 400 });
    const file = await boleto(session, invoiceNunota, nufin);
    return new Response(file.buffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="boleto-${nufin || invoiceNunota}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return Response.json({ error: "Sessão expirada." }, { status: 401 });
    if (message === "FORBIDDEN") return Response.json({ error: "Você não tem permissão para consultar este pedido." }, { status: 403 });
    if (message === "NOT_FOUND") return Response.json({ error: "Pedido ou nota não encontrado." }, { status: 404 });
    if (message === "DOCUMENT_NOT_AVAILABLE") return Response.json({ error: "Documento não disponível no Sankhya." }, { status: 409 });
    console.error("Falha ao consultar documentos do pedido.");
    return Response.json({ error: publicDocumentError() }, { status: 503 });
  }
}
