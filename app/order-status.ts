type Row = Record<string, string | number | null>;
export const isOrderBilled = (order: Row) => order.FATURADO === 'S' && order.STATUS_FATURAMENTO === 'L';
export const canDownloadOrderNfe = (order: Row) => isOrderBilled(order) && order.NFE_DISPONIVEL === 'S';
export const canDownloadOrderBoleto = (order: Row) => isOrderBilled(order) && order.BOLETO_DISPONIVEL === 'S';
export function orderConferenceLabel(order: Row): string {
  const code = String(order.STATUS_CONFERENCIA || '');
  const labels: Record<string, string> = order.ORIGEM_CONFERENCIA === 'APP'
    ? { C: 'Conferido', CD: 'Conferido com divergência', E: 'Entregue', N: 'Não entregue', P: 'Parcial', R: 'Retirado' }
    : { A: 'Em conferência', AC: 'Aguardando conferência', AL: 'Aguardando liberação', C: 'Aguardando liberação de corte', D: 'Conferência divergente', F: 'Conferido', R: 'Aguardando recontagem', RA: 'Em recontagem', RD: 'Recontagem divergente', RF: 'Conferido', Z: 'Aguardando finalização' };
  return labels[code] || 'Aguardando conferência';
}
