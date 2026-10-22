import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { emptyClientRegistration, validateClientRegistration, validateClientStep, digits } from '../app/client-registration-model.ts';
import { companyStateRegistration } from '../app/api/_lib/cnpj-registration.ts';

const make = () => ({ ...emptyClientRegistration(123, '11111111-2222-3333-4444-555555555555'),
  tradeName: 'Cliente teste', legalName: 'Cliente teste Ltda', phone: '(66) 99999-1234', profileId: 10101009,
  contacts: [{ name: 'Comprador', phone: '(66) 99999-4321', mobile: '', email: 'comprador@example.com', role: 'Comprador' }],
  postalCode: '78820-000', street: 'Rua Exemplo', number: '100', neighborhood: 'Centro', cityId: 1, city: 'Jaciara', state: 'MT' });

test('requires only trade name, legal name and phone in basic data; profile and complete contact are mandatory', () => {
  const value = make();
  assert.equal(validateClientStep(value, 0), null);
  assert.equal(validateClientRegistration(value).phone, '66999991234');
  assert.equal(validateClientRegistration(value).postalCode, '78820000');
  for (const field of ['tradeName', 'legalName', 'phone']) assert.throws(() => validateClientRegistration({ ...value, [field]: '' }));
  assert.throws(() => validateClientRegistration({ ...value, profileId: 0 }), /perfil principal/);
  assert.throws(() => validateClientRegistration({ ...value, contacts: [] }), /contato/);
  for (const field of ['name', 'phone', 'email', 'role']) assert.throws(() => validateClientRegistration({ ...value, contacts: [{ ...value.contacts[0], [field]: '' }] }), /contato/i);
  assert.equal(validateClientRegistration({ ...value, cityId: 0 }).cityId, 0); // Resolvido e cadastrado no servidor antes do parceiro.
  assert.throws(() => validateClientRegistration({ ...value, cityId: -1 }), /cidade/);
  assert.throws(() => validateClientRegistration({ ...value, city: '' }), /cidade/);
  assert.throws(() => validateClientRegistration({ ...value, street: {} }), /corretamente/);
});

test('validates optional documents, emails and actual Sankhya field lengths without silently truncating typed data', () => {
  const value = make();
  assert.equal(validateClientRegistration({ ...value, document: '04.252.011/0001-10' }).document, '04252011000110');
  assert.equal(validateClientRegistration({ ...value, document: 'AB.CDE.FGH/0001-00' }).document, 'ABCDEFGH000100');
  for (const changed of [{ email: 'invalid' }, { invoiceEmail: 'invalid' }, { document: '1234' }, { tradeName: 'A'.repeat(61) }]) assert.throws(() => validateClientRegistration({ ...value, ...changed }));
  assert.throws(() => validateClientRegistration({ ...value, contacts: [{ ...value.contacts[0], role: 'a'.repeat(21) }] }), /cargo/);
});

test('identifies incomplete phone without incorrectly reporting filled customer names as missing', () => {
  const data = { ...make(), phone: '1234567' };
  const message = validateClientStep(data, 0);
  assert.match(message, /Telefone inválido/);
  assert.match(message, /7 dígitos/);
  assert.doesNotMatch(message, /nome fantasia|razão social/);
  assert.throws(() => validateClientRegistration(data), /7 dígitos/);
  for (const phone of ['3333-4444', '656348800', '(65) 3333-4444', '(65) 99999-4444', '+55 (65) 99999-4444']) {
    assert.equal(validateClientStep({ ...data, phone }, 0), null);
  }
  assert.match(validateClientStep({ ...data, phone: '' }, 0), /Informe o telefone/);
  assert.match(validateClientStep({ ...make(), tradeName: '' }, 0), /nome fantasia/);
  assert.match(validateClientStep({ ...make(), legalName: '' }, 0), /razão social/);
});

test('accepts shorter landline numbers for the client and contacts while preserving mobile validation and storage limits', () => {
  const data = make();
  for (const phone of ['3333-4444', '656348800']) {
    const saved = validateClientRegistration({ ...data, phone, contacts: [{ ...data.contacts[0], phone }] });
    assert.equal(saved.phone, digits(phone));
    assert.equal(saved.contacts[0].phone, digits(phone));
  }
  assert.throws(() => validateClientRegistration({ ...data, phone: '1'.repeat(14) }), /Telefone inválido/);
  assert.throws(() => validateClientRegistration({ ...data, phone: 'somente letras' }), /Telefone inválido/);
  assert.throws(() => validateClientRegistration({ ...data, mobile: '656348800' }), /celular/);
  assert.throws(() => validateClientRegistration({ ...data, contacts: [{ ...data.contacts[0], mobile: '656348800' }] }), /celular/);
});

const folder = await mkdtemp(path.join(tmpdir(), 'fv-client-registration-'));
process.env.CLIENT_REGISTRATION_DATABASE_PATH = path.join(folder, 'clients.sqlite');
const dbSource = await readFile(new URL('../db/client-registrations.ts', import.meta.url), 'utf8');
const dbJs = ts.transpileModule(dbSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const operations = await import(`data:text/javascript;base64,${Buffer.from(dbJs).toString('base64')}`);

test('durable registration locks prevent double submits, replay completed requests and isolate users', () => {
  const data = make(), owner = 116;
  assert.equal(operations.claimClientRegistration(owner, data.requestId, data).phase, 'pending');
  assert.throws(() => operations.claimClientRegistration(owner, data.requestId, data), /BUSY/);
  operations.checkpointClientRegistration(owner, data.requestId, 'contacts', 7213);
  operations.releaseClientRegistration(owner, data.requestId);
  const editedContacts = { ...data, contacts: [{ ...data.contacts[0], email: 'novo@example.com' }] };
  assert.equal(operations.claimClientRegistration(owner, data.requestId, editedContacts).partner_id, 7213);
  operations.releaseClientRegistration(owner, data.requestId);
  assert.throws(() => operations.claimClientRegistration(owner, data.requestId, { ...editedContacts, tradeName: 'Other' }), /CHANGED/);
  operations.checkpointClientRegistration(owner, data.requestId, 'done', 7213);
  assert.equal(operations.claimClientRegistration(owner, data.requestId, editedContacts).phase, 'done');
  assert.equal(operations.claimClientRegistration(151, data.requestId, data).partner_id, null);
  operations.releaseClientRegistration(151, data.requestId);
});

test('an uncertain partner creation cannot be resent automatically, even after editing the form', () => {
  const data = { ...make(), requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
  operations.claimClientRegistration(116, data.requestId, data);
  operations.checkpointClientRegistration(116, data.requestId, 'uncertain');
  operations.releaseClientRegistration(116, data.requestId);
  assert.throws(() => operations.claimClientRegistration(116, data.requestId, { ...data, tradeName: 'Other' }), /UNCERTAIN/);
});

async function service({ failContact = false, failPartner = false, uncertainPartner = false, stored = [], localityQuery, publicFetch, onSave, missingIE = false } = {}) {
  const source = await readFile(new URL('../app/api/_lib/client-registration.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/export /g, '');
  const calls = [], checkpoints = [], queries = [];
  class Rejected extends Error {}
  const call = async (_session, _module, name, body) => {
    calls.push({ name, ...body });
    if (onSave) await onSave(body);
    if (body.entityName === 'Parceiro') {
      if (missingIE) throw new Rejected('Insc. Estadual, deve ser informada.');
      if (failPartner) throw new Rejected('sensitive internal data');
      if (uncertainPartner) throw new TypeError('network failure');
      return { responseBody: { total: '1', result: [['7213']] } };
    }
    if (failContact) throw new Error('contact unavailable');
    return { responseBody: { total: String(body.records.length), result: body.records.map((_, i) => [String(i + 1)]) } };
  };
  const query = async (_session, sql) => {
    queries.push(sql);
    if (localityQuery) { const result = localityQuery(sql); if (result !== undefined) return result; }
    if (sql.includes('SELECT MIN(')) return [{ ID: 10 }];
    if (sql.includes('FROM TGFCTT')) return stored;
    if (sql.includes('FROM TGFPAR')) return [{ CODPARC: 7213, CODVEND: 123, ATIVO: 'N' }];
    return [];
  };
  const functions = new Function('callSankhya', 'executeQuery', 'SankhyaRejectedError', 'checkpointClientRegistration', 'digits', 'fetch', 'companyStateRegistration', js + ';return { completeClientRegistration, resolveRegistrationCity, preflightClient };')(
    call, query, Rejected, (...args) => checkpoints.push(args), digits, publicFetch || (() => { throw new Error('Unexpected external request'); }), companyStateRegistration);
  return { ...functions, calls, checkpoints, queries };
}
const session = { userId: 116, sellerId: 123 };

test('creates the customer and all required contacts through official entity services', async () => {
  const api = await service();
  const id = await api.completeClientRegistration(session, validateClientRegistration(make()), null);
  assert.equal(id, 7213);
  assert.deepEqual(api.calls.map(c => c.entityName), ['Parceiro', 'Contato', 'Parceiro']);
  assert.ok(api.calls.every(c => c.name === 'DatasetSP.save'));
  const partner = api.calls[0], values = partner.records[0].values;
  const get = field => values[String(partner.fields.indexOf(field))];
  assert.equal(get('CODVEND'), '123');
  assert.equal(get('CODTIPPARC'), '10101009');
  assert.equal(get('CLIENTE'), 'S');
  assert.equal(get('CLASSIFICMS'), 'R');
  assert.equal(get('ATIVO'), 'N');
  assert.deepEqual(api.calls[2].records[0], { pk: { CODPARC: '7213' }, values: { '1': 'S' } });
  assert.equal(get('TELEFONE'), '66999991234');
  const contact = api.calls[1];
  assert.deepEqual(contact.records[0].foreignKey, { CODPARC: '7213' });
  for (const field of ['NOMECONTATO', 'TELEFONE', 'EMAIL', 'CARGO']) assert.ok(contact.records[0].values[String(contact.fields.indexOf(field))]);
  assert.equal(api.checkpoints.at(-1)[2], 'done');
});

test('resumes contact failures under the existing partner, including a committed contact whose response was lost', async () => {
  const failed = await service({ failContact: true });
  await assert.rejects(failed.completeClientRegistration(session, validateClientRegistration(make()), null), error => error.partnerId === 7213);
  assert.equal(failed.checkpoints.at(-1)[2], 'contacts');
  const resumed = await service({ stored: [{ NOMECONTATO: 'COMPRADOR', TELEFONE: '66999994321', EMAIL: 'comprador@example.com', CARGO: 'COMPRADOR' }] });
  assert.equal(await resumed.completeClientRegistration(session, validateClientRegistration(make()), 7213), 7213);
  assert.equal(resumed.calls.length, 1);
  assert.deepEqual(resumed.calls[0].records[0].pk, { CODPARC: '7213' });
  assert.equal(resumed.checkpoints.at(-1)[2], 'done');
});

test('definite rejections are editable while ambiguous creations are blocked to prevent duplicates', async () => {
  const rejected = await service({ failPartner: true });
  await assert.rejects(rejected.completeClientRegistration(session, validateClientRegistration(make()), null));
  assert.equal(rejected.checkpoints.at(-1)[2], 'pending');
  const ambiguous = await service({ uncertainPartner: true });
  await assert.rejects(ambiguous.completeClientRegistration(session, validateClientRegistration(make()), null), /UNCERTAIN/);
  assert.equal(ambiguous.checkpoints.at(-1)[2], 'uncertain');
});

const missingCity = () => validateClientRegistration({ ...make(), cityId: 0, city: 'Douradina', state: 'PR', postalCode: '87485000', fiscalMunicipality: '4107256' });
const municipality = { id: 4107256, nome: 'Douradina', microrregiao: { mesorregiao: { UF: { id: 41, sigla: 'PR', nome: 'Paraná' } } } };
const localityFetch = async url => Response.json(url.includes('viacep') ? { cep: '87485-000', localidade: 'Douradina', uf: 'PR', ibge: '4107256' } : municipality);
const fieldValue = (call, field) => call.records[0].values[String(call.fields.indexOf(field))];

test('creates missing city under existing state before creating customer and contact with the new city id', async () => {
  let cityId = 0;
  const api = await service({
    publicFetch: localityFetch,
    localityQuery: sql => {
      if (sql.includes('MIN(C.CODCID)')) return [{ ID: cityId || null }];
      if (sql.includes('MIN(CODUF)')) return [{ ID: 8 }];
    },
    onSave: body => { if (body.entityName === 'Cidade') cityId = 9001; },
  });
  const data = missingCity();
  assert.equal(await api.completeClientRegistration(session, data, null), 7213);
  assert.deepEqual(api.calls.map(c => c.entityName), ['Cidade', 'Parceiro', 'Contato', 'Parceiro']);
  const [city, partner, contact] = api.calls;
  assert.equal(fieldValue(city, 'NOMECID'), 'Douradina');
  assert.equal(fieldValue(city, 'UF'), '8'); // Código interno do Sankhya, não código IBGE 41.
  assert.equal(fieldValue(city, 'CODMUNFIS'), '4107256');
  assert.equal(fieldValue(partner, 'CODCID'), '9001');
  assert.equal(fieldValue(contact, 'CODCID'), '9001');
  assert.equal(fieldValue(partner, 'CLASSIFICMS'), 'R');
  assert.equal(data.cityId, 0); // A resolução não altera o payload da chave de idempotência.
  const count = api.calls.length;
  assert.equal(await api.resolveRegistrationCity(session, data), 9001);
  assert.equal(api.calls.length, count); // Uma repetição não recria a cidade.
});

test('creates missing state first and uses confirmed internal codes for city and partner', async () => {
  let stateId = 0, cityId = 0;
  const api = await service({
    publicFetch: localityFetch,
    localityQuery: sql => {
      if (sql.includes('MIN(C.CODCID)')) return [{ ID: cityId || null }];
      if (sql.includes('MIN(CODUF)')) return [{ ID: stateId || null }];
      if (sql.includes('FROM TSIPAI')) return [{ CODPAIS: 55 }];
    },
    onSave: body => {
      if (body.entityName === 'UnidadeFederativa') stateId = 80;
      if (body.entityName === 'Cidade') cityId = 9002;
    },
  });
  assert.equal(await api.completeClientRegistration(session, missingCity(), null), 7213);
  assert.deepEqual(api.calls.map(c => c.entityName), ['UnidadeFederativa', 'Cidade', 'Parceiro', 'Contato', 'Parceiro']);
  assert.equal(fieldValue(api.calls[0], 'UF'), 'PR');
  assert.equal(fieldValue(api.calls[0], 'CODPAIS'), '55');
  assert.equal(fieldValue(api.calls[1], 'UF'), '80');
  assert.equal(fieldValue(api.calls[2], 'CODCID'), '9002');
});

test('does not create customer when locality cannot be confirmed or its creation is rejected', async () => {
  for (const options of [
    { publicFetch: async () => { throw new Error('timeout'); } },
    { publicFetch: async () => Response.json({ erro: true }) },
    { publicFetch: async () => Response.json({ localidade: 'Douradina', uf: 'MS', ibge: '5003501' }) },
    { publicFetch: async url => url.includes('viacep') ? localityFetch(url) : Response.json({ ...municipality, id: 9999999 }) },
    { publicFetch: localityFetch, localityQuery: sql => sql.includes('MIN(C.CODCID)') ? [{ ID: null }] : sql.includes('MIN(CODUF)') ? [{ ID: 8 }] : undefined,
      onSave: body => { if (body.entityName === 'Cidade') throw new Error('denied'); } },
  ]) {
    const api = await service(options);
    await assert.rejects(api.completeClientRegistration(session, missingCity(), null));
    assert.equal(api.calls.some(c => c.entityName === 'Parceiro' || c.entityName === 'Contato'), false);
    assert.equal(api.checkpoints.length, 0);
  }
});

test('finds a committed city after a lost save response without duplicating it', async () => {
  let cityId = 0;
  const api = await service({ publicFetch: localityFetch,
    localityQuery: sql => sql.includes('MIN(C.CODCID)') ? [{ ID: cityId || null }] : sql.includes('MIN(CODUF)') ? [{ ID: 8 }] : undefined,
    onSave: body => { if (body.entityName === 'Cidade') { cityId = 9003; throw new Error('network after commit'); } },
  });
  assert.equal(await api.resolveRegistrationCity(session, missingCity()), 9003);
  assert.equal(await api.resolveRegistrationCity(session, missingCity()), 9003);
  assert.equal(api.calls.length, 1);
});

const companyWithIE = (...items) => ({ estabelecimento: { cnpj: '11111111000111', inscricoes_estaduais: items.map(([state, number, active = true]) => ({ estado: { sigla: state }, inscricao_estadual: number, ativo: active })) } });

test('only selects an unambiguous active state registration for the exact company and UF', () => {
  const extract = company => companyStateRegistration(company, '11111111000111', 'PR');
  assert.equal(extract(companyWithIE(['PR', '123.456.789'], ['MS', '987654321'], ['PR', '111111111', false])), '123456789');
  assert.equal(extract(companyWithIE(['PR', '123456789'], ['PR', '123456789'])), '123456789');
  assert.equal(extract(companyWithIE(['PR', '123456789'], ['PR', '987654321'])), '');
  assert.equal(extract(companyWithIE(['MS', '123456789'])), '');
  assert.equal(companyStateRegistration(companyWithIE(['PR', '123456789']), '22222222000122', 'PR'), '');
});

test('automatically fills a verified IE without changing the saved form or duplicating its operation', async () => {
  const data = validateClientRegistration({ ...make(), document: '11111111000111', state: 'PR' });
  const api = await service({ publicFetch: async () => Response.json(companyWithIE(['PR', '123456789'])) });
  await api.completeClientRegistration(session, data, null);
  assert.equal(fieldValue(api.calls[0], 'IDENTINSCESTAD'), '123456789');
  assert.equal(fieldValue(api.calls[0], 'CLASSIFICMS'), 'R');
  assert.equal(data.stateRegistration, '');
});

test('ISENTO uses final non-contributor classification without changing the original form', async () => {
  for (const stateRegistration of ['ISENTO', 'isento', ' IsEnTo ']) {
    const data = validateClientRegistration({ ...make(), stateRegistration });
    const api = await service();
    await api.completeClientRegistration(session, data, null);
    const partner = api.calls.find(c => c.entityName === 'Parceiro');
    assert.equal(fieldValue(partner, 'CLASSIFICMS'), 'C');
    assert.equal(fieldValue(partner, 'IDENTINSCESTAD'), 'ISENTO');
    assert.equal(data.stateRegistration, stateRegistration);
  }
});

test('a numeric IE keeps the reseller classification', async () => {
  const api = await service();
  await api.completeClientRegistration(session, validateClientRegistration({ ...make(), stateRegistration: '123456789' }), null);
  assert.equal(fieldValue(api.calls[0], 'CLASSIFICMS'), 'R');
  assert.equal(fieldValue(api.calls[0], 'IDENTINSCESTAD'), '123456789');
});

test('missing IE rejection is actionable and retryable, not mistaken for city failure or uncertain creation', async () => {
  const api = await service({ missingIE: true });
  await assert.rejects(api.completeClientRegistration(session, validateClientRegistration(make()), null), error => {
    assert.equal(error.code, 'STATE_REGISTRATION_REQUIRED');
    assert.match(error.message, /inscrição estadual deve ser informada/);
    assert.match(error.message, /Dados básicos/);
    return true;
  });
  assert.equal(api.checkpoints.at(-1)[2], 'pending');
  assert.equal(api.calls.some(c => c.entityName === 'Contato'), false);
});
