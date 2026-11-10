import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { draftSessionConflict } from '../app/api/_lib/draft-session.ts';

const source = await readFile(new URL('../app/api/sankhya/order-report/route.ts', import.meta.url), 'utf8');
test('report uses the Sankhya address, neighborhood and state lookup tables', () => {
  assert.match(source, /LEFT JOIN TSIEND E ON E\.CODEND = P\.CODEND/);
  assert.match(source, /LEFT JOIN TSIBAI B ON B\.CODBAI = P\.CODBAI/);
  assert.match(source, /LEFT JOIN TSIUFS U ON U\.CODUF = CI\.UF/);
});

async function route({ seller = 10, manager = false, expired = false, promotional = false, promotionId = 774 } = {}) {
  const queries = [];
  const session = { sellerId:10 };
  const executeQuery = async (_session, sql) => {
    queries.push(sql);
    return sql.includes('FROM TGFCAB') ? [{CODVEND:seller, CODPARC:1,NOMEPARC:'Cliente',RAZAOSOCIAL:'Cliente Ltda',ENDERECO:'Rua Teste',NUMEND:'10',CEP:'78820-000',INSCESTAD:'123',NOMECID:'Jaciara',UF:'MT',DTNEG:'2026-09-14',APELIDO:'Vendedor'}]
      : [{CODPROD:2,DESCRPROD:'Produto',REFERENCIA:'789123',QTDNEG:5,VLRTOT:50,VLRDESC:5,VLRUNIT:10,...(promotional ? {NUPROMOCAO:promotionId,PERCDESCPROM:25,PERCDESCDIGITADO:5}: {})}];
  };
  const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const factory = new Function('executeQuery','requireSession','canAnalyzeOtherSellers','readAllQueryRows','draftSessionConflict', js.replace('export async function GET','return async function GET'));
  return {queries, GET:factory(executeQuery, async () => { if(expired) throw new Error('AUTH_REQUIRED'); return session; }, async () => manager, (query, sql) => query(sql), draftSessionConflict)};
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
    assert.equal(draft.partner.RAZAOSOCIAL,'Cliente Ltda');
    assert.equal(draft.partner.ENDERECO,'Rua Teste');
    assert.equal(draft.partner.INSCESTAD,'123');
  }
});

test('duplication preserves base price, quantities and item adjustment without changing report net prices', async () => {
  const api = await route();
  const response = await api.GET(new Request('http://local?nunota=1&purpose=duplicate'));
  const { draft } = await response.json();
  assert.equal(draft.cart[0].VLRVENDA, 10);
  assert.ok(Math.abs(draft.cart[0].adjustmentPercent + 10) < 1e-8);
  assert.equal(draft.cart[0].quantity, 5);
  assert.equal(draft.cart[0].VLRVENDA * (1 + draft.cart[0].adjustmentPercent / 100) * draft.cart[0].quantity, 45);
  const stale = await route();
  assert.equal((await stale.GET(new Request('http://local?nunota=1&purpose=duplicate', { headers: { 'X-FV-Seller-Id': '20' } }))).status, 409);
  assert.equal(stale.queries.length, 0);
  assert.match(source, /readAllQueryRows\(sql => executeQuery\(session, sql\)/);
});

test('duplication of a sent promotion does not turn the old promotional discount into another manual discount', async () => {
  for (const promotionId of [774,0]) {
    const api = await route({promotional:true,promotionId});
    const {draft} = await (await api.GET(new Request('http://local?nunota=1&purpose=duplicate'))).json();
    assert.equal(draft.cart[0].VLRVENDA,10);
    assert.equal(draft.cart[0].adjustmentPercent,-5);
  }
});
