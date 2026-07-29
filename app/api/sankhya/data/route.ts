import { executeQuery, requireSession } from "../../_lib/sankhya";

const numeric = (value: string | null, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const safeSearch = (value: string | null) =>
  (value ?? "").replace(/[^a-zA-ZÀ-ÿ0-9 ._-]/g, "").slice(0, 50).toUpperCase();

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const search = safeSearch(url.searchParams.get("q"));

    if (kind === "orders") {
      const rows = await executeQuery(session, `
        SELECT * FROM (
          SELECT C.NUNOTA, C.NUMNOTA, C.DTNEG, C.VLRNOTA, C.STATUSNOTA,
                 C.PENDENTE, C.CODPARC, P.NOMEPARC
            FROM TGFCAB C
            JOIN TGFPAR P ON P.CODPARC = C.CODPARC
           WHERE C.CODTIPOPER = 5 AND C.TIPMOV = 'P'
           ORDER BY C.NUNOTA DESC
        ) WHERE ROWNUM <= 30
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

    if (kind === "products") {
      const partner = numeric(url.searchParams.get("partner"));
      if (!partner) return Response.json({ error: "Selecione um parceiro." }, { status: 400 });
      const filter = search
        ? `AND (UPPER(P.DESCRPROD) LIKE '%${search}%' OR TO_CHAR(P.CODPROD) LIKE '%${search}%')`
        : "";
      const rows = await executeQuery(session, `
        SELECT * FROM (
          SELECT P.CODPROD, P.DESCRPROD, P.CODVOL,
                 E.CODLOCAL, E.CONTROLE, E.DISPONIVEL,
                 PA.GRUPOICMS, PA.CODTAB, T.NUTAB,
                 NVL(X.VLRVENDA, 0) VLRVENDA
            FROM TGFPRO P
            JOIN (
              SELECT CODEMP, CODPROD, CODLOCAL, CONTROLE,
                     SUM(ESTOQUE - RESERVADO) DISPONIVEL
                FROM TGFEST
               WHERE CODEMP = 1 AND ATIVO = 'S'
               GROUP BY CODEMP, CODPROD, CODLOCAL, CONTROLE
              HAVING SUM(ESTOQUE - RESERVADO) > 0
            ) E ON E.CODPROD = P.CODPROD
            JOIN TGFPAEM PA ON PA.CODPARC = ${partner} AND PA.CODEMP = E.CODEMP
            JOIN TGFTAB T ON T.CODTAB = PA.CODTAB
                         AND T.NUTAB = (SELECT MAX(T2.NUTAB) FROM TGFTAB T2
                                       WHERE T2.CODTAB = PA.CODTAB
                                         AND T2.DTVIGOR <= TRUNC(SYSDATE))
            LEFT JOIN TGFEXC X ON X.NUTAB = T.NUTAB AND X.CODPROD = P.CODPROD
                              AND (X.CODLOCAL = E.CODLOCAL OR X.CODLOCAL = 0)
                              AND (X.CONTROLE = E.CONTROLE OR X.CONTROLE = ' ')
           WHERE P.ATIVO = 'S' AND P.AD_MOBILIDADE = 'S'
                 AND NVL(X.VLRVENDA, 0) > 0
                 ${filter}
           ORDER BY P.DESCRPROD, E.DISPONIVEL DESC
        ) WHERE ROWNUM <= 80
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
