import { executeQuery, requireSession } from "../../_lib/sankhya";

const numeric = (value: string | null, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const safeSearch = (value: string | null) =>
  (value ?? "").replace(/[^a-zA-ZÀ-ÿ0-9 ._-]/g, "").slice(0, 50).toUpperCase();

const safeDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
};

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const search = safeSearch(url.searchParams.get("q"));

    if (kind === "orders") {
      const dateFrom = safeDate(url.searchParams.get("dateFrom"));
      const dateTo = safeDate(url.searchParams.get("dateTo"));
      const periodFilter = [
        dateFrom ? `AND C.DTNEG >= TO_DATE('${dateFrom}', 'DD/MM/YYYY')` : "",
        dateTo ? `AND C.DTNEG < TO_DATE('${dateTo}', 'DD/MM/YYYY') + 1` : "",
      ].join("\n");
      const rows = await executeQuery(session, `
        SELECT * FROM (
          SELECT C.NUNOTA, C.NUMNOTA, C.DTNEG, C.VLRNOTA, C.STATUSNOTA,
                 C.PENDENTE, C.CODPARC, P.NOMEPARC
           FROM TGFCAB C
            JOIN TGFPAR P ON P.CODPARC = C.CODPARC
           WHERE C.CODTIPOPER = 5 AND C.TIPMOV = 'P'
             AND C.CODVEND = ${session.sellerId}
             ${periodFilter}
           ORDER BY C.NUNOTA DESC
        ) WHERE ROWNUM <= 500
      `);
      return Response.json({
        rows,
        user: session.user,
        sellerId: session.sellerId,
        sellerName: session.sellerName,
      });
    }

    if (kind === "portfolio") {
      const rows = await executeQuery(session, `
        SELECT P.CODPARC, P.NOMEPARC, P.RAZAOSOCIAL, P.CGC_CPF AS CGCCPF,
               P.TELEFONE, P.EMAIL, P.CODVEND,
               E.CODEMP, E.GRUPOICMS, E.CODTAB
          FROM TGFPAR P
          LEFT JOIN TGFPAEM E ON E.CODPARC = P.CODPARC AND E.CODEMP = 1
         WHERE P.CLIENTE = 'S'
           AND P.ATIVO = 'S'
           AND P.CODVEND = ${session.sellerId}
         ORDER BY P.NOMEPARC
      `);
      return Response.json({ rows });
    }

    if (kind === "partners") {
      const filter = search
        ? `AND (UPPER(P.NOMEPARC) LIKE '%${search}%' OR TO_CHAR(P.CODPARC) LIKE '%${search}%')`
        : "";
      const rows = await executeQuery(session, `
        SELECT * FROM (
          SELECT P.CODPARC, P.NOMEPARC, P.CODVEND,
                 E.CODEMP, E.GRUPOICMS, E.CODTAB
            FROM TGFPAR P
            JOIN TGFPAEM E ON E.CODPARC = P.CODPARC AND E.CODEMP = 1
           WHERE P.CLIENTE = 'S' AND P.ATIVO = 'S' AND E.CODTAB IS NOT NULL
             AND P.CODVEND = ${session.sellerId}
                 ${filter}
           ORDER BY P.NOMEPARC
        ) WHERE ROWNUM <= 50
      `);
      return Response.json({ rows });
    }

    if (kind === "operation") {
      const rows = await executeQuery(session, `
        SELECT CODTIPOPER, DESCROPER, TIPMOV, DHALTER
          FROM TGFTOP
         WHERE CODTIPOPER = 5
           AND DHALTER = (SELECT MAX(T.DHALTER) FROM TGFTOP T WHERE T.CODTIPOPER = 5)
      `);
      return Response.json({ rows });
    }

    if (kind === "orderOptions") {
      const partner = numeric(url.searchParams.get("partner"));
      if (!partner) return Response.json({ error: "Selecione um cliente." }, { status: 400 });

      const partnerRows = await executeQuery(session, `
        SELECT P.CODPARC, P.NOMEPARC, E.CODEMP, E.GRUPOICMS, E.CODTAB,
               NVL((SELECT MAX(C.CODTIPVENDA) KEEP (DENSE_RANK LAST ORDER BY C.NUNOTA)
                      FROM TGFCAB C
                     WHERE C.CODPARC = P.CODPARC
                       AND C.CODTIPOPER = 5
                       AND C.CODVEND = ${session.sellerId}), 53) CODTIPVENDA
          FROM TGFPAR P
          JOIN TGFPAEM E ON E.CODPARC = P.CODPARC AND E.CODEMP = 1
         WHERE P.CODPARC = ${partner}
           AND P.CODVEND = ${session.sellerId}
           AND P.CLIENTE = 'S'
           AND P.ATIVO = 'S'
      `);
      const partnerData = partnerRows[0];
      if (!partnerData) return Response.json({ error: "Cliente fora da carteira ou sem cadastro na empresa 1." }, { status: 400 });

      const groupIcms = partnerData.GRUPOICMS;
      const groupFilter = groupIcms == null
        ? "E.GRUPOICMS IS NULL"
        : `E.GRUPOICMS = ${Number(groupIcms)}`;
      const tables = await executeQuery(session, `
        SELECT DISTINCT N.CODTAB, N.NOMETAB
          FROM TGFPAEM E
          JOIN TGFNTA N ON N.CODTAB = E.CODTAB
         WHERE E.CODEMP = 1
           AND ${groupFilter}
           AND E.CODTAB IS NOT NULL
           AND N.ATIVO = 'S'
           AND NVL(N.AD_MOBILIDADE, 'N') = 'S'
         ORDER BY N.NOMETAB
      `);
      const negotiations = await executeQuery(session, `
        SELECT V.CODTIPVENDA, V.DESCRTIPVENDA
          FROM TGFTPV V
         WHERE V.ATIVO = 'S'
           AND V.CODTIPVENDA > 0
           AND V.DHALTER = (
             SELECT MAX(V2.DHALTER)
               FROM TGFTPV V2
              WHERE V2.CODTIPVENDA = V.CODTIPVENDA
           )
         ORDER BY V.DESCRTIPVENDA
      `);
      return Response.json({ partner: partnerData, tables, negotiations });
    }

    if (kind === "productGroups") {
      const partner = numeric(url.searchParams.get("partner"));
      const priceCode = numeric(url.searchParams.get("priceCode"));
      if (!partner || !priceCode) {
        return Response.json({ error: "Selecione o cliente e a tabela de preço." }, { status: 400 });
      }
      const rows = await executeQuery(session, `
        SELECT DISTINCT G.CODGRUPOPROD, G.DESCRGRUPOPROD
          FROM TGFGRU G
          JOIN TGFPRO P ON P.CODGRUPOPROD = G.CODGRUPOPROD
          JOIN TGFEXC X ON X.CODPROD = P.CODPROD
          JOIN TGFTAB T ON T.NUTAB = X.NUTAB
         WHERE T.CODTAB = ${priceCode}
           AND T.NUTAB = (
             SELECT MAX(T2.NUTAB)
               FROM TGFTAB T2
              WHERE T2.CODTAB = ${priceCode}
                AND T2.DTVIGOR <= TRUNC(SYSDATE)
           )
           AND P.ATIVO = 'S'
           AND P.AD_MOBILIDADE = 'S'
           AND G.ATIVO = 'S'
           AND G.ANALITICO = 'S'
           AND EXISTS (
             SELECT 1
               FROM TGFPAR CL
              WHERE CL.CODPARC = ${partner}
                AND CL.CODVEND = ${session.sellerId}
                AND CL.CLIENTE = 'S'
                AND CL.ATIVO = 'S'
           )
         ORDER BY G.DESCRGRUPOPROD
      `);
      return Response.json({ rows });
    }

    if (kind === "products") {
      const partner = numeric(url.searchParams.get("partner"));
      const priceCode = numeric(url.searchParams.get("priceCode"));
      const productGroup = numeric(url.searchParams.get("group"));
      if (!partner || !priceCode) return Response.json({ error: "Selecione o cliente e a tabela." }, { status: 400 });
      if (!productGroup) return Response.json({ rows: [] });
      const filter = search
        ? `AND (UPPER(P.DESCRPROD) LIKE '%${search}%' OR TO_CHAR(P.CODPROD) LIKE '%${search}%')`
        : "";
      const rows = await executeQuery(session, `
          SELECT P.CODPROD, P.DESCRPROD, P.CODVOL, P.CODGRUPOPROD,
                 E.CODLOCAL, E.CONTROLE, E.DISPONIVEL,
                 T.CODTAB, T.NUTAB,
                 MAX(NVL(X.VLRVENDA, 0)) VLRVENDA
            FROM TGFPRO P
            JOIN (
              SELECT CODEMP, CODPROD, CODLOCAL, CONTROLE,
                     SUM(ESTOQUE - RESERVADO) DISPONIVEL
                FROM TGFEST
               WHERE CODEMP = 1 AND ATIVO = 'S'
              GROUP BY CODEMP, CODPROD, CODLOCAL, CONTROLE
              HAVING SUM(ESTOQUE - RESERVADO) > 0
            ) E ON E.CODPROD = P.CODPROD
            JOIN TGFTAB T ON T.CODTAB = ${priceCode}
                         AND T.NUTAB = (SELECT MAX(T2.NUTAB) FROM TGFTAB T2
                                       WHERE T2.CODTAB = ${priceCode}
                                         AND T2.DTVIGOR <= TRUNC(SYSDATE))
            JOIN TGFEXC X ON X.NUTAB = T.NUTAB AND X.CODPROD = P.CODPROD
                              AND (X.CODLOCAL = E.CODLOCAL OR X.CODLOCAL = 0)
                              AND (NVL(TRIM(X.CONTROLE), ' ') = NVL(TRIM(E.CONTROLE), ' ')
                                   OR NVL(TRIM(X.CONTROLE), ' ') = ' ')
           WHERE P.ATIVO = 'S' AND P.AD_MOBILIDADE = 'S'
                 AND P.CODGRUPOPROD = ${productGroup}
                 AND X.VLRVENDA > 0
                 AND EXISTS (
                   SELECT 1
                     FROM TGFPAR CL
                     JOIN TGFPAEM PE ON PE.CODPARC = CL.CODPARC AND PE.CODEMP = 1
                     JOIN TGFPAEM GE ON GE.CODEMP = PE.CODEMP
                    WHERE GE.CODTAB = ${priceCode}
                      AND (GE.GRUPOICMS = PE.GRUPOICMS OR (GE.GRUPOICMS IS NULL AND PE.GRUPOICMS IS NULL))
                      AND CL.CODPARC = ${partner}
                      AND CL.CODVEND = ${session.sellerId}
                      AND CL.CLIENTE = 'S'
                      AND CL.ATIVO = 'S'
                 )
                 ${filter}
           GROUP BY P.CODPROD, P.DESCRPROD, P.CODVOL, P.CODGRUPOPROD,
                    E.CODLOCAL, E.CONTROLE, E.DISPONIVEL, T.CODTAB, T.NUTAB
           ORDER BY P.DESCRPROD, E.DISPONIVEL DESC
      `);
      return Response.json({ rows });
    }

    return Response.json({ error: "Consulta inválida." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na consulta.";
    return Response.json(
      { error: message === "AUTH_REQUIRED" ? "Sessão expirada." : message },
      { status: message === "AUTH_REQUIRED" ? 401 : 500 },
    );
  }
}
