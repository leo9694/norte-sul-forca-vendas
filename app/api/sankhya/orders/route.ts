import { callSankhya, executeQuery, requireSession } from "../../_lib/sankhya";

type OrderItem = {
  product: number;
  quantity: number;
  unitPrice: number;
  volume: string;
  location: number;
  control: string;
  priceTable: number;
};

function sankhyaDateTime(value: unknown) {
  const text = String(value ?? "").trim();
  const compact = text.match(/^(\d{2})(\d{2})(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (compact) return `${compact[1]}/${compact[2]}/${compact[3]} ${compact[4]}`;
  return text;
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const body = await request.json() as {
      partner?: number;
      operation?: number;
      negotiation?: number;
      priceCode?: number;
      items?: OrderItem[];
      observation?: string;
      dryRun?: boolean;
    };
    const partner = Number(body.partner);
    const operation = Number(body.operation);
    const negotiation = Number(body.negotiation);
    const priceCode = Number(body.priceCode);
    const items = body.items ?? [];

    if (!Number.isInteger(partner) || partner <= 0) throw new Error("Parceiro inválido.");
    if (operation !== 5) throw new Error("Nesta versão, somente a TOP 5 é permitida.");
    if (!Number.isInteger(negotiation) || negotiation <= 0) throw new Error("Selecione o tipo de negociação.");
    if (!Number.isInteger(priceCode) || priceCode <= 0) throw new Error("Selecione a tabela de preço.");
    if (!items.length) throw new Error("Inclua ao menos um produto.");
    if (items.some((item) => !Number.isInteger(item.product) || item.quantity <= 0)) {
      throw new Error("Há itens com quantidade inválida.");
    }

    const partnerRows = await executeQuery(session, `
      SELECT P.CODPARC, P.CODVEND, E.CODEMP, E.GRUPOICMS, E.CODTAB
        FROM TGFPAR P
        JOIN TGFPAEM E ON E.CODPARC = P.CODPARC AND E.CODEMP = 1
       WHERE P.CODPARC = ${partner}
         AND P.CLIENTE = 'S'
         AND P.ATIVO = 'S'
         AND P.CODVEND = ${session.sellerId}
    `);
    const partnerData = partnerRows[0] as Record<string, unknown> | undefined;
    if (!partnerData) throw new Error("Cliente fora da carteira ou sem cadastro na empresa 1.");

    const validOperations = await executeQuery(session, `
      SELECT O.CODTIPOPER, O.DHALTER, O.TIPMOV
        FROM TGFTOP O
       WHERE O.CODTIPOPER = 5
         AND O.DHALTER = (
           SELECT MAX(O2.DHALTER)
             FROM TGFTOP O2
            WHERE O2.CODTIPOPER = O.CODTIPOPER
         )
         AND O.TIPMOV = 'P'
    `);
    const operationData = validOperations[0] as Record<string, unknown> | undefined;
    if (!operationData) throw new Error("A TOP 5 não está configurada como Pedido de venda.");

    const allowedTables = await executeQuery(session, `
      SELECT DISTINCT N.CODTAB
        FROM TGFPAEM E
        JOIN TGFNTA N ON N.CODTAB = E.CODTAB
       WHERE E.CODEMP = 1
         AND E.CODPARC = ${partner}
         AND E.CODTAB = ${priceCode}
         AND N.ATIVO = 'S'
         AND NVL(N.AD_MOBILIDADE, 'N') = 'S'
    `);
    if (!allowedTables.length) throw new Error("Tabela de preço não cadastrada para este cliente na empresa 1.");

    const validNegotiations = await executeQuery(session, `
      SELECT V.CODTIPVENDA, V.DHALTER
        FROM TGFTPV V
       WHERE V.CODTIPVENDA = ${negotiation}
         AND V.ATIVO = 'S'
         AND V.DHALTER = (
           SELECT MAX(V2.DHALTER)
             FROM TGFTPV V2
            WHERE V2.CODTIPVENDA = V.CODTIPVENDA
         )
    `);
    const negotiationData = validNegotiations[0] as Record<string, unknown> | undefined;
    if (!negotiationData) throw new Error("Tipo de negociação inválido ou inativo.");

    const productCodes = items.map((item) => item.product).join(",");
    const validRows = await executeQuery(session, `
      WITH ESTOQUE AS (
        SELECT CODPROD, CODLOCAL, CONTROLE,
               SUM(ESTOQUE - RESERVADO) DISPONIVEL
          FROM TGFEST
         WHERE CODEMP = 1
           AND ATIVO = 'S'
           AND CODPROD IN (${productCodes})
         GROUP BY CODPROD, CODLOCAL, CONTROLE
        HAVING SUM(ESTOQUE - RESERVADO) > 0
      ),
      PRECOS AS (
        SELECT X.CODPROD, NVL(X.CODLOCAL, 0) CODLOCAL,
               NVL(TRIM(X.CONTROLE), ' ') CONTROLE,
               X.VLRVENDA, T.NUTAB, T.DTVIGOR
          FROM TGFEXC X
          JOIN TGFTAB T ON T.NUTAB = X.NUTAB
         WHERE T.CODTAB = ${priceCode}
           AND T.DTVIGOR <= TRUNC(SYSDATE)
           AND X.CODPROD IN (${productCodes})
      ),
      ITENS AS (
        SELECT P.CODPROD, E.CODLOCAL, E.CONTROLE, E.DISPONIVEL,
               PR.NUTAB, PR.VLRVENDA,
               ROW_NUMBER() OVER (
                 PARTITION BY P.CODPROD, E.CODLOCAL, NVL(TRIM(E.CONTROLE), ' ')
                 ORDER BY PR.DTVIGOR DESC, PR.NUTAB DESC,
                          CASE WHEN PR.CODLOCAL = E.CODLOCAL THEN 1 ELSE 0 END DESC,
                          CASE WHEN PR.CONTROLE = NVL(TRIM(E.CONTROLE), ' ') THEN 1 ELSE 0 END DESC
               ) RN
          FROM TGFPRO P
          JOIN ESTOQUE E ON E.CODPROD = P.CODPROD
          JOIN PRECOS PR ON PR.CODPROD = P.CODPROD
                         AND (PR.CODLOCAL = E.CODLOCAL OR PR.CODLOCAL = 0)
                         AND (PR.CONTROLE = NVL(TRIM(E.CONTROLE), ' ') OR PR.CONTROLE = ' ')
         WHERE P.ATIVO = 'S'
           AND P.AD_MOBILIDADE = 'S'
      )
      SELECT CODPROD, CODLOCAL, CONTROLE, DISPONIVEL, NUTAB, VLRVENDA
        FROM ITENS
       WHERE RN = 1
         AND VLRVENDA > 0
    `);
    const itemKey = (product: number, location: number, control: unknown) =>
      `${product}|${location}|${String(control ?? "").trim()}`;
    const validMap = new Map(validRows.map((row) => [
      itemKey(Number(row.CODPROD), Number(row.CODLOCAL), row.CONTROLE),
      row,
    ]));
    for (const item of items) {
      const current = validMap.get(itemKey(item.product, item.location, item.control));
      if (!current) throw new Error(`Produto ${item.product} indisponível ou não habilitado para mobilidade.`);
      if (item.quantity > Number(current.DISPONIVEL)) {
        throw new Error(`Estoque insuficiente para o produto ${item.product}.`);
      }
      if (item.priceTable !== Number(current.NUTAB)) {
        throw new Error(`A tabela do produto ${item.product} mudou. Atualize o pedido.`);
      }
      if (Math.abs(item.unitPrice - Number(current.VLRVENDA)) > 0.005) {
        throw new Error(`O preço do produto ${item.product} mudou. Atualize o pedido.`);
      }
    }

    const today = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Cuiaba",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date());

    const payload = {
      nota: {
        cabecalho: {
          NUNOTA: {},
          TIPMOV: { $: "P" },
          DTNEG: { $: today },
          DTENTSAI: { $: today },
          CODEMP: { $: String(partnerData.CODEMP) },
          CODPARC: { $: String(partner) },
          CODTIPOPER: { $: "5" },
          DHTIPOPER: { $: sankhyaDateTime(operationData.DHALTER) },
          CODTIPVENDA: { $: String(negotiation) },
          DHTIPVENDA: { $: sankhyaDateTime(negotiationData.DHALTER) },
          CODVEND: { $: String(session.sellerId) },
          CODNAT: { $: "1010000" },
          CODCENCUS: { $: "0" },
          CODPROJ: { $: "0" },
          CODMOEDA: { $: "0" },
          CIF_FOB: { $: "C" },
          TIPFRETE: { $: "N" },
          VLRFRETE: { $: "0" },
          OBSERVACAO: { $: (body.observation ?? "Pedido força de vendas").slice(0, 250) },
        },
        itens: {
          INFORMARPRECO: "True",
          item: items.map((item) => ({
            NUNOTA: {},
            CODPROD: { $: String(item.product) },
            QTDNEG: { $: String(item.quantity) },
            CODLOCALORIG: { $: String(item.location) },
            CONTROLE: { $: item.control || " " },
            CODVOL: { $: item.volume },
            NUTAB: { $: String(item.priceTable) },
            PERCDESC: { $: "0" },
            VLRUNIT: { $: String(item.unitPrice) },
            IGNOREDESCPROMOQTD: { $: "True" },
          })),
        },
      },
    };

    if (body.dryRun) {
      return Response.json({
        ok: true,
        validation: {
          partner,
          operation,
          company: Number(partnerData.CODEMP),
          groupIcms: Number(partnerData.GRUPOICMS || 0),
          priceCode,
          negotiation,
          operationDate: sankhyaDateTime(operationData.DHALTER),
          negotiationDate: sankhyaDateTime(negotiationData.DHALTER),
          nature: 1010000,
          seller: session.sellerId,
          products: items.length,
          status: "ready",
        },
      });
    }

    const result = await callSankhya(session, "mgecom", "CACSP.incluirNota", payload);
    const pk = (result.responseBody as { pk?: { NUNOTA?: { $?: string } } })?.pk;
    return Response.json({ ok: true, orderId: pk?.NUNOTA?.$ });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar o pedido.";
    return Response.json(
      { error: message === "AUTH_REQUIRED" ? "Sessão expirada." : message },
      { status: message === "AUTH_REQUIRED" ? 401 : 400 },
    );
  }
}
