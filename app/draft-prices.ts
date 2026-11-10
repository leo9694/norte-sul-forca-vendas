type Item = { CODPROD: number; CODLOCAL: number; CONTROLE: string; VLRVENDA: number; NUTAB: number };

// Usa somente preços-base sem lote da tabela/empresa. Não remove itens/quantidades
// ou mexer nos descontos e acréscimos digitados pelo vendedor.
export function refreshDraftPrices<T extends Item>(cart: T[], rows: Record<string, unknown>[], company: number, table: number, strict = false): T[] {
  const prices = new Map(rows.filter(row => Number(row.CODEMP ?? 1) === company && Number(row.CODTAB) === table
      && Number(row.CODLOCAL) === 1010101 && !String(row.CONTROLE ?? '').trim())
    .map(row => [Number(row.CODPROD), row]));
  let changed = false;
  const next = cart.map(item => {
    const price = prices.get(Number(item.CODPROD));
    if (!price || !Number.isFinite(Number(price.VLRVENDA)) || Number(price.VLRVENDA) <= 0 || !Number.isFinite(Number(price.NUTAB))) {
      if (strict) throw new Error(`Produto ${item.CODPROD} sem preço válido na carga. Atualize a carga; os itens foram mantidos.`);
      return item;
    }
    if (Number(item.VLRVENDA) === Number(price.VLRVENDA) && Number(item.NUTAB) === Number(price.NUTAB) && item.CODLOCAL===1010101 && !String(item.CONTROLE ?? '').trim()) return item;
    changed = true;
    return { ...item, VLRVENDA: Number(price.VLRVENDA), NUTAB: Number(price.NUTAB), CODTAB: table, CODLOCAL: 1010101, CONTROLE: ' ' };
  });
  return changed ? next : cart;
}
