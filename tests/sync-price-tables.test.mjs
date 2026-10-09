import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/api/sankhya/sync/route.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function load({ tables = [{ CODEMP: 1, CODTAB: 2 }, { CODEMP: 6, CODTAB: 4 }], expired = false, failed = false } = {}) {
  const queries = [];
  const executePage = async (_session, sql) => {
    queries.push(sql);
    if (queries.length === 1) {
      if (failed) throw new Error('Falha na consulta');
      return tables;
    }
    return [];
  };
  const factory = new Function('executePage', 'requireSession', 'readAllQueryRows', 'priceInheritanceCtes',
    js.replace('export async function GET', 'return async function GET'));
  const GET = factory(executePage, async () => {
    if (expired) throw new Error('AUTH_REQUIRED');
    return { sellerId: 10 };
  }, (query, sql) => query(sql), () => 'HERANCA_PRECOS AS (SELECT 1 FROM DUAL)');
  const response = await GET(new Request('http://local/api/sankhya/sync'));
  return { queries, response, body: await response.json() };
}

test('discovers customer tables before loading products and includes every customer company', async () => {
  const { queries, response, body } = await load();
  assert.equal(response.status, 200);
  assert.deepEqual(body.tables, [{ CODEMP: 1, CODTAB: 2 }, { CODEMP: 6, CODTAB: 4 }]);
  const lookup = queries[0].split(' ORDER BY')[0];
  assert.match(lookup, /JOIN TGFPAEM E ON E.CODPARC = P.CODPARC/);
  assert.match(lookup, /JOIN TGFNTA N ON N.CODTAB = E.CODTAB/);
  assert.match(lookup, /P.CODVEND = 10/);
  assert.doesNotMatch(lookup, /MIN\(|CROSS JOIN|CODEMP =/);
  const products = queries.find(sql => sql.includes('HERANCA_PRECOS'));
  assert.ok(products.includes(lookup));
  assert.match(products, /CODEMP IN \(SELECT CODEMP FROM TABELAS\)/);
  assert.match(products, /JOIN HERANCA_PRECOS H/);
});

test('skips the expensive product query when customers have no enabled price tables', async () => {
  const { queries, response, body } = await load({ tables: [] });
  assert.equal(response.status, 200);
  assert.deepEqual(body.products, []);
  assert.ok(queries.every(sql => !sql.includes('HERANCA_PRECOS')));
});

test('requires a session and stops the load if table discovery fails', async () => {
  const expired = await load({ expired: true });
  assert.equal(expired.response.status, 401);
  assert.equal(expired.queries.length, 0);
  const failed = await load({ failed: true });
  assert.equal(failed.response.status, 500);
  assert.equal(failed.queries.length, 1);
});
