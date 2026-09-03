import { executeQuery, requireSession } from "../../_lib/sankhya";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);

    const [clients, partnerCompanies, orders, tables, negotiations, operations, products, productGroups] = await Promise.all([
      executeQuery(session, `
        SELECT P.CODPARC, P.NOMEPARC, P.RAZAOSOCIAL, P.CGC_CPF AS CGCCPF,
               P.TELEFONE, P.EMAIL, P.CODVEND,
               E.CODEMP, E.GRUPOICMS, E.CODTAB,
               NVL((SELECT MAX(C.CODTIPVENDA) KEEP (DENSE_RANK LAST ORDER BY C.NUNOTA)
                      FROM TGFCAB C
                     WHERE C.CODPARC = P.CODPARC
                       AND C.CODTIPOPER = 5
                       AND C.CODVEND = ${session.sellerId}), 53) CODTIPVENDA
          FROM TGFPAR P
          LEFT JOIN TGFPAEM E ON E.CODPARC = P.CODPARC
            AND E.CODEMP = (
              SELECT MIN(E2.CODEMP) FROM TGFPAEM E2
               WHERE E2.CODPARC = P.CODPARC AND E2.CODTAB IS NOT NULL
            )
         WHERE P.CLIENTE = 'S'
           AND P.ATIVO = 'S'
           AND P.CODVEND = ${session.sellerId}
         ORDER BY P.NOMEPARC
      `),
      executeQuery(session, `
        SELECT E.CODPARC, E.CODEMP,
               NVL(EM.NOMEFANTASIA, TO_CHAR(E.CODEMP)) NOMEFANTASIA,
               E.GRUPOICMS, E.CODTAB
          FROM TGFPAR P
          JOIN TGFPAEM E ON E.CODPARC = P.CODPARC
          LEFT JOIN TSIEMP EM ON EM.CODEMP = E.CODEMP
         WHERE P.CLIENTE = 'S'
           AND P.ATIVO = 'S'
           AND P.CODVEND = ${session.sellerId}
           AND E.CODTAB IS NOT NULL
         ORDER BY E.CODPARC, E.CODEMP
      `),
      executeQuery(session, `
        SELECT C.NUNOTA, C.NUMNOTA, C.DTNEG, C.DTENTSAI, C.VLRNOTA,
               C.STATUSNOTA, C.CODTIPOPER, C.PENDENTE, C.CODPARC, P.NOMEPARC,
               CASE WHEN EXISTS (
                 SELECT 1 FROM TGFVAR V
                 JOIN TGFCAB F ON F.NUNOTA = V.NUNOTA AND F.TIPMOV <> 'P'
                 WHERE V.NUNOTAORIG = C.NUNOTA
               ) THEN 'S' ELSE 'N' END FATURADO
          FROM TGFCAB C
          JOIN TGFPAR P ON P.CODPARC = C.CODPARC
         WHERE C.CODTIPOPER IN (5, 6)
           AND C.TIPMOV = 'P'
           AND C.CODVEND = ${session.sellerId}
         ORDER BY C.NUNOTA DESC
      `),
      executeQuery(session, `
        SELECT DISTINCT E.CODEMP, N.CODTAB, N.NOMETAB
          FROM TGFPAR P
          JOIN TGFPAEM E ON E.CODPARC = P.CODPARC
          JOIN TGFNTA N ON N.CODTAB = E.CODTAB
         WHERE P.CLIENTE = 'S'
           AND P.ATIVO = 'S'
           AND P.CODVEND = ${session.sellerId}
           AND E.CODTAB IS NOT NULL
           AND N.ATIVO = 'S'
           AND NVL(N.AD_MOBILIDADE, 'N') = 'S'
         ORDER BY E.CODEMP, N.NOMETAB
      `),
      executeQuery(session, `
        SELECT V.CODTIPVENDA, V.DESCRTIPVENDA
          FROM TGFTPV V
         WHERE V.ATIVO = 'S'
           AND V.CODTIPVENDA > 0
           AND NVL(V.AD_MOBILIDADE, 'N') = 'S'
           AND V.DHALTER = (
             SELECT MAX(V2.DHALTER)
               FROM TGFTPV V2
              WHERE V2.CODTIPVENDA = V.CODTIPVENDA
           )
         ORDER BY V.DESCRTIPVENDA
      `),
      executeQuery(session, `
        SELECT O.CODTIPOPER, O.DESCROPER
          FROM TGFTOP O
         WHERE O.CODTIPOPER IN (5, 6)
           AND O.TIPMOV = 'P'
           AND O.DHALTER = (
             SELECT MAX(O2.DHALTER) FROM TGFTOP O2
              WHERE O2.CODTIPOPER = O.CODTIPOPER
           )
         ORDER BY O.CODTIPOPER
      `),
      executeQuery(session, `
        WITH TABELAS AS (
          SELECT DISTINCT E.CODEMP, E.CODTAB
            FROM TGFPAR CL
            JOIN TGFPAEM E ON E.CODPARC = CL.CODPARC
            JOIN TGFNTA N ON N.CODTAB = E.CODTAB
           WHERE CL.CLIENTE = 'S'
             AND CL.ATIVO = 'S'
             AND CL.CODVEND = ${session.sellerId}
             AND E.CODTAB IS NOT NULL
             AND N.ATIVO = 'S'
             AND NVL(N.AD_MOBILIDADE, 'N') = 'S'
        ),
        ESTOQUE AS (
          SELECT CODEMP, CODPROD, CODLOCAL, CONTROLE,
                 MAX(DTFABRICACAO) DTFABRICACAO, MAX(DTVAL) DTVAL,
                 SUM(ESTOQUE) ESTOQUE, SUM(RESERVADO) RESERVADO,
                 SUM(ESTOQUE - RESERVADO) DISPONIVEL
            FROM TGFEST
           WHERE CODEMP IN (SELECT CODEMP FROM TABELAS)
             AND ATIVO = 'S'
           GROUP BY CODEMP, CODPROD, CODLOCAL, CONTROLE
           HAVING SUM(ESTOQUE - RESERVADO) > 0
        ),
        PRECOS AS (
          SELECT TB.CODEMP, T.CODTAB, X.CODPROD, NVL(X.CODLOCAL, 0) CODLOCAL,
                 NVL(TRIM(X.CONTROLE), ' ') CONTROLE,
                 X.VLRVENDA, T.NUTAB, T.DTVIGOR
            FROM TGFEXC X
            JOIN TGFTAB T ON T.NUTAB = X.NUTAB
            JOIN TABELAS TB ON TB.CODTAB = T.CODTAB
           WHERE T.DTVIGOR <= TRUNC(SYSDATE)
        ),
        ITENS AS (
          SELECT PR.CODEMP, PR.CODTAB, P.CODPROD, P.DESCRPROD, P.REFERENCIA, P.CODVOL, P.AGRUPMIN,
                 P.CODGRUPOPROD, G.DESCRGRUPOPROD,
                 NVL(TRIM(P.MARCA), 'SEM MARCA') MARCA,
                 E.CODLOCAL, E.CONTROLE, E.DTFABRICACAO, E.DTVAL,
                 E.ESTOQUE, E.RESERVADO, E.DISPONIVEL,
                 PR.NUTAB, PR.VLRVENDA,
                 ROW_NUMBER() OVER (
                   PARTITION BY PR.CODEMP, PR.CODTAB, P.CODPROD, E.CODLOCAL, NVL(TRIM(E.CONTROLE), ' ')
                   ORDER BY PR.DTVIGOR DESC, PR.NUTAB DESC,
                            CASE WHEN PR.CODLOCAL = E.CODLOCAL THEN 1 ELSE 0 END DESC,
                            CASE WHEN PR.CONTROLE = NVL(TRIM(E.CONTROLE), ' ') THEN 1 ELSE 0 END DESC
                 ) RN
            FROM TGFPRO P
            JOIN TGFGRU G ON G.CODGRUPOPROD = P.CODGRUPOPROD
            JOIN ESTOQUE E ON E.CODPROD = P.CODPROD
            JOIN PRECOS PR ON PR.CODEMP = E.CODEMP
                           AND PR.CODPROD = P.CODPROD
                           AND (PR.CODLOCAL = E.CODLOCAL OR PR.CODLOCAL = 0)
                           AND (PR.CONTROLE = NVL(TRIM(E.CONTROLE), ' ') OR PR.CONTROLE = ' ')
           WHERE P.ATIVO = 'S'
             AND P.AD_MOBILIDADE = 'S'
             AND G.ATIVO = 'S'
             AND G.ANALITICO = 'S'
        )
        SELECT CODEMP, CODTAB, CODPROD, DESCRPROD, REFERENCIA, CODVOL, AGRUPMIN, CODGRUPOPROD,
               DESCRGRUPOPROD, MARCA, CODLOCAL, CONTROLE,
               DTFABRICACAO, DTVAL, ESTOQUE, RESERVADO, DISPONIVEL, NUTAB, VLRVENDA
          FROM ITENS
         WHERE RN = 1
           AND VLRVENDA > 0
         ORDER BY CODEMP, CODTAB, DESCRGRUPOPROD, DESCRPROD, DISPONIVEL DESC
      `),
      executeQuery(session, `
        SELECT CODGRUPOPROD, DESCRGRUPOPROD, CODGRUPAI, GRAU, ANALITICO
          FROM TGFGRU
         WHERE ATIVO = 'S'
         ORDER BY GRAU, DESCRGRUPOPROD
      `),
    ]);

    return Response.json({
      version: 1,
      syncedAt: Date.now(),
      seller: {
        user: session.user,
        userId: session.userId,
        sellerId: session.sellerId,
        sellerName: session.sellerName,
      },
      clients,
      partnerCompanies,
      orders,
      tables,
      negotiations,
      operations,
      products,
      productGroups,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível fazer a carga.";
    return Response.json(
      { error: message === "AUTH_REQUIRED" ? "Sessão expirada." : message },
      { status: message === "AUTH_REQUIRED" ? 401 : 500 },
    );
  }
}
