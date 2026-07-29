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

    const groupFilter = partnerData.GRUPOICMS == null
      ? "E.GRUPOICMS IS NULL"
      : `E.GRUPOICMS = ${Number(partnerData.GRUPOICMS)}`;
    const allowedTables = await executeQuery(session, `
      SELECT DISTINCT N.CODTAB
        FROM TGFPAEM E
        JOIN TGFNTA N ON N.CODTAB = E.CODTAB
       WHERE E.CODEMP = 1
         AND ${groupFilter}
         AND E.CODTAB = ${priceCode}
         AND N.ATIVO = 'S'
         AND NVL(N.AD_MOBILIDADE, 'N') = 'S'
    `);
    if (!allowedTables.length) throw new Error("Tabela não permitida para o Grupo de ICMS do cliente.");

    const validNegotiations = await executeQuery(session, `
      SELECT V.CODTIPVENDA
        FROM TGFTPV V
       WHERE V.CODTIPVENDA = ${negotiation}
         AND V.ATIVO = 'S'
         AND V.DHALTER = (
           SELECT MAX(V2.DHALTER)
             FROM TGFTPV V2
            WHERE V2.CODTIPVENDA = V.CODTIPVENDA
         )
    `);
    if (!validNegotiations.length) throw new Error("Tipo de negociação inválido ou inativo.");

    const productCodes = items.map((item) => item.product).join(",");
    const validRows = await executeQuery(session, `
      SELECT P.CODPROD, E.CODLOCAL, E.CONTROLE,
             SUM(E.ESTOQUE - E.RESERVADO) DISPONIVEL,
             MAX(T.NUTAB) NUTAB,
             MAX(PX.VLRVENDA) VLRVENDA
        FROM TGFPRO P
        JOIN TGFEST E ON E.CODPROD = P.CODPROD AND E.CODEMP = 1 AND E.ATIVO = 'S'
        JOIN TGFTAB T ON T.CODTAB = ${priceCode}
                     AND T.NUTAB = (
                       SELECT MAX(T2.NUTAB)
                         FROM TGFTAB T2
                        WHERE T2.CODTAB = ${priceCode}
                          AND T2.DTVIGOR <= TRUNC(SYSDATE)
                     )
        JOIN (
          SELECT X.CODPROD, MAX(X.VLRVENDA) VLRVENDA
            FROM TGFEXC X
           WHERE X.NUTAB = (
             SELECT MAX(T3.NUTAB)
               FROM TGFTAB T3
              WHERE T3.CODTAB = ${priceCode}
                AND T3.DTVIGOR <= TRUNC(SYSDATE)
           )
             AND X.VLRVENDA > 0
           GROUP BY X.CODPROD
        ) PX ON PX.CODPROD = P.CODPROD
       WHERE P.CODPROD IN (${productCodes})
         AND P.ATIVO = 'S' AND P.AD_MOBILIDADE = 'S'
         AND EXISTS (
           SELECT 1
             FROM TGFEXC X
            WHERE X.NUTAB = T.NUTAB
              AND X.CODPROD = P.CODPROD
              AND X.VLRVENDA > 0
         )
       GROUP BY P.CODPROD, E.CODLOCAL, E.CONTROLE
      HAVING SUM(E.ESTOQUE - E.RESERVADO) > 0
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
          CODEMP: { $: String(partnerData.CODEMP) },
          CODPARC: { $: String(partner) },
          CODTIPOPER: { $: "5" },
          CODTIPVENDA: { $: String(negotiation) },
          CODVEND: { $: String(session.sellerId) },
          CODNAT: { $: "0" },
          CODCENCUS: { $: "0" },
          CODPROJ: { $: "0" },
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
