export type ClientDetailRow = Record<string, string | number | null>;
export type ClientDetails = {
  client: ClientDetailRow;
  contacts: ClientDetailRow[];
  orders: ClientDetailRow[];
  savedAt: number;
};

export function clientOrderHistory(rows: ClientDetailRow[], partnerId: number): ClientDetailRow[] {
  const unique = new Map<number, ClientDetailRow>();
  for (const row of rows) {
    const id = Number(row.NUNOTA);
    if (Number(row.CODPARC) === partnerId && id > 0) unique.set(id, row);
  }
  return [...unique.values()].sort((a, b) => Number(b.NUNOTA) - Number(a.NUNOTA));
}

export function clientDetailDate(value: string | number | null | undefined): string {
  if (!value) return 'Não informada';
  const date = String(value);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(date)) return date.slice(0, 10);
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : date;
}
