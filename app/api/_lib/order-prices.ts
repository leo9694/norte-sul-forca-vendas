import { priceInheritanceCtes } from './price-inheritance';

// Preço-base de venda, sem estoque, lote nem desconto promocional. Compartilhado
// pela carga, duplicação e validação do envio para evitar bases divergentes.
export function orderPricesSql(tablesSql: string, products?: number[]) {
  return `WITH ${priceInheritanceCtes()}, TABELAS AS (${tablesSql}),
    PRECOS AS (
      SELECT TB.CODEMP, TB.CODTAB, X.CODPROD, NVL(X.CODLOCAL,0) CODLOCAL,
             X.VLRVENDA * (1 + H.PERCENTUAL / 100) VLRVENDA,
             T.NUTAB, T.DTVIGOR, H.PRIORIDADE
        FROM TGFEXC X JOIN TGFTAB T ON T.NUTAB=X.NUTAB
        JOIN HERANCA_PRECOS H ON H.CODTAB_FONTE = T.CODTAB AND H.CICLO = 'N'
                             AND (T.NUTAB = H.NUTAB_FONTE OR H.ACEITA_HISTORICO = 'S')
        JOIN TABELAS TB ON TB.CODTAB=H.CODTAB
       WHERE T.DTVIGOR <= TRUNC(SYSDATE)
         AND NVL(X.CODLOCAL,0) IN (0,1010101) AND TRIM(X.CONTROLE) IS NULL
         ${products ? `AND X.CODPROD IN (${products.join(',')})` : ''}
    ), ITENS AS (
      SELECT PR.CODEMP, PR.CODTAB, P.CODPROD, P.AGRUPMIN,
             1010101 CODLOCAL, ' ' CONTROLE, PR.NUTAB, PR.VLRVENDA,
             ROW_NUMBER() OVER (PARTITION BY PR.CODEMP, PR.CODTAB, P.CODPROD
               ORDER BY PR.PRIORIDADE, PR.DTVIGOR DESC, PR.NUTAB DESC,
                 CASE WHEN PR.CODLOCAL=1010101 THEN 1 ELSE 0 END DESC) RN
        FROM TGFPRO P JOIN PRECOS PR ON PR.CODPROD=P.CODPROD
       WHERE P.ATIVO='S' AND P.AD_MOBILIDADE='S'
    ) SELECT CODEMP, CODTAB, CODPROD, AGRUPMIN, CODLOCAL, CONTROLE, NUTAB, VLRVENDA
        FROM ITENS WHERE RN=1 AND VLRVENDA>0 ORDER BY CODEMP,CODTAB,CODPROD`;
}
