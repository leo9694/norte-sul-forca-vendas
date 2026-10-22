import { requireSession, canAnalyzeOtherSellers } from '../../_lib/sankhya';
import { draftSessionConflict } from '../../_lib/draft-session';
import { clientCities, clientProfilesSql, completeClientRegistration, preflightClient, ClientRegistrationError } from '../../_lib/client-registration';
import { executeQuery } from '../../_lib/sankhya';
import { cleanDocument, digits, validateClientRegistration } from '../../../client-registration-model';
import { claimClientRegistration, releaseClientRegistration } from '../../../../db/client-registrations';
import { readAllQueryRows } from '../../_lib/query-pagination';
import { companyStateRegistration } from '../../_lib/cnpj-registration';
import { loadClientDetails } from '../../_lib/client-details';

async function lookupCompany(value: string) {
  const urls = [`https://brasilapi.com.br/api/cnpj/v1/${value}`, `https://publica.cnpj.ws/cnpj/${value}`];
  let missing = 0;
  for (const [index, url] of urls.entries()) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
      if (response.status === 404) missing++;
      if (!response.ok) continue;
      const data = await response.json();
      if (typeof data?.razao_social !== 'string' || !data.razao_social.trim()) continue;
      if (index === 0) return data;
      const e = data.estabelecimento;
      if (!e || cleanDocument(String(e.cnpj || '')) !== value) continue;
      return {
        razao_social: data.razao_social, nome_fantasia: e.nome_fantasia,
        ddd_telefone_1: `${e.ddd1 || ''}${e.telefone1 || ''}`, email: e.email,
        numero: e.numero, complemento: e.complemento, cep: e.cep,
        descricao_tipo_de_logradouro: e.tipo_logradouro, logradouro: e.logradouro,
        bairro: e.bairro, municipio: e.cidade?.nome, uf: e.estado?.sigla,
        codigo_municipio_ibge: e.cidade?.ibge_id,
        stateRegistration: companyStateRegistration(data, value, String(e.estado?.sigla || '')),
      };
    } catch { /* Bloqueios, timeout e respostas inválidas devem tentar a outra fonte. */ }
  }
  throw new ClientRegistrationError(missing === urls.length
    ? 'CNPJ não encontrado nas bases consultadas. Confira o número ou preencha manualmente.'
    : 'Os serviços de consulta de CNPJ estão indisponíveis ou com limite de consultas. Tente novamente em alguns instantes ou preencha manualmente.');
}

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const conflict = draftSessionConflict(request, session);
    if (conflict) return conflict;
    const params = new URL(request.url).searchParams, kind = params.get('kind');
    if (kind === 'details') {
      const partnerId = Number(params.get('partner')), sellerId = Number(params.get('seller') || session.sellerId);
      if (!Number.isSafeInteger(partnerId) || partnerId <= 0 || !Number.isSafeInteger(sellerId) || sellerId <= 0) return Response.json({ error: 'Cliente ou vendedor inválido.' }, { status: 400 });
      if (sellerId !== session.sellerId && !(await canAnalyzeOtherSellers(session))) return Response.json({ error: 'Você não possui permissão para consultar esta carteira.' }, { status: 403 });
      const details = await loadClientDetails(session, partnerId, sellerId);
      return details ? Response.json(details) : Response.json({ error: 'Cliente não encontrado nesta carteira.' }, { status: 404 });
    }
    if (kind === 'profiles') {
      return Response.json({ rows: await readAllQueryRows(sql => executeQuery(session, sql), clientProfilesSql + ' ORDER BY DESCRTIPPARC,CODTIPPARC') });
    }
    if (kind === 'cities') return Response.json({ rows: await clientCities(session, (params.get('q') || '').slice(0, 50), (params.get('uf') || '').toUpperCase()) });
    if (kind !== 'cnpj' && kind !== 'cep') return Response.json({ error: 'Consulta inválida.' }, { status: 400 });
    const value = kind === 'cnpj' ? cleanDocument(params.get('value') || '') : digits(params.get('value') || '');
    if (!(kind === 'cnpj' ? /^[A-Z0-9]{12}\d{2}$/.test(value) : /^\d{8}$/.test(value))) return Response.json({ error: `Confira o ${kind === 'cnpj' ? 'CNPJ' : 'CEP'} informado.` }, { status: 400 });
    let data;
    if (kind === 'cnpj') data = await lookupCompany(value);
    else {
      const response = await fetch(`https://viacep.com.br/ws/${value}/json/`, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new ClientRegistrationError('A consulta de CEP está indisponível. Tente novamente ou preencha manualmente.');
      data = await response.json();
    }
    if (data.erro) throw new ClientRegistrationError('CEP não encontrado. Confira o número ou preencha o endereço manualmente.');
    const city = String(kind === 'cnpj' ? data.municipio || '' : data.localidade || '').slice(0, 50);
    const state = String(data.uf || '').toUpperCase().slice(0, 2);
    const ibge = String(kind === 'cnpj' ? data.codigo_municipio_ibge || '' : data.ibge || '');
    let cities = await clientCities(session, city, state, ibge);
    if (!cities.length && ibge && city) cities = await clientCities(session, city, state);
    const matched = cities.length === 1 ? cities[0] : cities.find(c => String(c.NOMECID).toUpperCase() === city.toUpperCase());
    return Response.json({
      ...(kind === 'cnpj' ? {
        tradeName: String(data.nome_fantasia || data.razao_social || '').slice(0, 60), legalName: String(data.razao_social || '').slice(0, 60),
        phone: digits(String(data.ddd_telefone_1 || '')).slice(0, 13), email: String(data.email || '').slice(0, 80),
        number: String(data.numero || '').slice(0, 15), complement: String(data.complemento || '').slice(0, 60),
        stateRegistration: String(data.stateRegistration || ''),
      } : {}),
      postalCode: digits(String(data.cep || (kind === 'cep' ? value : ''))),
      street: [kind === 'cnpj' ? data.descricao_tipo_de_logradouro : '', data.logradouro].filter(Boolean).join(' ').slice(0, 60),
      neighborhood: String(data.bairro || '').slice(0, 50), city: String(matched?.NOMECID || city), state,
      cityId: Number(matched?.CODCID || 0), fiscalMunicipality: String(matched?.CODMUNFIS || ibge || ''),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'AUTH_REQUIRED') return Response.json({ error: 'Sessão expirada.' }, { status: 401 });
    return Response.json({ error: error instanceof ClientRegistrationError ? error.message : 'Não foi possível consultar os dados agora. Tente novamente ou preencha manualmente.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let owner = 0, requestId = '', claimed = false, partnerId: number | null = null;
  try {
    const session = await requireSession(request);
    const conflict = draftSessionConflict(request, session);
    if (conflict) return conflict;
    if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Envie um cadastro válido.' }, { status: 400 });
    const text = await request.text();
    if (text.length > 64_000) return Response.json({ error: 'O cadastro excedeu o tamanho permitido.' }, { status: 413 });
    let data;
    try { data = validateClientRegistration(JSON.parse(text)); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Cadastro inválido.' }, { status: 400 }); }
    if (data.sellerId !== session.sellerId && !(await canAnalyzeOtherSellers(session))) return Response.json({ error: 'Você não possui permissão para cadastrar clientes para outro vendedor.' }, { status: 403 });
    const sellers = await executeQuery(session, `SELECT CODVEND FROM TGFVEN WHERE CODVEND=${data.sellerId} AND ATIVO='S'`);
    if (!sellers.length) return Response.json({ error: 'O vendedor selecionado não está ativo.' }, { status: 400 });
    owner = session.userId; requestId = data.requestId;
    const record = claimClientRegistration(owner, requestId, data);
    claimed = true; partnerId = record.partner_id;
    if (record.phase === 'done' && partnerId) return Response.json({ saved: true, partnerId });
    await preflightClient(session, data, partnerId);
    partnerId = await completeClientRegistration(session, data, partnerId);
    return Response.json({ saved: true, partnerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const knownPartner = Number((error as { partnerId?: number })?.partnerId);
    if (Number.isSafeInteger(knownPartner) && knownPartner > 0) partnerId = knownPartner;
    if (message === 'AUTH_REQUIRED') return Response.json({ error: 'Sessão expirada.' }, { status: 401 });
    if (message === 'REGISTRATION_BUSY') return Response.json({ error: 'Este cadastro já está sendo processado. Aguarde antes de tentar novamente.' }, { status: 409 });
    if (message === 'REGISTRATION_UNCERTAIN') return Response.json({ code: 'UNCERTAIN', error: 'A resposta da criação não foi confirmada. Para evitar duplicidade, peça ao suporte para conferir o Sankhya antes de iniciar outro cadastro.' }, { status: 409 });
    if (message === 'REGISTRATION_CHANGED') return Response.json({ error: 'Este envio já foi iniciado. Mantenha os dados originais para concluir sem duplicar o cliente.' }, { status: 409 });
    return Response.json({ code: error instanceof ClientRegistrationError && error.code === 'STATE_REGISTRATION_REQUIRED' ? error.code : 'SAVE_FAILED', partnerId, error: error instanceof ClientRegistrationError ? error.message : 'Não foi possível concluir o cadastro no Sankhya. Os dados foram mantidos; tente novamente para continuar sem duplicar o cliente.' }, { status: 400 });
  } finally {
    if (claimed) {
      try { releaseClientRegistration(owner, requestId); }
      catch { console.error('Não foi possível liberar a operação de cadastro de cliente.'); }
    }
  }
}
