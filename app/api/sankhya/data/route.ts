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

      const tables = await executeQuery(session, `
        SELECT DISTINCT N.CODTAB, N.NOMETAB
          FROM TGFPAEM E
          JOIN TGFNTA N ON N.CODTAB = E.CODTAB
         WHERE E.CODEMP = 1
           AND E.CODPARC = ${partner}
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
      const brand = safeSearch(url.searchParams.get("brand"));
      if (!partner || !priceCode) {
        return Response.json({ error: "Selecione o cliente e a tabela de preço." }, { status: 400 });
      }
      const brandFilter = brand ? `AND UPPER(TRIM(P.MARCA)) = '${brand}'` : "";
      const eligibleItems = `
        WITH ESTOQUE AS (
          SELECT CODPROD, CODLOCAL, CONTROLE,
                 SUM(ESTOQUE - RESERVADO) DISPONIVEL
            FROM TGFEST
           WHERE CODEMP = 1 AND ATIVO = 'S'
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
        ),
        ITENS AS (
          SELECT P.CODGRUPOPROD, NVL(TRIM(P.MARCA), 'SEM MARCA') MARCA,
                 PR.VLRVENDA,
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
             ${brandFilter}
             AND EXISTS (
               SELECT 1
                 FROM TGFPAR CL
                 JOIN TGFPAEM PE ON PE.CODPARC = CL.CODPARC AND PE.CODEMP = 1
                WHERE CL.CODPARC = ${partner}
                  AND CL.CODVEND = ${session.sellerId}
                  AND CL.CLIENTE = 'S'
                  AND CL.ATIVO = 'S'
                  AND PE.CODTAB = ${priceCode}
             )
        )
      `;
      const [rows, brands] = await Promise.all([
        executeQuery(session, `
          ${eligibleItems},
          ELEGIVEIS AS (
            SELECT DISTINCT CODGRUPOPROD
              FROM ITENS
             WHERE RN = 1 AND VLRVENDA > 0
          ),
          ARVORE AS (
            SELECT G.CODGRUPOPROD, G.DESCRGRUPOPROD, G.CODGRUPAI,
                   G.GRAU, G.ANALITICO
              FROM TGFGRU G
             WHERE G.ATIVO = 'S'
             START WITH G.CODGRUPOPROD IN (SELECT CODGRUPOPROD FROM ELEGIVEIS)
           CONNECT BY NOCYCLE PRIOR G.CODGRUPAI = G.CODGRUPOPROD
          )
          SELECT DISTINCT A.CODGRUPOPROD, A.DESCRGRUPOPROD, A.CODGRUPAI,
                 A.GRAU, A.ANALITICO,
                 CASE WHEN E.CODGRUPOPROD IS NULL THEN 0 ELSE 1 END ELEGIVEL
            FROM ARVORE A
            LEFT JOIN ELEGIVEIS E ON E.CODGRUPOPROD = A.CODGRUPOPROD
           ORDER BY A.GRAU, A.DESCRGRUPOPROD
        `),
        executeQuery(session, `
          ${eligibleItems.replace(brandFilter, "")}
          SELECT DISTINCT MARCA
            FROM ITENS
           WHERE RN = 1 AND VLRVENDA > 0
           ORDER BY MARCA
        `),
      ]);
      return Response.json({ rows, brands });
    }

    if (kind === "products") {
      const partner = numeric(url.searchParams.get("partner"));
      const priceCode = numeric(url.searchParams.get("priceCode"));
      const productGroups = (url.searchParams.get("groups") ?? url.searchParams.get("group") ?? "")
        .split(",")
        .map((value) => numeric(value))
        .filter((value, index, values) => value > 0 && values.indexOf(value) === index)
        .slice(0, 100);
      const brand = safeSearch(url.searchParams.get("brand"));
      if (!partner || !priceCode) return Response.json({ error: "Selecione o cliente e a tabela." }, { status: 400 });
      if (!productGroups.length && !brand) return Response.json({ rows: [] });
      const filter = search
        ? `AND (UPPER(P.DESCRPROD) LIKE '%${search}%' OR TO_CHAR(P.CODPROD) LIKE '%${search}%')`
        : "";
      const brandFilter = brand ? `AND UPPER(TRIM(P.MARCA)) = '${brand}'` : "";
      const groupFilter = productGroups.length ? `AND P.CODGRUPOPROD IN (${productGroups.join(",")})` : "";
      const rows = await executeQuery(session, `
        WITH ESTOQUE AS (
          SELECT CODEMP, CODPROD, CODLOCAL, CONTROLE,
                 SUM(ESTOQUE - RESERVADO) DISPONIVEL
            FROM TGFEST
           WHERE CODEMP = 1 AND ATIVO = 'S'
           GROUP BY CODEMP, CODPROD, CODLOCAL, CONTROLE
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
        ),
        ITENS AS (
          SELECT P.CODPROD, P.DESCRPROD, P.CODVOL, P.CODGRUPOPROD,
                 NVL(TRIM(P.MARCA), 'SEM MARCA') MARCA,
                 E.CODLOCAL, E.CONTROLE, E.DISPONIVEL,
                 ${priceCode} CODTAB, PR.NUTAB, PR.VLRVENDA,
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
             ${groupFilter}
             ${brandFilter}
             ${filter}
        )
        SELECT CODPROD, DESCRPROD, CODVOL, CODGRUPOPROD, MARCA,
               CODLOCAL, CONTROLE, DISPONIVEL, CODTAB, NUTAB, VLRVENDA
          FROM ITENS
         WHERE RN = 1
           AND VLRVENDA > 0
           AND EXISTS (
             SELECT 1
               FROM TGFPAR CL
               JOIN TGFPAEM PE ON PE.CODPARC = CL.CODPARC AND PE.CODEMP = 1
              WHERE PE.CODTAB = ${priceCode}
                AND CL.CODPARC = ${partner}
                AND CL.CODVEND = ${session.sellerId}
                AND CL.CLIENTE = 'S'
                AND CL.ATIVO = 'S'
           )
         ORDER BY DESCRPROD, DISPONIVEL DESC
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
