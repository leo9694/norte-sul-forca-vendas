import { callSankhya, executeQuery, SankhyaRejectedError, type SankhyaSession } from './sankhya';
import { checkpointClientRegistration } from '../../../db/client-registrations';
import { digits, type ClientRegistration } from '../../client-registration-model';
import { companyStateRegistration } from './cnpj-registration';

export class ClientRegistrationError extends Error {
  constructor(message: string, public code?: 'STATE_REGISTRATION_REQUIRED') { super(message); }
}
export const quoteSql = (text: string) => `'${text.replace(/'/g, "''")}'`;
export const clientProfilesSql = `SELECT CODTIPPARC,DESCRTIPPARC FROM TGFTPP
  WHERE CODTIPPARC>0 AND ATIVO='S' AND ANALITICO='S' AND NVL(AD_MOBILIDADE,'N')='S'`;

export async function clientCities(session: SankhyaSession, query: string, uf: string, ibge = '') {
  if (!/^[A-Z]{2}$/.test(uf)) return [];
  if (!ibge && query.trim().length < 2) return [];
  const normalized = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return executeQuery(session, `SELECT * FROM (
    SELECT C.CODCID,C.NOMECID,U.UF,C.CODMUNFIS FROM TSICID C JOIN TSIUFS U ON U.CODUF=C.UF
     WHERE U.UF=${quoteSql(uf)} AND ${ibge && /^\d{7}$/.test(ibge)
      ? `C.CODMUNFIS=${Number(ibge)}` : `TRANSLATE(UPPER(C.NOMECID),'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC') LIKE ${quoteSql(normalized + '%')}`}
     ORDER BY C.NOMECID,C.CODCID) WHERE ROWNUM<=50`);
}

export async function saveClientDataset(session: SankhyaSession, entityName: string, fields: string[], records: unknown[]) {
  const result = await callSankhya(session, 'mge', 'DatasetSP.save', { entityName, standAlone: false, fields, records });
  return result.responseBody as { total?: string; result?: unknown[][] } | undefined;
}
const values = (fields: string[], record: Record<string, string | number>) => Object.fromEntries(fields.flatMap((field, index) => record[field] == null ? [] : [[String(index), String(record[field])]]));

async function dimension(session: SankhyaSession, entity: string, table: string, id: string, field: string, name: string, extra: Record<string, string> = {}) {
  const aliases: Record<string, string[]> = { RUA: ['RUA', 'R'], AV: ['AV', 'AV.', 'AVENIDA'], TRAV: ['TRAV', 'TRAVESSA', 'TV'], ROD: ['ROD', 'RODOVIA'], EST: ['EST', 'ESTRADA'], AL: ['AL', 'ALAMEDA'], PCA: ['PCA', 'PRACA', 'PRAÇA'] };
  const typeFilter = extra.TIPO ? ` AND UPPER(TRIM(TIPO)) IN (${(aliases[extra.TIPO] || [extra.TIPO]).map(quoteSql).join(',')})` : '';
  const find = () => executeQuery(session, `SELECT MIN(${id}) ID FROM ${table} WHERE UPPER(TRIM(${field}))=${quoteSql(name.trim().toUpperCase())}${typeFilter}`);
  let [existing] = await find();
  if (Number(existing?.ID) > 0) return Number(existing.ID);
  const fields = [id, field, ...Object.keys(extra)];
  try {
    const response = await saveClientDataset(session, entity, fields, [{ values: values(fields, { [field]: name.trim(), ...extra }) }]);
    const code = Number(response?.result?.[0]?.[0]);
    if (code > 0) return code;
  } catch (error) {
    // Se a resposta caiu após a gravação, encontra o registro antes de repetir.
    [existing] = await find();
    if (Number(existing?.ID) > 0) return Number(existing.ID);
    throw error;
  }
  [existing] = await find();
  if (Number(existing?.ID) > 0) return Number(existing.ID);
  throw new Error('DIMENSION_NOT_CONFIRMED');
}

const normalizedCity = (name: string) => name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

async function publicLocality(url: string) {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new ClientRegistrationError('Não foi possível validar a cidade pelo CEP e IBGE agora. Seus dados foram mantidos; tente novamente.'); }
}

// Só grava localidades durante o envio do cadastro, nunca nas consultas GET.
export async function resolveRegistrationCity(session: SankhyaSession, data: ClientRegistration): Promise<number> {
  if (data.cityId > 0) return data.cityId;
  const cep = await publicLocality(`https://viacep.com.br/ws/${data.postalCode}/json/`);
  if (cep.erro || !/^\d{7}$/.test(String(cep.ibge || '')) || cep.uf !== data.state || normalizedCity(String(cep.localidade || '')) !== normalizedCity(data.city)) {
    throw new ClientRegistrationError('A cidade e o estado devem corresponder ao CEP informado. Consulte o CEP novamente e confira o endereço.');
  }
  const city = await publicLocality(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${cep.ibge}`);
  const state = city.microrregiao?.mesorregiao?.UF || city['regiao-imediata']?.['regiao-intermediaria']?.UF;
  if (String(city.id) !== String(cep.ibge) || typeof city.nome !== 'string' || city.nome.length > 50 || normalizedCity(city.nome) !== normalizedCity(data.city) || state?.sigla !== data.state || typeof state.nome !== 'string') {
    throw new ClientRegistrationError('O município e a UF não foram confirmados pelo IBGE. Confira o CEP antes de continuar.');
  }
  const findState = () => executeQuery(session, `SELECT MIN(CODUF) ID FROM TSIUFS WHERE UF=${quoteSql(data.state)}`);
  const findCity = () => executeQuery(session, `SELECT MIN(C.CODCID) ID FROM TSICID C JOIN TSIUFS U ON U.CODUF=C.UF WHERE U.UF=${quoteSql(data.state)} AND (C.CODMUNFIS=${Number(city.id)} OR (NVL(C.CODMUNFIS,0)=0 AND TRANSLATE(UPPER(TRIM(C.NOMECID)),'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC')=${quoteSql(normalizedCity(city.nome))}))`);
  // Confirma por consulta mesmo após timeout: uma resposta perdida não deve duplicar a localidade.
  const ensure = async (entity: string, record: Record<string, string | number>, find: () => Promise<Record<string, unknown>[]>) => {
    const [existing] = await find();
    if (Number(existing?.ID) > 0) return Number(existing.ID);
    try {
      const fields = [entity === 'Cidade' ? 'CODCID' : 'CODUF', ...Object.keys(record)];
      await saveClientDataset(session, entity, fields, [{ values: values(fields, record) }]);
    } catch {
      const [saved] = await find();
      if (Number(saved?.ID) > 0) return Number(saved.ID);
      throw new ClientRegistrationError(`Não foi possível cadastrar ${entity === 'Cidade' ? 'a cidade' : 'o estado'} no Sankhya. Verifique as permissões de cadastro de localidades. Os dados do cliente foram mantidos.`);
    }
    const [saved] = await find();
    if (Number(saved?.ID) > 0) return Number(saved.ID);
    throw new ClientRegistrationError('O Sankhya não confirmou o cadastro da localidade. Tente novamente com este formulário.');
  };
  const [existingCity] = await findCity();
  if (Number(existingCity?.ID) > 0) return Number(existingCity.ID);
  let [existingState] = await findState();
  let stateId = Number(existingState?.ID || 0);
  if (!stateId) {
    const [country] = await executeQuery(session, "SELECT CODPAIS FROM TSIPAI WHERE UPPER(DESCRICAO)='BRASIL'");
    if (!Number(country?.CODPAIS)) throw new ClientRegistrationError('Cadastre o país Brasil no Sankhya antes de cadastrar esta UF.');
    stateId = await ensure('UnidadeFederativa', { UF: state.sigla, DESCRICAO: state.nome, CODPAIS: Number(country.CODPAIS) }, findState);
  }
  return ensure('Cidade', { NOMECID: city.nome, UF: stateId, CODMUNFIS: Number(city.id) }, findCity);
}

export async function preflightClient(session: SankhyaSession, data: ClientRegistration, partnerId: number | null) {
  const profiles = await executeQuery(session, `${clientProfilesSql} AND CODTIPPARC=${data.profileId}`);
  if (!profiles.length) throw new ClientRegistrationError('O perfil principal selecionado não está disponível para cadastro no app.');
  if (data.cityId > 0) {
    const city = await executeQuery(session, `SELECT C.CODCID,C.NOMECID,U.UF,C.CODMUNFIS FROM TSICID C JOIN TSIUFS U ON U.CODUF=C.UF WHERE C.CODCID=${data.cityId} AND U.UF=${quoteSql(data.state)}`);
    if (!city.length) throw new ClientRegistrationError('Selecione uma cidade válida do Sankhya para o estado informado.');
  }
  if (!partnerId && data.document) {
    const duplicates = await executeQuery(session, `SELECT CODPARC FROM TGFPAR WHERE REGEXP_REPLACE(UPPER(CGC_CPF),'[^A-Z0-9]','')=${quoteSql(data.document)} AND ROWNUM<=1`);
    if (duplicates.length) throw new ClientRegistrationError('Já existe um parceiro com este CPF/CNPJ no Sankhya. Consulte o cadastro existente antes de continuar.');
  }
}

export async function completeClientRegistration(session: SankhyaSession, data: ClientRegistration, existingPartnerId: number | null) {
  let partnerId = existingPartnerId;
  try {
  data = { ...data, cityId: await resolveRegistrationCity(session, data) };
  if (!partnerId) {
    let stateRegistration = data.stateRegistration.trim();
    if (!stateRegistration && data.personType === 'J' && /^[A-Z0-9]{12}\d{2}$/.test(data.document)) {
      try {
        const response = await fetch(`https://publica.cnpj.ws/cnpj/${data.document}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
        if (response.ok) stateRegistration = companyStateRegistration(await response.json(), data.document, data.state);
      } catch { /* Mantém o preenchimento manual; não inventa IE ou isenção. */ }
    }
    const exempt = stateRegistration.toUpperCase() === 'ISENTO';
    if (exempt) stateRegistration = 'ISENTO';
    const match = data.street.trim().match(/^(Rua|Avenida|Av\.?|Travessa|Rodovia|Estrada|Alameda|Praça)\s+(.+)$/i);
    const types: Record<string, string> = { rua: 'RUA', avenida: 'AV', av: 'AV', 'av.': 'AV', travessa: 'TRAV', rodovia: 'ROD', estrada: 'EST', alameda: 'AL', praça: 'PCA' };
    const streetId = await dimension(session, 'Endereco', 'TSIEND', 'CODEND', 'NOMEEND', match?.[2] || data.street, { TIPO: match ? types[match[1].toLowerCase()] : '' });
    const neighborhoodId = await dimension(session, 'Bairro', 'TSIBAI', 'CODBAI', 'NOMEBAI', data.neighborhood);
    const record: Record<string, string | number> = {
      NOMEPARC: data.tradeName.trim(), RAZAOSOCIAL: data.legalName.trim(), TELEFONE: data.phone,
      TIPPESSOA: data.personType, CLIENTE: 'S', ATIVO: 'N', CODVEND: data.sellerId, CODTIPPARC: data.profileId, CLASSIFICMS: exempt ? 'C' : 'R',
      CODCID: data.cityId, CODEND: streetId, CODBAI: neighborhoodId, CEP: data.postalCode,
      NUMEND: data.number.trim(), COMPLEMENTO: data.complement.trim(),
      ...(data.document ? { CGC_CPF: data.document } : {}), ...(stateRegistration ? { IDENTINSCESTAD: stateRegistration } : {}),
      ...(data.mobile ? { FAX: data.mobile } : {}), ...(data.email.trim() ? { EMAIL: data.email.trim() } : {}),
      ...(data.invoiceEmail.trim() ? { EMAILNFE: data.invoiceEmail.trim() } : {}),
    };
    const fields = ['CODPARC', ...Object.keys(record)];
    checkpointClientRegistration(session.userId, data.requestId, 'creating');
    let response;
    try { response = await saveClientDataset(session, 'Parceiro', fields, [{ values: values(fields, record) }]); }
    catch (error) {
      checkpointClientRegistration(session.userId, data.requestId, error instanceof SankhyaRejectedError ? 'pending' : 'uncertain');
      if (!(error instanceof SankhyaRejectedError)) throw new Error('REGISTRATION_UNCERTAIN');
      const message = error.message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (/insc.*estadual/.test(message) && /informad|obrigator|preench/.test(message)) {
        throw new ClientRegistrationError('A inscrição estadual deve ser informada para cadastrar este cliente. Preencha o campo Inscrição estadual na etapa Dados básicos e tente salvar novamente. Seus dados foram mantidos.', 'STATE_REGISTRATION_REQUIRED');
      }
      throw error;
    }
    partnerId = Number(response?.result?.[0]?.[0]);
    if (!Number.isSafeInteger(partnerId) || partnerId <= 0) {
      checkpointClientRegistration(session.userId, data.requestId, 'uncertain');
      throw new Error('REGISTRATION_UNCERTAIN');
    }
    checkpointClientRegistration(session.userId, data.requestId, 'contacts', partnerId);
  }
  const [partner] = await executeQuery(session, `SELECT CODPARC,CODVEND,ATIVO FROM TGFPAR WHERE CODPARC=${partnerId}`);
  if (!partner || Number(partner.CODVEND) !== data.sellerId) throw new ClientRegistrationError('O vendedor do cadastro foi alterado no Sankhya. Peça ao suporte para conferir antes de continuar.');

  const stored = await executeQuery(session, `SELECT CODCONTATO,NOMECONTATO,TELEFONE,EMAIL,CARGO FROM TGFCTT WHERE CODPARC=${partnerId} AND ATIVO='S'`);
  const contactKey = (name: string, phone: string, email: string, role: string) => [name.trim().toLocaleUpperCase('pt-BR'), digits(phone), email.trim().toLowerCase(), role.trim().toLocaleUpperCase('pt-BR')].join('|');
  const available = new Map<string, number>();
  for (const c of stored) {
    const key = contactKey(String(c.NOMECONTATO || ''), String(c.TELEFONE || ''), String(c.EMAIL || ''), String(c.CARGO || ''));
    available.set(key, (available.get(key) || 0) + 1);
  }
  const missing = data.contacts.filter(c => {
    const key = contactKey(c.name, c.phone, c.email, c.role), count = available.get(key) || 0;
    if (!count) return true;
    available.set(key, count - 1);
    return false;
  });
  if (missing.length) {
    const fields = ['CODCONTATO', 'ATIVO', 'NOMECONTATO', 'TELEFONE', 'EMAIL', 'CARGO', 'CELULAR', 'CODCID'];
    const response = await saveClientDataset(session, 'Contato', fields, missing.map(c => ({ foreignKey: { CODPARC: String(partnerId) },
      values: values(fields, { ATIVO: 'S', NOMECONTATO: c.name, TELEFONE: c.phone, EMAIL: c.email, CARGO: c.role, CODCID: data.cityId, ...(c.mobile ? { CELULAR: c.mobile } : {}) }) })));
    if (Number(response?.total) !== missing.length) throw new Error('CONTACTS_NOT_CONFIRMED');
  }
  // Só libera na carteira após confirmar pelo menos um contato completo.
  if (partner.ATIVO !== 'S') {
    const activated = await saveClientDataset(session, 'Parceiro', ['CODPARC', 'ATIVO'], [{ pk: { CODPARC: String(partnerId) }, values: { '1': 'S' } }]);
    if (Number(activated?.total) !== 1) throw new Error('ACTIVATION_NOT_CONFIRMED');
  }
  checkpointClientRegistration(session.userId, data.requestId, 'done', partnerId);
  return partnerId;
  } catch (error) {
    if (partnerId && partnerId > 0) throw Object.assign(error instanceof Error ? error : new Error('REGISTRATION_FAILED'), { partnerId });
    throw error;
  }
}
