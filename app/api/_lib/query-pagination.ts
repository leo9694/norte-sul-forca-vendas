type Row = Record<string, unknown>;

// DbExplorer pode cortar o resultado sem sinalizar erro. Valida a contagem
// e busca páginas menores que o limite do serviço antes de publicar a carga.
export async function readAllQueryRows<T extends Row>(query: (sql: string) => Promise<T[]>, sql: string, pageSize = 4000): Promise<T[]> {
  const [count] = await query(`SELECT COUNT(*) FV_TOTAL FROM (${sql})`);
  const expected = count?.FV_TOTAL == null ? NaN : Number(count.FV_TOTAL);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error("Não foi possível conferir a quantidade de registros da carga.");
  const rows: T[] = [];
  while (rows.length < expected) {
    const offset = rows.length;
    // Limita a concorrência para concluir cargas grandes sem sobrecarregar o ERP.
    const offsets = Array.from({ length: Math.min(3, Math.ceil((expected - offset) / pageSize)) }, (_, index) => offset + index * pageSize);
    const pages = await Promise.all(offsets.map(async start => {
      const page = await query(`
      SELECT * FROM (
        SELECT FV_SOURCE.*, ROWNUM FV_ROW_NUMBER FROM (${sql}) FV_SOURCE
         WHERE ROWNUM <= ${Math.min(start + pageSize, expected)}
      ) WHERE FV_ROW_NUMBER > ${start}
      ORDER BY FV_ROW_NUMBER
    `);
      if (page.length !== Math.min(pageSize, expected - start)) throw new Error("A carga retornou dados incompletos. Faça a carga novamente; a anterior foi preservada.");
      return page;
    }));
    for (const row of pages.flat()) {
      const { FV_ROW_NUMBER: _position, ...values } = row;
      rows.push(values as T);
    }
  }
  return rows;
}
