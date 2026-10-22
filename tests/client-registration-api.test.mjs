import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { emptyClientRegistration, validateClientRegistration, cleanDocument, digits } from '../app/client-registration-model.ts';
import { draftSessionConflict } from '../app/api/_lib/draft-session.ts';
import { companyStateRegistration } from '../app/api/_lib/cnpj-registration.ts';

const source = await readFile(new URL('../app/api/sankhya/clients/route.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/export /g, '');
const valid = () => ({ ...emptyClientRegistration(123, '11111111-2222-3333-4444-555555555555'), tradeName: 'Teste', legalName: 'Teste Ltda', phone: '66999991234', profileId: 10101009,
  contacts: [{ name: 'Contato', phone: '66999994321', mobile: '', email: 'contato@example.com', role: 'Comprador' }],
  postalCode: '78820000', street: 'Rua Teste', neighborhood: 'Centro', number: '1', cityId: 1, city: 'Jaciara', state: 'MT' });

function api({ expired = false, manager = false, completed = false, failed = false, providerFetch, missingIE = false, missingClient = false } = {}) {
  const calls = [], fetched = [];
  class PublicError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const bindings = {
    requireSession: async () => { if (expired) throw new Error('AUTH_REQUIRED'); return { userId: 116, sellerId: 123 }; },
    draftSessionConflict, canAnalyzeOtherSellers: async () => manager,
    executeQuery: async (_session, sql) => { calls.push(['query', sql]); return [{ CODVEND: 123 }]; },
    claimClientRegistration: (...args) => { calls.push(['claim', ...args]); return { phase: completed ? 'done' : 'pending', partner_id: completed ? 7213 : null }; },
    releaseClientRegistration: (...args) => calls.push(['release', ...args]),
    preflightClient: async (...args) => calls.push(['preflight', ...args]),
    completeClientRegistration: async (...args) => { calls.push(['save', ...args]); if (missingIE) throw new PublicError('Informe a inscrição estadual nos dados básicos.', 'STATE_REGISTRATION_REQUIRED'); if (failed) throw Object.assign(new Error('PRIVATE SQL TOKEN COOKIE'), { partnerId: 7213 }); return 7213; },
    validateClientRegistration, cleanDocument, digits, ClientRegistrationError: PublicError, companyStateRegistration,
    clientProfilesSql: 'SELECT CODTIPPARC,DESCRTIPPARC FROM TGFTPP',
    readAllQueryRows: (query, sql) => query(sql),
    clientCities: async () => [{ CODCID: 1, NOMECID: 'Jaciara', UF: 'MT', CODMUNFIS: 5104807 }],
    loadClientDetails: async (_session, partnerId, sellerId) => { calls.push(['details', partnerId, sellerId]); return missingClient ? null : { client: { CODPARC: partnerId, CODVEND: sellerId }, contacts: [], orders: [], savedAt: 1 }; },
    fetch: async url => { fetched.push(url); if (providerFetch) return providerFetch(url); return Response.json({ nome_fantasia: 'Empresa', razao_social: 'Empresa Ltda', cep: '78820-000', logradouro: 'Rua Exemplo', bairro: 'Centro', municipio: 'Jaciara', localidade: 'Jaciara', uf: 'MT', ibge: '5104807', codigo_municipio_ibge: 5104807, qsa: [{ secret: 'excluded' }] }); },
  };
  return { ...new Function(...Object.keys(bindings), js + ';return {GET,POST};')(...Object.values(bindings)), calls, fetched };
}
const request = (data = valid(), headers = {}) => new Request('http://local/api/sankhya/clients', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });

test('requires a session, checks tab identity and validates contacts before writes', async () => {
  const expired = api({ expired: true });
  assert.equal((await expired.POST(request())).status, 401);
  assert.deepEqual(expired.calls, []);
  const stale = api();
  assert.equal((await stale.POST(request(valid(), { 'X-FV-User-Id': '151' }))).status, 409);
  assert.deepEqual(stale.calls, []);
  const missingContact = api();
  assert.equal((await missingContact.POST(request({ ...valid(), contacts: [] }))).status, 400);
  assert.deepEqual(missingContact.calls, []);
});

test('prevents seller impersonation but permits an authorized manager to use the selected seller', async () => {
  const data = { ...valid(), sellerId: 1 };
  const denied = api();
  assert.equal((await denied.POST(request(data))).status, 403);
  assert.deepEqual(denied.calls, []);
  const allowed = api({ manager: true });
  assert.equal((await allowed.POST(request(data))).status, 200);
  assert.equal(allowed.calls.find(c => c[0] === 'save')[2].sellerId, 1);
});

test('a repeated successful request is confirmed without creating the client again', async () => {
  const existing = api({ completed: true });
  const response = await existing.POST(request());
  assert.deepEqual(await response.json(), { saved: true, partnerId: 7213 });
  assert.equal(existing.calls.filter(c => c[0] === 'save').length, 0);
});

test('partial failures return the existing partner id without exposing integration internals', async () => {
  const failed = api({ failed: true });
  const response = await failed.POST(request());
  const body = await response.json();
  assert.equal(body.partnerId, 7213);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|SQL|TOKEN|COOKIE/);
  assert.ok(failed.calls.some(c => c[0] === 'release'));
});

test('returns an actionable field code for the confirmed missing IE rejection', async () => {
  const endpoint = api({ missingIE: true });
  const response = await endpoint.POST(request());
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'STATE_REGISTRATION_REQUIRED');
  assert.equal(body.partnerId, null);
  assert.match(body.error, /inscrição estadual/);
});

test('client details enforce session, seller permission, valid identifiers and portfolio membership', async () => {
  const get = (endpoint, query = '') => endpoint.GET(new Request(`http://local/api/sankhya/clients?kind=details&partner=10198${query}`));
  const own = api();
  assert.equal((await get(own)).status, 200);
  assert.deepEqual(own.calls, [['details', 10198, 123]]);
  const denied = api();
  assert.equal((await get(denied, '&seller=99')).status, 403); assert.equal(denied.calls.length, 0);
  const allowed = api({ manager: true });
  assert.equal((await get(allowed, '&seller=99')).status, 200);
  assert.deepEqual(allowed.calls, [['details', 10198, 99]]);
  assert.equal((await get(api({ missingClient: true }))).status, 404);
  assert.equal((await get(api({ expired: true }))).status, 401);
  for (const value of ['0', '-1', '1.5', '1 OR 1=1']) {
    const invalid = api();
    assert.equal((await invalid.GET(new Request(`http://local/api/sankhya/clients?kind=details&partner=${encodeURIComponent(value)}`))).status, 400);
    assert.equal(invalid.calls.length, 0);
  }
  const stale = api();
  assert.equal((await stale.GET(new Request('http://local/api/sankhya/clients?kind=details&partner=10198', { headers: { 'X-FV-User-Id': '999' } }))).status, 409);
  assert.equal(stale.calls.length, 0);
});

test('CNPJ and CEP requests use fixed providers and return only form fields', async () => {
  const endpoint = api();
  const invalid = await endpoint.GET(new Request('http://local/api/sankhya/clients?kind=cnpj&value=https://attacker.example'));
  assert.equal(invalid.status, 400);
  assert.deepEqual(endpoint.fetched, []);
  const cnpj = await endpoint.GET(new Request('http://local/api/sankhya/clients?kind=cnpj&value=11.111.111/0001-11'));
  const company = await cnpj.json();
  assert.equal(company.tradeName, 'Empresa');
  assert.equal(company.cityId, 1);
  assert.equal(company.postalCode, '78820000');
  assert.equal(company.qsa, undefined);
  assert.equal(endpoint.fetched[0], 'https://brasilapi.com.br/api/cnpj/v1/11111111000111');
  const cep = await endpoint.GET(new Request('http://local/api/sankhya/clients?kind=cep&value=78820-000'));
  const address = await cep.json();
  assert.equal(address.tradeName, undefined);
  assert.equal(address.cityId, 1);
  assert.equal(endpoint.fetched[1], 'https://viacep.com.br/ws/78820000/json/');
});

test('CNPJ falls back on blocked, malformed, timed out or incomplete primary responses', async () => {
  for (const primary of [() => new Response('Forbidden', { status: 403 }), () => new Response('not JSON'), () => { throw new Error('timeout'); }, () => Response.json({ message: 'Unavailable' })]) {
    const endpoint = api({ providerFetch: url => url.includes('brasilapi') ? primary() : Response.json({
      razao_social: 'Empresa Ltda', socios: [{ secret: 'excluded' }], estabelecimento: {
        cnpj: '11111111000111', nome_fantasia: 'Loja', ddd1: '66', telefone1: '999991234',
        cep: '78820000', tipo_logradouro: 'RUA', logradouro: 'Teste', numero: '20', bairro: 'Centro',
        cidade: { nome: 'Jaciara', ibge_id: 5104807 }, estado: { sigla: 'MT' },
      },
    }) });
    const response = await endpoint.GET(new Request('http://local/api/sankhya/clients?kind=cnpj&value=11111111000111'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.tradeName, 'Loja'); assert.equal(body.phone, '66999991234');
    assert.equal(body.street, 'RUA Teste'); assert.equal(body.cityId, 1);
    assert.equal(body.socios, undefined);
    assert.equal(endpoint.fetched[1], 'https://publica.cnpj.ws/cnpj/11111111000111');
  }
});

test('CNPJ distinguishes missing records from outages and rate limits', async () => {
  for (const status of [404, 429, 503]) {
    const endpoint = api({ providerFetch: () => new Response('', { status }) });
    const response = await endpoint.GET(new Request('http://local/api/sankhya/clients?kind=cnpj&value=11111111000111'));
    assert.equal(response.status, 503);
    const { error } = await response.json();
    assert.match(error, status === 404 ? /não encontrado/ : /indisponíveis ou com limite/);
    assert.equal(endpoint.fetched.length, 2);
  }
});
