import { canAnalyzeOtherSellers, executeQuery, requireSession } from "../../_lib/sankhya";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const id = Number(new URL(request.url).searchParams.get("nunota"));
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Pedido inválido." }, { status: 400 });
    const [header] = await executeQuery(session, `
      SELECT C.NUNOTA, C.CODPARC, P.NOMEPARC, P.CGC_CPF CGCCPF,
             C.CODEMP, C.CODTIPOPER, C.CODTIPVENDA, C.CODVEND,
             C.OBSERVACAO, TO_CHAR(C.DTNEG, 'YYYY-MM-DD') DTNEG,
             V.APELIDO, T.DESCRTIPVENDA
        FROM TGFCAB C JOIN TGFPAR P ON P.CODPARC = C.CODPARC
        LEFT JOIN TGFVEN V ON V.CODVEND = C.CODVEND
        LEFT JOIN TGFTPV T ON T.CODTIPVENDA = C.CODTIPVENDA AND T.DHALTER = C.DHTIPVENDA
       WHERE C.NUNOTA = ${id} AND C.TIPMOV = 'P' AND C.CODTIPOPER IN (5,6)
    `);
    if (!header) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    if (Number(header.CODVEND) !== session.sellerId && !(await canAnalyzeOtherSellers(session))) {
      return Response.json({ error: "Sem permissão para consultar este pedido." }, { status: 403 });
    }
    const items = await executeQuery(session, `
      SELECT I.CODPROD, P.DESCRPROD, P.REFERENCIA, I.CODVOL,
             I.CODLOCALORIG CODLOCAL, I.CONTROLE, I.NUTAB,
             I.QTDNEG, I.VLRUNIT, I.VLRTOT, NVL(I.VLRDESC,0) VLRDESC
        FROM TGFITE I JOIN TGFPRO P ON P.CODPROD = I.CODPROD
       WHERE I.NUNOTA = ${id} AND I.SEQUENCIA > 0 ORDER BY I.SEQUENCIA
    `);
    if (!items.length) return Response.json({ error: "Pedido sem itens para gerar o relatório." }, { status: 404 });
    return Response.json({ draft: {
      id: `pedido-${id}`, updatedAt: new Date(`${header.DTNEG}T12:00:00-04:00`).getTime(),
      sellerId: Number(header.CODVEND), sellerName: String(header.APELIDO || ""),
      phase: "review", partner: { CODPARC: Number(header.CODPARC), NOMEPARC: String(header.NOMEPARC), CGCCPF: header.CGCCPF },
      companyCode: Number(header.CODEMP), operation: Number(header.CODTIPOPER),
      priceCode: 0, priceName: "", negotiation: Number(header.CODTIPVENDA),
      negotiationName: String(header.DESCRTIPVENDA || ""), observation: String(header.OBSERVACAO || ""),
      cart: items.map(item => ({ ...item, quantity: Number(item.QTDNEG),
        VLRVENDA: Number(item.QTDNEG) > 0 ? (Number(item.VLRTOT) - Number(item.VLRDESC)) / Number(item.QTDNEG) : Number(item.VLRUNIT),
        adjustmentPercent: 0, DISPONIVEL: 0,
      })),
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "AUTH_REQUIRED";
    return Response.json({ error: unauthorized ? "Sessão expirada." : "Não foi possível consultar o relatório do pedido." }, { status: unauthorized ? 401 : 500 });
  }
}
