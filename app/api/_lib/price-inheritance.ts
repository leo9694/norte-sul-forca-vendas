// Tabelas derivadas usam somente exceções da vigência atual. Histórico por
// produto só é permitido na tabela-base (origem igual à própria tabela/zero),
// conforme SNK_GET_PRECO; uma exceção antiga não pode esconder a herança atual.
export function priceInheritanceCtes() {
  return `
    CONFIG_PRECOS AS (
      SELECT CODTAB, CODTABORIG, NUTAB, NVL(PERCENTUAL, 0) PERCENTUAL
        FROM (
          SELECT T.*, ROW_NUMBER() OVER (
            PARTITION BY CODTAB ORDER BY DTVIGOR DESC, NUTAB DESC
          ) RN_CONFIG
            FROM TGFTAB T WHERE DTVIGOR <= TRUNC(SYSDATE)
        ) WHERE RN_CONFIG = 1
    ),
    HERANCA_PRECOS (CODTAB, CODTAB_FONTE, PRIORIDADE, PERCENTUAL, NUTAB_FONTE, ACEITA_HISTORICO) AS (
      SELECT CODTAB, CODTAB, 0, 0, NUTAB,
             CASE WHEN NVL(CODTABORIG, CODTAB) = CODTAB OR CODTAB = 0 THEN 'S' ELSE 'N' END
        FROM CONFIG_PRECOS
      UNION ALL
      SELECT H.CODTAB, C.CODTABORIG, H.PRIORIDADE + 1,
             H.PERCENTUAL + C.PERCENTUAL, O.NUTAB,
             CASE WHEN NVL(O.CODTABORIG, O.CODTAB) = O.CODTAB OR O.CODTAB = 0 THEN 'S' ELSE 'N' END
        FROM HERANCA_PRECOS H
        JOIN CONFIG_PRECOS C ON C.CODTAB = H.CODTAB_FONTE
        JOIN CONFIG_PRECOS O ON O.CODTAB = C.CODTABORIG
       WHERE C.CODTABORIG IS NOT NULL AND C.CODTABORIG <> C.CODTAB
    ) CYCLE CODTAB, CODTAB_FONTE SET CICLO TO 'S' DEFAULT 'N'`;
}
