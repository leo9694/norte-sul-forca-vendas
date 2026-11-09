// Apenas documentos de saída das TOPs fiscais; conferência pode existir antes da confirmação.
export const invoiceCondition = (alias = 'F', confirmed = true) => `${alias}.CODTIPOPER IN (35, 10) AND ${alias}.TIPMOV = 'V'${confirmed ? ` AND ${alias}.STATUSNOTA = 'L'` : ''}`;
export const linkedInvoiceQuery = (orderAlias = 'C', confirmed = true) => `FROM TGFVAR V JOIN TGFCAB F ON F.NUNOTA = V.NUNOTA
  WHERE V.NUNOTAORIG = ${orderAlias}.NUNOTA AND ${invoiceCondition('F', confirmed)}`;

export function orderBillingFields(orderAlias = 'C') {
  const confirmed = linkedInvoiceQuery(orderAlias);
  const conference = `FROM TGFVAR V JOIN TGFCAB F ON F.NUNOTA = V.NUNOTA
    LEFT JOIN TGFCON2 CF ON CF.NUCONF = F.NUCONFATUAL
    WHERE V.NUNOTAORIG = ${orderAlias}.NUNOTA AND ${invoiceCondition('F', false)}`;
  return `
    (SELECT MAX(F.DTENTSAI) ${confirmed}) DTFAT,
    (SELECT MAX(F.STATUSNOTA) ${confirmed}) STATUS_FATURAMENTO,
    CASE WHEN EXISTS (SELECT 1 ${confirmed}) THEN 'S' ELSE 'N' END FATURADO,
    (SELECT MAX(NVL(F.AD_STATUS_CONFERENCIA_Z, CF.STATUS)) KEEP (DENSE_RANK LAST ORDER BY F.NUNOTA) ${conference}) STATUS_CONFERENCIA,
    (SELECT MAX(CASE WHEN F.AD_STATUS_CONFERENCIA_Z IS NOT NULL THEN 'APP' ELSE 'PADRAO' END) KEEP (DENSE_RANK LAST ORDER BY F.NUNOTA) ${conference}) ORIGEM_CONFERENCIA,
    CASE WHEN EXISTS (SELECT 1 ${confirmed} AND F.STATUSNFE = 'A'
      AND EXISTS (SELECT 1 FROM TGFNFE N WHERE N.NUNOTA = F.NUNOTA AND LENGTH(TRIM(N.CHAVENFE)) = 44)) THEN 'S' ELSE 'N' END NFE_DISPONIVEL,
    CASE WHEN EXISTS (SELECT 1 ${confirmed}
      AND EXISTS (SELECT 1 FROM TGFFIN FIN WHERE FIN.NUNOTA = F.NUNOTA AND FIN.DHBAIXA IS NULL
        AND NVL(FIN.VLRBAIXA, 0) <= 0 AND FIN.CODCTABCOINT > 0)) THEN 'S' ELSE 'N' END BOLETO_DISPONIVEL`;
}
