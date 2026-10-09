type Item = { CODPROD: number; CODLOCAL: number; CONTROLE: string; VLRVENDA: number; NUTAB: number };
const lotKey = (row: Record<string, unknown>) => `${Number(row.CODPROD)}:${Number(row.CODLOCAL)}:${String(row.CONTROLE ?? "").trim()}`;

// Atualiza somente preços encontrados na carga, sem remover itens/quantidades
// ou mexer nos descontos e acréscimos digitados pelo vendedor.
export function refreshDraftPrices<T extends Item>(cart: T[], rows: Record<string, unknown>[], company: number, table: number): T[] {
  const prices = new Map(rows.filter(row => Number(row.CODEMP ?? 1) === company && Number(row.CODTAB) === table)
    .map(row => [lotKey(row), row]));
  let changed = false;
  const next = cart.map(item => {
    const price = prices.get(lotKey(item));
    if (!price || !Number.isFinite(Number(price.VLRVENDA)) || Number(price.VLRVENDA) <= 0 || !Number.isFinite(Number(price.NUTAB))) return item;
    if (Number(item.VLRVENDA) === Number(price.VLRVENDA) && Number(item.NUTAB) === Number(price.NUTAB)) return item;
    changed = true;
    return { ...item, VLRVENDA: Number(price.VLRVENDA), NUTAB: Number(price.NUTAB), CODTAB: table };
  });
  return changed ? next : cart;
}
