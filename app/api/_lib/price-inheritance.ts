// Latest effective configuration defines the parent, while price exceptions
// retain their own effective dates. Depth wins over date across tables.
export function priceInheritanceCtes() {
  return `
    CONFIG_PRECOS AS (
      SELECT CODTAB, CODTABORIG, NVL(PERCENTUAL, 0) PERCENTUAL
        FROM (
          SELECT T.*, ROW_NUMBER() OVER (
            PARTITION BY CODTAB ORDER BY DTVIGOR DESC, NUTAB DESC
          ) RN_CONFIG
            FROM TGFTAB T WHERE DTVIGOR <= TRUNC(SYSDATE)
        ) WHERE RN_CONFIG = 1
    ),
    HERANCA_PRECOS (CODTAB, CODTAB_FONTE, PRIORIDADE, PERCENTUAL) AS (
      SELECT CODTAB, CODTAB, 0, 0 FROM CONFIG_PRECOS
      UNION ALL
      SELECT H.CODTAB, C.CODTABORIG, H.PRIORIDADE + 1,
             H.PERCENTUAL + C.PERCENTUAL
        FROM HERANCA_PRECOS H
        JOIN CONFIG_PRECOS C ON C.CODTAB = H.CODTAB_FONTE
       WHERE C.CODTABORIG IS NOT NULL AND C.CODTABORIG <> C.CODTAB
    ) CYCLE CODTAB, CODTAB_FONTE SET CICLO TO 'S' DEFAULT 'N'`;
}
