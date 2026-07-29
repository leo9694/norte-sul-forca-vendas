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
      items?: OrderItem[];
      observation?: string;
      dryRun?: boolean;
    };
    const partner = Number(body.partner);
    const operation = Number(body.operation);
    const items = body.items ?? [];

    if (!Number.isInteger(partner) || partner <= 0) throw new Error("Parceiro inválido.");
    if (operation !== 5) throw new Error("Nesta versão, somente a TOP 5 é permitida.");
    if (!items.length) throw new Error("Inclua ao menos um produto.");
    if (items.some((item) => !Number.isInteger(item.product) || item.quantity <= 0)) {
      throw new Error("Há itens com quantidade inválida.");
    }

    const partnerRows = await executeQuery(session, `
      SELECT P.CODPARC, P.CODVEND, E.CODEMP, E.GRUPOICMS, E.CODTAB,
             NVL((SELECT MAX(C.CODTIPVENDA) KEEP (DENSE_RANK LAST ORDER BY C.NUNOTA)
                   FROM TGFCAB C
                   WHERE C.CODPARC = P.CODPARC
                     AND C.CODTIPOPER = 5
                     AND C.CODVEND = ${session.sellerId}), 53) CODTIPVENDA
        FROM TGFPAR P
        JOIN TGFPAEM E ON E.CODPARC = P.CODPARC AND E.CODEMP = 1
       WHERE P.CODPARC = ${partner}
         AND P.CLIENTE = 'S'
         AND P.ATIVO = 'S'
         AND P.CODVEND = ${session.sellerId}
    `);
    const partnerData = partnerRows[0] as Record<string, unknown> | undefined;
    if (!partnerData?.CODTAB) throw new Error("Parceiro sem tabela no Grupo de ICMS da empresa 1.");

    const codtab = Number(partnerData.CODTAB);
    const productCodes = items.map((item) => item.product).join(",");
    const validRows = await executeQuery(session, `
      SELECT P.CODPROD,
             SUM(E.ESTOQUE - E.RESERVADO) DISPONIVEL,
             MAX(T.NUTAB) NUTAB
        FROM TGFPRO P
        JOIN TGFEST E ON E.CODPROD = P.CODPROD AND E.CODEMP = 1 AND E.ATIVO = 'S'
        JOIN TGFTAB T ON T.CODTAB = ${codtab} AND T.DTVIGOR <= TRUNC(SYSDATE)
       WHERE P.CODPROD IN (${productCodes})
         AND P.ATIVO = 'S' AND P.AD_MOBILIDADE = 'S'
       GROUP BY P.CODPROD
      HAVING SUM(E.ESTOQUE - E.RESERVADO) > 0
    `);
    const validMap = new Map(validRows.map((row) => [Number(row.CODPROD), row]));
    for (const item of items) {
      const current = validMap.get(item.product);
      if (!current) throw new Error(`Produto ${item.product} indisponível ou não habilitado para mobilidade.`);
      if (item.quantity > Number(current.DISPONIVEL)) {
        throw new Error(`Estoque insuficiente para o produto ${item.product}.`);
      }
      if (item.priceTable !== Number(current.NUTAB)) {
        throw new Error(`A tabela do produto ${item.product} mudou. Atualize o pedido.`);
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
          CODTIPVENDA: { $: String(partnerData.CODTIPVENDA || 53) },
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
          priceCode: codtab,
          negotiation: Number(partnerData.CODTIPVENDA || 53),
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
