"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { cleanDocument, digits, emptyClientRegistration, emptyContact, validateClientStep, type ClientRegistration } from './client-registration-model';
import { RegistrationFeedbackPanel } from './registration-feedback-panel';

type City = { CODCID: number; NOMECID: string; UF: string; CODMUNFIS: number };
type Profile = { CODTIPPARC: number; DESCRTIPPARC: string };
const steps = ['Dados básicos', 'Perfil principal', 'Contatos', 'Endereço'];
const states = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

function Field({ label, value, onChange, onBlur, required = false, maxLength, type = 'text', disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; onBlur?: () => void; required?: boolean; maxLength?: number; type?: string; disabled?: boolean;
}) {
  return <label className="registration-field"><span>{label}{required && ' *'}</span><input type={type} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} required={required} maxLength={maxLength} disabled={disabled} /></label>;
}

export function ClientRegistrationForm({ userId, sessionSellerId, sellerId, sellerName, online, onClose, onCreated }: {
  userId: number; sessionSellerId: number; sellerId: number; sellerName: string; online: boolean;
  onClose: () => void; onCreated: (id: number, data: ClientRegistration) => void;
}) {
  const storageKey = `norte-sul-vendas:client-registration:${userId}:${sellerId}`;
  const readSaved = (key: string) => {
    const fallback = { data: emptyClientRegistration(sellerId, crypto.randomUUID()), step: 0, partnerId: 0, uncertain: false };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (!saved?.data || saved.data.sellerId !== sellerId || !Array.isArray(saved.data.contacts)) return fallback;
      for (const key of Object.keys(fallback.data) as (keyof ClientRegistration)[]) {
        if (typeof fallback.data[key] === 'string' && typeof saved.data[key] !== 'string') return fallback;
      }
      if (saved.data.contacts.some((c: Record<string, unknown>) => !c || Object.keys(emptyContact()).some(key => typeof c[key] !== 'string'))) return fallback;
      return { data: saved.data as ClientRegistration, step: Math.max(0, Math.min(3, Number(saved.step) || 0)), partnerId: Number(saved.partnerId) || 0, uncertain: Boolean(saved.uncertain) };
    } catch { return fallback; }
  };
  const [initial] = useState(() => readSaved(storageKey));
  const [recovery] = useState(() => {
    const saved = readSaved(`${storageKey}:recovery`);
    return saved.partnerId || saved.uncertain ? saved : null;
  });
  const [data, setData] = useState(initial.data);
  const [step, setStep] = useState(initial.step);
  const [partnerId, setPartnerId] = useState(initial.partnerId);
  const [uncertain, setUncertain] = useState(initial.uncertain);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [cities, setCities] = useState<City[]>([]);
  const [saving, setSaving] = useState(false);
  const [lookup, setLookup] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState('');
  const sending = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const querying = useRef(false);
  const lookupVersion = useRef(0);
  const closed = useRef(false);
  const lookupController = useRef<AbortController | null>(null);
  const headers = { 'X-FV-User-Id': String(userId), 'X-FV-Seller-Id': String(sessionSellerId) };
  const update = (key: keyof ClientRegistration, value: string | number) => {
    lookupVersion.current++;
    setData(current => ({ ...current, [key]: value }));
  };
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/sankhya/clients${path}`, { ...init, headers: { ...headers, ...init?.headers }, cache: 'no-store' });
    let body;
    try { body = await response.json(); } catch { throw new Error('O servidor não confirmou a resposta. Seus dados continuam neste aparelho.'); }
    if (!response.ok) throw Object.assign(new Error(body.error || 'Não foi possível concluir.'), { body, status: response.status });
    return body;
  };

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  useEffect(() => {
    closed.current = false;
    return () => { closed.current = true; lookupVersion.current++; lookupController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (closed.current) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ data, step, partnerId, uncertain })); setStorageError(''); }
    catch { setStorageError('Não foi possível salvar este formulário no aparelho. Mantenha a tela aberta até concluir.'); }
  }, [data, step, partnerId, uncertain, storageKey]);

  useEffect(() => {
    let cancelled = false;
    if (!online) { setProfilesLoading(false); return; }
    setProfilesLoading(true);
    request('?kind=profiles').then(result => { if (!cancelled) setProfiles(result.rows); })
      .catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setProfilesLoading(false); });
    return () => { cancelled = true; };
  }, [online, profilesVersion]);

  const findDocument = async (kind: 'cnpj' | 'cep') => {
    if (!online || saving || partnerId || uncertain || querying.current) return;
    const value = kind === 'cnpj' ? cleanDocument(data.document) : digits(data.postalCode);
    if (!(kind === 'cnpj' ? /^[A-Z0-9]{12}\d{2}$/.test(value) : /^\d{8}$/.test(value))) {
      setError(`Informe um ${kind === 'cnpj' ? 'CNPJ completo' : 'CEP com 8 dígitos'} para consultar.`); return;
    }
    const version = ++lookupVersion.current;
    const controller = new AbortController();
    lookupController.current?.abort(); lookupController.current = controller;
    querying.current = true;
    setLookup(kind); setError(''); setNotice('');
    try {
      const result = await request(`?kind=${kind}&value=${encodeURIComponent(value)}`, { signal: controller.signal });
      if (lookupVersion.current !== version) return;
      setData(current => ({ ...current, ...Object.fromEntries(Object.entries(result).filter(([, value]) => value !== '' && value != null)) }));
      setNotice('Dados preenchidos. Confira as informações antes de continuar.');
    } catch (e) { if (lookupVersion.current === version) setError(e instanceof Error ? e.message : 'Consulta indisponível.'); }
    finally { querying.current = false; if (!closed.current) setLookup(''); }
  };
  const findCities = async () => {
    if (!online || !data.state || data.city.trim().length < 2) { setError('Informe o estado e pelo menos duas letras da cidade.'); return; }
    const version = ++lookupVersion.current;
    setLookup('city'); setError('');
    try {
      const result = await request(`?kind=cities&uf=${data.state}&q=${encodeURIComponent(data.city)}`);
      if (lookupVersion.current === version) {
        setCities(result.rows);
        if (!result.rows.length) setNotice('Cidade ainda não cadastrada no Sankhya. Ao salvar, o app validará o CEP e o IBGE para cadastrar a localidade.');
      }
    } catch (e) { if (lookupVersion.current === version) setError(e instanceof Error ? e.message : 'Consulta indisponível.'); }
    finally { if (!closed.current) setLookup(''); }
  };

  const close = () => {
    if (sending.current) return;
    try {
      // Envios interrompidos preservam a chave apenas para uma retomada explícita.
      if (partnerId || uncertain) localStorage.setItem(`${storageKey}:recovery`, JSON.stringify({ data, step, partnerId, uncertain }));
      localStorage.removeItem(storageKey);
    } catch { setStorageError('Não foi possível limpar o cadastro no aparelho. Tente fechar novamente.'); return; }
    closed.current = true; lookupVersion.current++; lookupController.current?.abort();
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    const validation = validateClientStep(data, step);
    if (validation) { setError(validation); return; }
    if (step < 3) { setStep(step + 1); return; }
    for (let index = 0; index < 4; index++) {
      const message = validateClientStep(data, index);
      if (message) { setStep(index); setError(message); return; }
    }
    if (!online) { setError('Conecte-se à internet para salvar o cliente no Sankhya. O formulário foi mantido no aparelho.'); return; }
    if (sending.current || uncertain) return;
    sending.current = true; setSaving(true);
    try {
      const result = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!result.saved || !Number.isSafeInteger(result.partnerId) || result.partnerId <= 0) throw new Error('A criação não foi confirmada. Tente novamente com este mesmo formulário.');
      closed.current = true;
      try {
        localStorage.removeItem(storageKey);
        if (recovery?.data.requestId === data.requestId) localStorage.removeItem(`${storageKey}:recovery`);
      } catch { /* A chave de envio evita duplicidade mesmo se o formulário permanecer. */ }
      onCreated(result.partnerId, data);
    } catch (e) {
      const failure = e as Error & { body?: { partnerId?: number; code?: string } };
      if (failure.body?.code === 'STATE_REGISTRATION_REQUIRED') setStep(0);
      if (Number(failure.body?.partnerId) > 0) { setPartnerId(Number(failure.body?.partnerId)); setStep(2); }
      if (failure.body?.code === 'UNCERTAIN') setUncertain(true);
      setError(failure.message || 'Não foi possível salvar. Seus dados foram mantidos.');
    } finally { sending.current = false; setSaving(false); }
  };
  const locked = saving || uncertain || partnerId > 0;

  return <div className="modal-backdrop registration-backdrop" role="dialog" aria-modal="true" aria-labelledby="registration-title">
    <section className="registration-panel">
      <header><div><span className="eyebrow">Carteira de {sellerName}</span><h2 id="registration-title">Novo cliente</h2></div><button type="button" className="icon-button" disabled={saving} aria-label="Fechar e limpar cadastro" onClick={close}><X /></button></header>
      <ol className="registration-steps" aria-label="Etapas do cadastro">{steps.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={17} /> : index + 1}</span><small>{label}</small></li>)}</ol>
      <form onSubmit={submit}>
        <div className="registration-body" ref={bodyRef}>
          <p className="registration-hint">{steps[step]} · Etapa {step + 1} de 4. Campos com * são obrigatórios.</p>
          {recovery && recovery.data.requestId !== data.requestId && <div className="registration-notice">Existe um envio anterior interrompido. Para concluir sem duplicar o cliente: <button type="button" className="secondary" disabled={saving || !!lookup} onClick={() => {
            lookupVersion.current++; setData(recovery.data); setStep(recovery.step); setPartnerId(recovery.partnerId); setUncertain(recovery.uncertain); setError(''); setNotice('Envio anterior recuperado.');
          }}>Retomar envio anterior</button></div>}
          {!online && <div className="global-error" role="status">Sem internet. Você pode preencher o formulário; consultas e envio estarão disponíveis ao reconectar.</div>}
          {partnerId > 0 && <div className="registration-notice">Cliente {partnerId} já criado. Complete os contatos e continue para finalizar, sem criar outro cliente.</div>}
          {step === 0 && <>
            <div className="registration-person"><span>Tipo de cadastro: <strong>Cliente</strong></span><label><input type="radio" checked={data.personType === 'F'} disabled={locked} onChange={() => update('personType', 'F')} />Pessoa Física</label><label><input type="radio" checked={data.personType === 'J'} disabled={locked} onChange={() => update('personType', 'J')} />Pessoa Jurídica</label></div>
            <fieldset disabled={locked} className="registration-grid">
              <div className="registration-lookup"><Field label={data.personType === 'J' ? 'CNPJ' : 'CPF'} value={data.document} maxLength={18} onChange={v => update('document', v)} onBlur={() => { if (data.personType === 'J' && cleanDocument(data.document).length === 14) void findDocument('cnpj'); }} />{data.personType === 'J' && <button type="button" className="secondary" disabled={!online || !!lookup} onClick={() => void findDocument('cnpj')}>{lookup === 'cnpj' ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Consultar</button>}</div>
              <Field label="Inscrição estadual" value={data.stateRegistration} maxLength={17} onChange={v => update('stateRegistration', v)} />
              <Field label="Nome fantasia" value={data.tradeName} maxLength={60} required onChange={v => update('tradeName', v)} />
              <Field label="Razão social" value={data.legalName} maxLength={60} required onChange={v => update('legalName', v)} />
              <Field label="Telefone com DDD" value={data.phone} type="tel" maxLength={20} required onChange={v => update('phone', v)} />
              <Field label="Celular" value={data.mobile} type="tel" maxLength={20} onChange={v => update('mobile', v)} />
              <Field label="E-mail" value={data.email} type="email" maxLength={80} onChange={v => update('email', v)} />
              <Field label="E-mail para envio de NF" value={data.invoiceEmail} type="email" maxLength={255} onChange={v => update('invoiceEmail', v)} />
            </fieldset>
          </>}
          {step === 1 && <fieldset disabled={locked} className="registration-grid">
            <label className="registration-field"><span>Perfil principal *</span><select required value={data.profileId || ''} disabled={locked || profilesLoading} onChange={e => update('profileId', Number(e.target.value))}><option value="">{profilesLoading ? 'Carregando perfis...' : 'Selecione o perfil'}</option>{profiles.map(profile => <option key={profile.CODTIPPARC} value={profile.CODTIPPARC}>{profile.DESCRTIPPARC}</option>)}</select></label>
            <p className="registration-hint">O perfil será gravado no cadastro principal do cliente no Sankhya.</p>
            {!profilesLoading && !profiles.length && <button type="button" className="secondary" disabled={!online} onClick={() => setProfilesVersion(v => v + 1)}>Recarregar perfis</button>}
          </fieldset>}
          {step === 2 && <>
            <p className="registration-hint">Adicione ao menos um contato com nome, telefone, e-mail e cargo.</p>
            {data.contacts.map((contact, index) => <fieldset disabled={saving || uncertain} className="registration-contact" key={index}>
              <legend>Contato {index + 1}</legend>
              <div className="registration-grid">{([['name', 'Nome', 40, 'text'], ['phone', 'Telefone com DDD', 20, 'tel'], ['mobile', 'Celular', 20, 'tel'], ['role', 'Cargo', 20, 'text'], ['email', 'E-mail', 80, 'email']] as const).map(([key, label, max, type]) => <Field key={key} label={label} value={contact[key]} maxLength={max} type={type} required={key !== 'mobile'} onChange={value => setData(current => ({ ...current, contacts: current.contacts.map((c, i) => i === index ? { ...c, [key]: value } : c) }))} />)}</div>
              {data.contacts.length > 1 && <button className="registration-remove" type="button" onClick={() => setData(current => ({ ...current, contacts: current.contacts.filter((_, i) => i !== index) }))}><Trash2 size={15} /> Remover contato</button>}
            </fieldset>)}
            <button type="button" className="secondary" disabled={saving || uncertain || data.contacts.length >= 20} onClick={() => setData(current => ({ ...current, contacts: [...current.contacts, emptyContact()] }))}><Plus size={17} /> Novo contato</button>
          </>}
          {step === 3 && <fieldset disabled={locked} className="registration-grid">
            <div className="registration-lookup"><Field label="CEP" value={data.postalCode} maxLength={9} required onChange={v => update('postalCode', v)} onBlur={() => { if (digits(data.postalCode).length === 8) void findDocument('cep'); }} /><button type="button" className="secondary" disabled={!online || !!lookup} onClick={() => void findDocument('cep')}>{lookup === 'cep' ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Consultar</button></div>
            <Field label="Complemento" value={data.complement} maxLength={60} onChange={v => update('complement', v)} />
            <Field label="Endereço" value={data.street} maxLength={60} required onChange={v => update('street', v)} />
            <Field label="Número (ou S/N)" value={data.number} maxLength={15} required onChange={v => update('number', v)} />
            <Field label="Bairro" value={data.neighborhood} maxLength={50} required onChange={v => update('neighborhood', v)} />
            <label className="registration-field"><span>Estado *</span><select required value={data.state} onChange={e => { update('state', e.target.value); setData(current => ({ ...current, cityId: 0, fiscalMunicipality: '' })); setCities([]); }}><option value="">Selecione</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
            <div className="registration-lookup"><Field label="Cidade" value={data.city} maxLength={50} required onChange={v => { update('city', v); setData(current => ({ ...current, cityId: 0, fiscalMunicipality: '' })); setCities([]); }} /><button type="button" className="secondary" disabled={!online || !!lookup} onClick={() => void findCities()}><Search size={17} /> Buscar</button></div>
            <Field label="Município do domicílio fiscal (IBGE)" value={data.fiscalMunicipality} disabled onChange={() => {}} />
            {!data.cityId && data.city && data.state && <p className="registration-hint">Se a cidade ou UF ainda não existir no Sankhya, será cadastrada ao salvar, após validação do CEP e IBGE.</p>}
            {cities.length > 0 && <label className="registration-field"><span>Selecione a cidade no Sankhya *</span><select value={data.cityId || ''} onChange={e => { const city = cities.find(c => Number(c.CODCID) === Number(e.target.value)); if (city) { setData(current => ({ ...current, cityId: Number(city.CODCID), city: city.NOMECID, state: city.UF, fiscalMunicipality: String(city.CODMUNFIS || '') })); setCities([]); } }}><option value="">Selecione</option>{cities.map(city => <option key={city.CODCID} value={city.CODCID}>{city.NOMECID} - {city.UF}</option>)}</select></label>}
          </fieldset>}
          {notice && <div className="registration-notice" role="status">{notice}</div>}
        </div>
        <footer><span>Ao fechar, os campos deste cadastro serão limpos.</span><div>{step > 0 && <button className="secondary" type="button" disabled={saving} onClick={() => { setStep(step - 1); setError(''); }}><ArrowLeft size={16} /> Voltar</button>}<button type="submit" className="primary" disabled={saving || !!lookup || uncertain || (step === 1 && (profilesLoading || !profiles.length))}>{saving ? <><LoaderCircle size={18} className="spin" /> Salvando...</> : step === 3 ? 'Salvar cliente' : 'Continuar'}</button></div></footer>
      </form>
    </section>
    {(error || storageError) && <RegistrationFeedbackPanel kind="error" message={error || storageError} onClose={() => { setError(''); setStorageError(''); }} />}
  </div>;
}
