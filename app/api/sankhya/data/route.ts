import { canAnalyzeOtherSellers, executeQuery, requireSession } from "../../_lib/sankhya";

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

    if (kind === "generalSalesCompanies" || kind === "generalSales") {
      if (!(await canAnalyzeOtherSellers(session))) {
        return Response.json({ error: "Você não possui permissão para visualizar as vendas gerais." }, { status: 403 });
      }

      if (kind === "generalSalesCompanies") {
        const rows = await executeQuery(session, `
          SELECT DISTINCT E.CODEMP, E.NOMEFANTASIA
            FROM TSIEMP E
            JOIN TGFCAB C ON C.CODEMP = E.CODEMP
           WHERE C.CODTIPOPER = 35
             AND C.TIPMOV = 'V'
           ORDER BY E.CODEMP
        `);
        return Response.json({ rows });
      }

      const dateFrom = safeDate(url.searchParams.get("dateFrom"));
      const dateTo = safeDate(url.searchParams.get("dateTo"));
      const companyId = numeric(url.searchParams.get("company"));
      const startExpression = dateFrom
        ? `TO_DATE('${dateFrom}', 'DD/MM/YYYY')`
        : "TRUNC(SYSDATE, 'YYYY')";
      const endExpression = dateTo
        ? `TO_DATE('${dateTo}', 'DD/MM/YYYY') + 1`
        : "TRUNC(SYSDATE) + 1";
      const companyFilter = companyId ? `AND C.CODEMP = ${companyId}` : "";
      const period = `
        C.DTNEG >= ${startExpression}
        AND C.DTNEG < ${endExpression}
        AND C.CODTIPOPER = 35
        AND C.TIPMOV = 'V'
        ${companyFilter}
      `;

      const [summaryRows, companies, sellers, groups, monthly] = await Promise.all([
        executeQuery(session, `
          WITH DOCUMENTOS AS (
            SELECT C.NUNOTA, C.STATUSNOTA, C.CODPARC, C.CODVEND,
                   NVL(SUM(I.VLRTOT), 0) ITEM_VALUE
              FROM TGFCAB C
              JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
             WHERE ${period}
             GROUP BY C.NUNOTA, C.STATUSNOTA, C.CODPARC, C.CODVEND
          )
          SELECT NVL(SUM(CASE WHEN D.STATUSNOTA = 'L' THEN D.ITEM_VALUE ELSE 0 END), 0) SALES_VALUE,
                 COUNT(CASE WHEN D.STATUSNOTA = 'L' THEN 1 END) ORDER_COUNT,
                 NVL(AVG(CASE WHEN D.STATUSNOTA = 'L' THEN D.ITEM_VALUE END), 0) AVG_TICKET,
                 COUNT(DISTINCT CASE WHEN D.STATUSNOTA = 'L' THEN D.CODPARC END) CLIENT_COUNT,
                 COUNT(DISTINCT CASE WHEN D.STATUSNOTA = 'L' THEN D.CODVEND END) SELLER_COUNT,
                 COUNT(CASE WHEN D.STATUSNOTA <> 'L' THEN 1 END) OPEN_ORDER_COUNT,
                 NVL(SUM(CASE WHEN D.STATUSNOTA <> 'L' THEN D.ITEM_VALUE ELSE 0 END), 0) OPEN_VALUE
            FROM DOCUMENTOS D
        `),
        executeQuery(session, `
          WITH DOCUMENTOS AS (
            SELECT C.NUNOTA, C.CODEMP, C.STATUSNOTA, C.CODPARC, C.CODVEND,
                   NVL(SUM(I.VLRTOT), 0) ITEM_VALUE
              FROM TGFCAB C
              JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
             WHERE ${period}
             GROUP BY C.NUNOTA, C.CODEMP, C.STATUSNOTA, C.CODPARC, C.CODVEND
          )
          SELECT D.CODEMP, E.NOMEFANTASIA,
                 NVL(SUM(CASE WHEN D.STATUSNOTA = 'L' THEN D.ITEM_VALUE ELSE 0 END), 0) SALES_VALUE,
                 COUNT(CASE WHEN D.STATUSNOTA = 'L' THEN 1 END) ORDER_COUNT,
                 NVL(AVG(CASE WHEN D.STATUSNOTA = 'L' THEN D.ITEM_VALUE END), 0) AVG_TICKET,
                 COUNT(DISTINCT CASE WHEN D.STATUSNOTA = 'L' THEN D.CODPARC END) CLIENT_COUNT,
                 COUNT(DISTINCT CASE WHEN D.STATUSNOTA = 'L' THEN D.CODVEND END) SELLER_COUNT,
                 COUNT(CASE WHEN D.STATUSNOTA <> 'L' THEN 1 END) OPEN_ORDER_COUNT,
                 NVL(SUM(CASE WHEN D.STATUSNOTA <> 'L' THEN D.ITEM_VALUE ELSE 0 END), 0) OPEN_VALUE
            FROM DOCUMENTOS D
            JOIN TSIEMP E ON E.CODEMP = D.CODEMP
           GROUP BY D.CODEMP, E.NOMEFANTASIA
           ORDER BY SALES_VALUE DESC
        `),
        executeQuery(session, `
          WITH DOCUMENTOS AS (
            SELECT C.NUNOTA, C.CODVEND, C.CODPARC,
                   NVL(SUM(I.VLRTOT), 0) ITEM_VALUE
              FROM TGFCAB C
              JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
             WHERE ${period}
               AND C.STATUSNOTA = 'L'
             GROUP BY C.NUNOTA, C.CODVEND, C.CODPARC
          )
          SELECT D.CODVEND, V.APELIDO,
                 NVL(SUM(D.ITEM_VALUE), 0) SALES_VALUE,
                 COUNT(*) ORDER_COUNT,
                 COUNT(DISTINCT D.CODPARC) CLIENT_COUNT,
                 NVL(AVG(D.ITEM_VALUE), 0) AVG_TICKET
            FROM DOCUMENTOS D
            JOIN TGFVEN V ON V.CODVEND = D.CODVEND
           GROUP BY D.CODVEND, V.APELIDO
           ORDER BY SALES_VALUE DESC
        `),
        executeQuery(session, `
          SELECT P.CODGRUPOPROD, G.DESCRGRUPOPROD,
                 NVL(SUM(I.VLRTOT), 0) SALES_VALUE,
                 NVL(SUM(I.QTDNEG), 0) QUANTITY
            FROM TGFCAB C
            JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
            JOIN TGFPRO P ON P.CODPROD = I.CODPROD
            JOIN TGFGRU G ON G.CODGRUPOPROD = P.CODGRUPOPROD
           WHERE ${period}
             AND C.STATUSNOTA = 'L'
           GROUP BY P.CODGRUPOPROD, G.DESCRGRUPOPROD
           ORDER BY SALES_VALUE DESC
        `),
        executeQuery(session, `
          WITH DOCUMENTOS AS (
            SELECT C.NUNOTA, TRUNC(C.DTNEG, 'MM') SALE_MONTH,
                   NVL(SUM(I.VLRTOT), 0) ITEM_VALUE
              FROM TGFCAB C
              JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
             WHERE ${period}
               AND C.STATUSNOTA = 'L'
             GROUP BY C.NUNOTA, TRUNC(C.DTNEG, 'MM')
          )
          SELECT TO_CHAR(D.SALE_MONTH, 'MM/YYYY') SALE_MONTH,
                 NVL(SUM(D.ITEM_VALUE), 0) SALES_VALUE,
                 COUNT(*) ORDER_COUNT
            FROM DOCUMENTOS D
           GROUP BY D.SALE_MONTH
           ORDER BY D.SALE_MONTH
        `),
      ]);

      return Response.json({
        summary: summaryRows[0] ?? {},
        companies,
        sellers,
        groups,
        monthly,
      });
    }

    if (kind === "dashboardSellers") {
      if (!(await canAnalyzeOtherSellers(session))) {
        return Response.json({ error: "Você não possui permissão para analisar outros vendedores." }, { status: 403 });
      }
      const rows = await executeQuery(session, `
        SELECT V.CODVEND, V.APELIDO
          FROM TGFVEN V
         WHERE V.ATIVO = 'S'
           AND V.CODVEND > 0
         ORDER BY V.APELIDO
      `);
      return Response.json({ rows });
    }

    const sellerScopedDashboardKinds = new Set([
      "dashboard",
      "dashboardDay",
      "dashboardProducts",
      "dashboardGroupProducts",
      "dashboardClients",
      "dashboardNewClients",
      "dashboardRecurringClients",
      "dashboardReactivatedClients",
      "dashboardInactiveClients",
    ]);
    let dashboardSellerId = session.sellerId;
    if (kind && sellerScopedDashboardKinds.has(kind)) {
      const requestedSellerId = numeric(url.searchParams.get("seller"));
      if (requestedSellerId && requestedSellerId !== session.sellerId) {
        if (!(await canAnalyzeOtherSellers(session))) {
          return Response.json({ error: "Você não possui permissão para analisar este vendedor." }, { status: 403 });
        }
        const sellerRows = await executeQuery(session, `
          SELECT V.CODVEND
            FROM TGFVEN V
           WHERE V.CODVEND = ${requestedSellerId}
             AND V.ATIVO = 'S'
        `);
        if (!sellerRows.length) {
          return Response.json({ error: "Vendedor inválido ou inativo." }, { status: 400 });
        }
        dashboardSellerId = requestedSellerId;
      }
    }

    if (kind === "orders") {
      const dateFrom = safeDate(url.searchParams.get("dateFrom"));
      const dateTo = safeDate(url.searchParams.get("dateTo"));
      const periodFilter = [
        dateFrom ? `AND C.DTNEG >= TO_DATE('${dateFrom}', 'DD/MM/YYYY')` : "AND C.DTNEG >= TRUNC(SYSDATE, 'MM')",
        dateTo ? `AND C.DTNEG < TO_DATE('${dateTo}', 'DD/MM/YYYY') + 1` : "AND C.DTNEG < TRUNC(SYSDATE) + 1",
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
        userId: session.userId,
        sellerId: session.sellerId,
        sellerName: session.sellerName,
      });
    }

    if (kind === "dashboard") {
      const dateFrom = safeDate(url.searchParams.get("dateFrom"));
      const dateTo = safeDate(url.searchParams.get("dateTo"));
      const startExpression = dateFrom
        ? `TO_DATE('${dateFrom}', 'DD/MM/YYYY')`
        : "TRUNC(SYSDATE, 'MM')";
      const endExpression = dateTo
        ? `TO_DATE('${dateTo}', 'DD/MM/YYYY') + 1`
        : "TRUNC(SYSDATE) + 1";
      const period = `
        C.DTNEG >= ${startExpression}
        AND C.DTNEG < ${endExpression}
        AND C.CODTIPOPER = 5
        AND C.TIPMOV = 'P'
        AND C.CODVEND = ${dashboardSellerId}
      `;
      const [summaryRows, dailySales, topProducts, topClients, clientPortfolioRows, salesByGroup] = await Promise.all([
        executeQuery(session, `
          SELECT NVL(SUM(CASE WHEN C.STATUSNOTA = 'L' THEN C.VLRNOTA ELSE 0 END), 0) SALES_VALUE,
                 COUNT(CASE WHEN C.STATUSNOTA = 'L' THEN 1 END) ORDER_COUNT,
                 NVL(AVG(CASE WHEN C.STATUSNOTA = 'L' THEN C.VLRNOTA END), 0) AVG_TICKET,
                 COUNT(DISTINCT CASE WHEN C.STATUSNOTA = 'L' THEN C.CODPARC END) CLIENT_COUNT,
                 NVL(SUM(CASE WHEN C.STATUSNOTA <> 'L' THEN C.VLRNOTA ELSE 0 END), 0) PENDING_VALUE
            FROM TGFCAB C
           WHERE ${period}
        `),
        executeQuery(session, `
          SELECT TO_CHAR(TRUNC(C.DTNEG), 'DD/MM/YYYY') SALE_DATE,
                 NVL(SUM(C.VLRNOTA), 0) SALES_VALUE,
                 COUNT(*) ORDER_COUNT
            FROM TGFCAB C
           WHERE ${period}
             AND C.STATUSNOTA = 'L'
           GROUP BY TRUNC(C.DTNEG)
           ORDER BY TRUNC(C.DTNEG)
        `),
        executeQuery(session, `
          SELECT * FROM (
            SELECT I.CODPROD, P.DESCRPROD,
                   NVL(SUM(I.QTDNEG), 0) QUANTITY,
                   NVL(SUM(I.VLRTOT), 0) SALES_VALUE
              FROM TGFCAB C
              JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
              JOIN TGFPRO P ON P.CODPROD = I.CODPROD
             WHERE ${period}
               AND C.STATUSNOTA = 'L'
             GROUP BY I.CODPROD, P.DESCRPROD
             ORDER BY SUM(I.QTDNEG) DESC, SUM(I.VLRTOT) DESC
          ) WHERE ROWNUM <= 5
        `),
        executeQuery(session, `
          SELECT * FROM (
            SELECT C.CODPARC, P.NOMEPARC,
                   NVL(SUM(C.VLRNOTA), 0) SALES_VALUE,
                   COUNT(*) ORDER_COUNT
              FROM TGFCAB C
              JOIN TGFPAR P ON P.CODPARC = C.CODPARC
             WHERE ${period}
               AND C.STATUSNOTA = 'L'
             GROUP BY C.CODPARC, P.NOMEPARC
             ORDER BY SUM(C.VLRNOTA) DESC
          ) WHERE ROWNUM <= 5
        `),
        executeQuery(session, `
          WITH CLIENTES AS (
            SELECT P.CODPARC
              FROM TGFPAR P
             WHERE P.CLIENTE = 'S'
               AND P.ATIVO = 'S'
               AND P.CODVEND = ${dashboardSellerId}
          ),
          VENDAS AS (
            SELECT C.CODPARC, C.DTNEG
              FROM TGFCAB C
             WHERE C.CODTIPOPER = 5
               AND C.TIPMOV = 'P'
               AND C.STATUSNOTA = 'L'
               AND C.CODVEND = ${dashboardSellerId}
          ),
          BASE AS (
            SELECT CL.CODPARC,
                   MIN(V.DTNEG) FIRST_PURCHASE,
                   MAX(V.DTNEG) LAST_PURCHASE,
                   MIN(CASE WHEN V.DTNEG >= ${startExpression} AND V.DTNEG < ${endExpression} THEN V.DTNEG END) PERIOD_PURCHASE,
                   MAX(CASE WHEN V.DTNEG < ${startExpression} THEN V.DTNEG END) PREVIOUS_PURCHASE
              FROM CLIENTES CL
              LEFT JOIN VENDAS V ON V.CODPARC = CL.CODPARC
             GROUP BY CL.CODPARC
          )
          SELECT NVL(SUM(CASE WHEN PERIOD_PURCHASE IS NOT NULL AND FIRST_PURCHASE >= ${startExpression} THEN 1 ELSE 0 END), 0) NEW_CLIENTS,
                 NVL(SUM(CASE WHEN PERIOD_PURCHASE IS NOT NULL AND FIRST_PURCHASE < ${startExpression} AND PREVIOUS_PURCHASE >= ${startExpression} - 90 THEN 1 ELSE 0 END), 0) RECURRING_CLIENTS,
                 NVL(SUM(CASE WHEN PERIOD_PURCHASE IS NOT NULL AND PREVIOUS_PURCHASE < ${startExpression} - 90 THEN 1 ELSE 0 END), 0) REACTIVATED_CLIENTS,
                 NVL(SUM(CASE WHEN LAST_PURCHASE IS NULL OR LAST_PURCHASE < TRUNC(SYSDATE) - 30 THEN 1 ELSE 0 END), 0) INACTIVE_30,
                 NVL(SUM(CASE WHEN LAST_PURCHASE IS NULL OR LAST_PURCHASE < TRUNC(SYSDATE) - 60 THEN 1 ELSE 0 END), 0) INACTIVE_60,
                 NVL(SUM(CASE WHEN LAST_PURCHASE IS NULL OR LAST_PURCHASE < TRUNC(SYSDATE) - 90 THEN 1 ELSE 0 END), 0) INACTIVE_90
            FROM BASE
        `),
        executeQuery(session, `
          SELECT P.CODGRUPOPROD, G.DESCRGRUPOPROD,
                 NVL(SUM(I.VLRTOT), 0) SALES_VALUE
            FROM TGFCAB C
            JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
            JOIN TGFPRO P ON P.CODPROD = I.CODPROD
            JOIN TGFGRU G ON G.CODGRUPOPROD = P.CODGRUPOPROD
           WHERE ${period}
             AND C.STATUSNOTA = 'L'
           GROUP BY P.CODGRUPOPROD, G.DESCRGRUPOPROD
           ORDER BY SUM(I.VLRTOT) DESC
        `),
      ]);
      return Response.json({
        summary: summaryRows[0] ?? { SALES_VALUE: 0, ORDER_COUNT: 0, AVG_TICKET: 0, CLIENT_COUNT: 0, PENDING_VALUE: 0 },
        dailySales,
        topProducts,
        topClients,
        clientPortfolio: clientPortfolioRows[0] ?? { NEW_CLIENTS: 0, RECURRING_CLIENTS: 0, REACTIVATED_CLIENTS: 0, INACTIVE_30: 0, INACTIVE_60: 0, INACTIVE_90: 0 },
        salesByGroup,
      });
    }

    if (kind === "dashboardDay" || kind === "dashboardProducts" || kind === "dashboardGroupProducts" || kind === "dashboardClients" || kind === "dashboardNewClients" || kind === "dashboardRecurringClients" || kind === "dashboardReactivatedClients" || kind === "dashboardInactiveClients") {
      const dateFrom = safeDate(url.searchParams.get("dateFrom"));
      const dateTo = safeDate(url.searchParams.get("dateTo"));
      const startExpression = dateFrom
        ? `TO_DATE('${dateFrom}', 'DD/MM/YYYY')`
        : "TRUNC(SYSDATE, 'MM')";
      const endExpression = dateTo
        ? `TO_DATE('${dateTo}', 'DD/MM/YYYY') + 1`
        : "TRUNC(SYSDATE) + 1";
      const period = `
        C.DTNEG >= ${startExpression}
        AND C.DTNEG < ${endExpression}
        AND C.CODTIPOPER = 5
        AND C.TIPMOV = 'P'
        AND C.CODVEND = ${dashboardSellerId}
        AND C.STATUSNOTA = 'L'
      `;

      if (kind === "dashboardDay") {
        const selectedDate = safeDate(url.searchParams.get("date"));
        if (!selectedDate) return Response.json({ error: "Selecione um dia válido." }, { status: 400 });
        const rows = await executeQuery(session, `
          SELECT C.NUNOTA, C.NUMNOTA, TO_CHAR(C.DTNEG, 'DD/MM/YYYY') DTNEG,
                 C.VLRNOTA, C.CODPARC, P.NOMEPARC
            FROM TGFCAB C
            JOIN TGFPAR P ON P.CODPARC = C.CODPARC
           WHERE ${period}
             AND C.DTNEG >= TO_DATE('${selectedDate}', 'DD/MM/YYYY')
             AND C.DTNEG < TO_DATE('${selectedDate}', 'DD/MM/YYYY') + 1
           ORDER BY C.VLRNOTA DESC, C.NUNOTA DESC
        `);
        return Response.json({ rows });
      }

      if (kind === "dashboardProducts" || kind === "dashboardGroupProducts") {
        const group = kind === "dashboardGroupProducts" ? numeric(url.searchParams.get("group")) : 0;
        if (kind === "dashboardGroupProducts" && !group) {
          return Response.json({ error: "Selecione um grupo de produto válido." }, { status: 400 });
        }
        const groupFilter = group ? `AND P.CODGRUPOPROD = ${group}` : "";
        const productOrder = group
          ? "SUM(I.VLRTOT) DESC, SUM(I.QTDNEG) DESC"
          : "SUM(I.QTDNEG) DESC, SUM(I.VLRTOT) DESC";
        const rows = await executeQuery(session, `
          SELECT I.CODPROD ENTITY_ID, P.DESCRPROD ENTITY_NAME,
                 NVL(SUM(I.QTDNEG), 0) QUANTITY,
                 NVL(SUM(I.VLRTOT), 0) SALES_VALUE,
                 COUNT(DISTINCT C.NUNOTA) ORDER_COUNT
            FROM TGFCAB C
            JOIN TGFITE I ON I.NUNOTA = C.NUNOTA
            JOIN TGFPRO P ON P.CODPROD = I.CODPROD
           WHERE ${period}
             ${groupFilter}
           GROUP BY I.CODPROD, P.DESCRPROD
           ORDER BY ${productOrder}
        `);
        return Response.json({ rows });
      }

      if (kind === "dashboardNewClients" || kind === "dashboardRecurringClients" || kind === "dashboardReactivatedClients") {
        const segmentCondition = kind === "dashboardNewClients"
          ? `FIRST_PURCHASE >= ${startExpression}`
          : kind === "dashboardRecurringClients"
            ? `FIRST_PURCHASE < ${startExpression} AND PREVIOUS_PURCHASE >= ${startExpression} - 90`
            : `PREVIOUS_PURCHASE < ${startExpression} - 90`;
        const rows = await executeQuery(session, `
          WITH CLIENTES AS (
            SELECT P.CODPARC, P.NOMEPARC
              FROM TGFPAR P
             WHERE P.CLIENTE = 'S'
               AND P.ATIVO = 'S'
               AND P.CODVEND = ${dashboardSellerId}
          ),
          VENDAS AS (
            SELECT C.CODPARC, C.NUNOTA, C.DTNEG, C.VLRNOTA
              FROM TGFCAB C
             WHERE C.CODTIPOPER = 5
               AND C.TIPMOV = 'P'
               AND C.STATUSNOTA = 'L'
               AND C.CODVEND = ${dashboardSellerId}
          ),
          BASE AS (
            SELECT CL.CODPARC, CL.NOMEPARC,
                   MIN(V.DTNEG) FIRST_PURCHASE,
                   MIN(CASE WHEN V.DTNEG >= ${startExpression} AND V.DTNEG < ${endExpression} THEN V.DTNEG END) REFERENCE_DATE,
                   MAX(CASE WHEN V.DTNEG < ${startExpression} THEN V.DTNEG END) PREVIOUS_PURCHASE,
                   COUNT(DISTINCT CASE WHEN V.DTNEG >= ${startExpression} AND V.DTNEG < ${endExpression} THEN V.NUNOTA END) ORDER_COUNT,
                   NVL(SUM(CASE WHEN V.DTNEG >= ${startExpression} AND V.DTNEG < ${endExpression} THEN V.VLRNOTA ELSE 0 END), 0) SALES_VALUE
              FROM CLIENTES CL
              LEFT JOIN VENDAS V ON V.CODPARC = CL.CODPARC
             GROUP BY CL.CODPARC, CL.NOMEPARC
          )
          SELECT CODPARC ENTITY_ID, NOMEPARC ENTITY_NAME,
                 TO_CHAR(REFERENCE_DATE, 'DD/MM/YYYY') REFERENCE_DATE,
                 TO_CHAR(PREVIOUS_PURCHASE, 'DD/MM/YYYY') PREVIOUS_PURCHASE,
                 NVL(TRUNC(REFERENCE_DATE) - TRUNC(PREVIOUS_PURCHASE), 0) DAYS_TO_RETURN,
                 ORDER_COUNT, SALES_VALUE
            FROM BASE
           WHERE REFERENCE_DATE IS NOT NULL
             AND ${segmentCondition}
           ORDER BY REFERENCE_DATE DESC, NOMEPARC
        `);
        return Response.json({ rows });
      }

      if (kind === "dashboardInactiveClients") {
        const rows = await executeQuery(session, `
          WITH ULTIMA_COMPRA AS (
            SELECT C.CODPARC, MAX(C.DTNEG) LAST_PURCHASE
              FROM TGFCAB C
             WHERE C.CODTIPOPER = 5
               AND C.TIPMOV = 'P'
               AND C.STATUSNOTA = 'L'
               AND C.CODVEND = ${dashboardSellerId}
             GROUP BY C.CODPARC
          )
          SELECT P.CODPARC ENTITY_ID, P.NOMEPARC ENTITY_NAME,
                 TO_CHAR(U.LAST_PURCHASE, 'DD/MM/YYYY') LAST_PURCHASE,
                 NVL(TRUNC(SYSDATE) - TRUNC(U.LAST_PURCHASE), 99999) DAYS_WITHOUT_PURCHASE
            FROM TGFPAR P
            LEFT JOIN ULTIMA_COMPRA U ON U.CODPARC = P.CODPARC
           WHERE P.CLIENTE = 'S'
             AND P.ATIVO = 'S'
             AND P.CODVEND = ${dashboardSellerId}
             AND (U.LAST_PURCHASE IS NULL OR U.LAST_PURCHASE < TRUNC(SYSDATE) - 30)
           ORDER BY U.LAST_PURCHASE NULLS FIRST, P.NOMEPARC
        `);
        return Response.json({ rows });
      }

      const rows = await executeQuery(session, `
        SELECT C.CODPARC ENTITY_ID, P.NOMEPARC ENTITY_NAME,
               NVL(SUM(C.VLRNOTA), 0) SALES_VALUE,
               COUNT(*) ORDER_COUNT,
               NVL(AVG(C.VLRNOTA), 0) AVG_TICKET,
               MAX(C.DTNEG) LAST_ORDER_DATE
          FROM TGFCAB C
          JOIN TGFPAR P ON P.CODPARC = C.CODPARC
         WHERE ${period}
         GROUP BY C.CODPARC, P.NOMEPARC
         ORDER BY SUM(C.VLRNOTA) DESC
      `);
      return Response.json({ rows });
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
      if (!productGroups.length && !brand && !search) return Response.json({ rows: [] });
      const normalizedSearch = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const searchTokens = normalizedSearch.split(/\s+/).filter(Boolean).slice(0, 6);
      const searchableText = `TRANSLATE(UPPER(NVL(P.DESCRPROD, '') || ' ' || NVL(P.REFERENCIA, '') || ' ' || NVL(P.MARCA, '')), 'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')`;
      const filter = searchTokens.length
        ? searchTokens.map((token) =>
            `AND (${searchableText} LIKE '%${token}%' OR TO_CHAR(P.CODPROD) LIKE '%${token}%')`,
          ).join("\n")
        : "";
      const brandFilter = !search && brand ? `AND UPPER(TRIM(P.MARCA)) = '${brand}'` : "";
      const groupFilter = !search && productGroups.length ? `AND P.CODGRUPOPROD IN (${productGroups.join(",")})` : "";
      const relevance = search
        ? `CASE
             WHEN TO_CHAR(P.CODPROD) = '${normalizedSearch}' THEN 0
             WHEN TO_CHAR(P.CODPROD) LIKE '${normalizedSearch}%' THEN 1
             WHEN ${searchableText} LIKE '${normalizedSearch}%' THEN 2
             ELSE 3
           END`
        : "0";
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
                 ${relevance} RELEVANCIA,
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
         ORDER BY RELEVANCIA, DESCRPROD, DISPONIVEL DESC
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
