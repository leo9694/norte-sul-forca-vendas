import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/api/sankhya/order-report/route.ts', import.meta.url), 'utf8');
async function route({ seller = 10, manager = false, expired = false } = {}) {
  const queries = [];
  const session = { sellerId:10 };
  const executeQuery = async (_session, sql) => {
    queries.push(sql);
    return sql.includes('FROM TGFCAB') ? [{CODVEND:seller, CODPARC:1,NOMEPARC:'Cliente',DTNEG:'2026-09-14',APELIDO:'Vendedor'}]
      : [{CODPROD:2,DESCRPROD:'Produto',REFERENCIA:'789123',QTDNEG:5,VLRTOT:50,VLRDESC:5,VLRUNIT:10}];
  };
  const js = ts.transpileModule(source.replace(/^import[^\n]+\n/, ''), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const factory = new Function('executeQuery','requireSession','canAnalyzeOtherSellers', js.replace('export async function GET','return async function GET'));
  return {queries, GET:factory(executeQuery, async () => { if(expired) throw new Error('AUTH_REQUIRED'); return session; }, async () => manager)};
}
test('report requires a session and validates the order identifier', async () => {
  const expired = await route({expired:true});
  assert.equal((await expired.GET(new Request('http://local?nunota=1'))).status,401);
  const valid = await route();
  assert.equal((await valid.GET(new Request('http://local?nunota=0'))).status,400);
  assert.equal(valid.queries.length,0);
});
test('report denies another seller before reading items', async () => {
  const api = await route({seller:20});
  assert.equal((await api.GET(new Request('http://local?nunota=1'))).status,403);
  assert.equal(api.queries.length,1);
});
test('report carries item references and net prices for owner and manager', async () => {
  for (const settings of [{}, {seller:20,manager:true}]) {
    const api = await route(settings);
    const response = await api.GET(new Request('http://local?nunota=1'));
    assert.equal(response.status,200);
    const {draft} = await response.json();
    assert.equal(draft.cart[0].REFERENCIA,'789123');
    assert.equal(draft.cart[0].VLRVENDA,9);
    assert.equal(draft.cart[0].quantity,5);
    assert.equal(draft.id,'pedido-1');
  }
});
