type Lot = { DTVAL?: unknown; CODLOCAL?: unknown; CONTROLE?: unknown };

function expiry(value: unknown) {
  const text = String(value ?? '').trim();
  const compact = text.match(/^(\d{2})(\d{2})(\d{4})(?:\s|$)/);
  const slash = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const parts = compact ?? slash;
  const time = parts ? Date.UTC(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1])) : Date.parse(text);
  return Number.isFinite(time) ? time : Infinity;
}

export function compareLotExpiry(a: Lot, b: Lot) {
  const left = expiry(a.DTVAL), right = expiry(b.DTVAL);
  return (left === right ? 0 : left < right ? -1 : 1)
    || Number(a.CODLOCAL ?? 0) - Number(b.CODLOCAL ?? 0)
    || String(a.CONTROLE ?? '').localeCompare(String(b.CONTROLE ?? ''));
}

type Item = { product: number; quantity: number; location: number; control: string; unitPrice: number; priceTable: number };

// Aloca FEFO com o saldo atual do ERP; nunca soma estoque de outros locais.
// O mapa é compartilhado entre as linhas para não usar o mesmo saldo duas vezes.
export function allocateOrderLots<T extends Item>(items: T[], rows: Record<string, unknown>[]): T[] {
  const stock = rows.filter(row => Number(row.CODLOCAL) === 1010101 && Number(row.DISPONIVEL) > 0)
    .sort(compareLotExpiry).map(row => ({ row, remaining: Number(row.DISPONIVEL) }));
  const allocated: T[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice)) throw new Error("Há itens com quantidade ou preço inválido.");
    const lots = stock.filter(lot => Number(lot.row.CODPROD) === item.product);
    const reference = lots.find(lot => String(lot.row.CONTROLE ?? '').trim() === String(item.control ?? '').trim())?.row ?? lots[0]?.row;
    if (!reference) throw new Error(`Produto ${item.product} indisponível ou não habilitado para mobilidade.`);
    if (item.priceTable !== Number(reference.NUTAB)) throw new Error(`A tabela do produto ${item.product} mudou. Atualize o pedido.`);
    const grouping = Math.max(Number(reference.AGRUPMIN || 1), 1);
    if (Math.abs(item.quantity / grouping - Math.round(item.quantity / grouping)) > 0.0001) {
      throw new Error(`O produto ${item.product} deve ser negociado em múltiplos de ${grouping}.`);
    }
    let remaining = item.quantity;
    for (const lot of lots) {
      if (remaining <= 0.0000001) break;
      const quantity = Math.min(remaining, lot.remaining);
      if (quantity <= 0) continue;
      if (Math.abs(item.unitPrice - Number(lot.row.VLRVENDA)) > 0.005) {
        throw new Error(`O preço do produto ${item.product} mudou ou difere entre lotes. Atualize o pedido.`);
      }
      allocated.push({ ...item, quantity, location: 1010101, control: String(lot.row.CONTROLE ?? ' '), priceTable: Number(lot.row.NUTAB) });
      lot.remaining -= quantity;
      remaining -= quantity;
    }
    if (remaining > 0.0000001) throw new Error(`Estoque insuficiente para o produto ${item.product} no local 1010101.`);
  }
  return allocated;
}
