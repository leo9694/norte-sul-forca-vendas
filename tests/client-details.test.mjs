import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { clientOrderHistory, clientDetailDate } from '../app/client-details-model.ts';

test('offline history only includes this client, de-duplicates refreshed orders and keeps newest first', () => {
  const orders = clientOrderHistory([
    { CODPARC: 1, NUNOTA: 10, CODTIPOPER: 5, FATURADO: 'N' },
    { CODPARC: 2, NUNOTA: 20 },
    { CODPARC: 1, NUNOTA: 11, CODTIPOPER: 6 },
    { CODPARC: 1, NUNOTA: 10, CODTIPOPER: 5, FATURADO: 'S' },
  ], 1);
  assert.deepEqual(orders.map(o => o.NUNOTA), [11, 10]);
  assert.equal(orders[1].FATURADO, 'S');
  assert.equal(clientDetailDate('2026-10-20T01:00:00Z'), '20/10/2026');
  assert.equal(clientDetailDate('20/10/2026 00:00:00'), '20/10/2026');
  assert.equal(clientDetailDate(null), 'Não informada');
});

const source = await readFile(new URL('../app/api/_lib/client-details.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/export /g, '');
function service(found = true) {
  const queries = [], paginated = [];
  const query = async (_session, sql) => { queries.push(sql); return sql.includes('FROM TGFPAR P') ? found ? [{ CODPARC: 10198, CODVEND: 123 }] : [] : [{ result: 'row' }]; };
  const readAll = async (query, sql) => { paginated.push(sql); return query(sql); };
  return { load: new Function('executeQuery', 'readAllQueryRows', js + ';return loadClientDetails;')(query, readAll), queries, paginated };
}
test('only loads contacts and complete order history after verifying the client belongs to the seller', async () => {
  const denied = service(false);
  assert.equal(await denied.load({}, 10198, 123), null);
  assert.equal(denied.queries.length, 1); assert.equal(denied.paginated.length, 0);
  const allowed = service();
  const result = await allowed.load({}, 10198, 123);
  assert.equal(result.client.CODPARC, 10198);
  assert.equal(result.contacts.length, 1); assert.equal(result.orders.length, 1);
  assert.ok(result.savedAt > 0);
  assert.match(allowed.queries[0], /P.CODPARC=10198 AND P.CODVEND=123/);
  assert.match(allowed.queries[0], /P.IDENTINSCESTAD INSCESTAD/);
  assert.doesNotMatch(allowed.queries[0], /CLASSIFICMS|P\.BAIRRO|P\.INSCESTAD/);
  assert.match(allowed.paginated[0], /CODPARC=10198 AND ATIVO='S'/);
  assert.match(allowed.paginated[1], /C.CODPARC=10198 AND C.CODVEND=123/);
  assert.match(allowed.paginated[1], /C.CODTIPOPER IN \(5,6\)/);
  assert.doesNotMatch(allowed.paginated[1], /ROWNUM|TRUNC\(SYSDATE|DTNEG\s*[<>]=/);
});
