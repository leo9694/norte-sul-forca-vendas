type Source = {
  id: string; updatedAt: number; phase: string; partner: { CODPARC: number };
  cart: unknown[]; priceCode: number; priceName: string; companyCode?: number;
  sellerId?: number; sellerName?: string;
};

export function duplicateOrder<T extends Source>(source: T, partner: T['partner'], sellerId: number, sellerName: string): T {
  if (!source.cart.length) throw new Error('Este pedido não possui itens para duplicar.');
  if (!Number.isSafeInteger(Number(partner.CODPARC)) || Number(partner.CODPARC) <= 0) throw new Error('Selecione o cliente do pedido duplicado.');
  const sameClient = Number(source.partner.CODPARC) === Number(partner.CODPARC);
  const copy = structuredClone(source);
  return {
    ...copy, id: `draft-${crypto.randomUUID()}`, backupId: undefined, updatedAt: Date.now(),
    phase: 'header', partner: structuredClone(partner), sellerId, sellerName,
    // Preços e ajustes da origem não são condições comerciais da cópia.
    // O app consulta a tabela atual e só depois calcula as promoções vigentes.
    cart: copy.cart.map(item => ({
      ...(item as object), CONTROLE: ' ', VLRVENDA: 0, NUTAB: 0, adjustmentPercent: 0,
      promotionId: undefined, promotionalPrice: undefined, promotionError: undefined,
    })),
    // As condições do cliente destino são carregadas pelo fluxo normal de criação.
    companyCode: sameClient ? source.companyCode : 0,
    priceCode: sameClient ? source.priceCode : 0,
    priceName: sameClient ? source.priceName : '',
  };
}
