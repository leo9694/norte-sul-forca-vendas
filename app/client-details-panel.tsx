"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Building2, LoaderCircle, X } from 'lucide-react';
import { clientDetailDate, clientOrderHistory, type ClientDetailRow, type ClientDetails } from './client-details-model';
import { readClientDetails, saveClientDetails } from './client-details-store';

const tabs = ['Perfil', 'Contatos', 'Endereço', 'Histórico de pedidos'];
const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function Info({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="client-detail-field"><dt>{label}</dt><dd>{value == null || value === '' ? 'Não informado' : String(value)}</dd></div>;
}

export function ClientDetailsPanel({ client, orders, userId, sessionSellerId, sellerId, online, onClose }: {
  client: ClientDetailRow; orders: ClientDetailRow[]; userId: number; sessionSellerId: number; sellerId: number; online: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [details, setDetails] = useState<ClientDetails | null>(null);
  const [loading, setLoading] = useState(online);
  const [error, setError] = useState('');
  const [cacheError, setCacheError] = useState('');
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const partnerId = Number(client.CODPARC);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let cancelled = false, networkFinished = false;
    const controller = new AbortController();
    setLoading(online); setError(''); setCacheError('');
    void readClientDetails(userId, sellerId, partnerId).then(cached => {
      if (!cancelled && !networkFinished && cached && Number(cached.client.CODPARC) === partnerId) setDetails(cached);
    }).catch(() => {});
    if (online) void (async () => {
      try {
        const response = await fetch(`/api/sankhya/clients?kind=details&partner=${partnerId}&seller=${sellerId}`, {
          cache: 'no-store', signal: controller.signal,
          headers: { 'X-FV-User-Id': String(userId), 'X-FV-Seller-Id': String(sessionSellerId) },
        });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          if ([401, 403, 404, 409].includes(response.status)) { networkFinished = true; setDetails(null); }
          throw new Error(body.error || 'Não foi possível atualizar os dados do cliente.');
        }
        if (Number(body.client?.CODPARC) !== partnerId || !Array.isArray(body.contacts) || !Array.isArray(body.orders)) throw new Error('O servidor retornou dados incompletos do cliente.');
        networkFinished = true; setDetails(body);
        try { await saveClientDetails(userId, sellerId, partnerId, body); }
        catch { if (!cancelled) setCacheError('Dados carregados, mas não foi possível guardar esta consulta para uso offline.'); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Não foi possível consultar o cliente.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [userId, sessionSellerId, sellerId, partnerId, online, retry]);

  const profile = details?.client || client;
  const history = clientOrderHistory(details?.orders || orders, partnerId);
  return <dialog ref={dialogRef} className="client-details-panel" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><span className="client-avatar"><Building2 size={23} /></span><div><span className="eyebrow">Cliente · Cód. {partnerId}</span><h2 id={`${id}-title`}>{profile.NOMEPARC}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar informações do cliente" autoFocus><X size={22} /></button></header>
    <div className="client-detail-tabs" role="tablist" aria-label="Informações do cliente">{tabs.map((label, index) => <button key={label} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-content-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next !== null) { event.preventDefault(); setTab(next); document.getElementById(`${id}-tab-${next}`)?.focus(); }
    }}>{label}</button>)}</div>
    <div className="client-details-body">
      {loading && <p className="client-detail-status" role="status"><LoaderCircle size={16} className="spin" /> Atualizando informações do cliente...</p>}
      {!online && <p className="client-detail-status">Sem internet. Exibindo os dados disponíveis neste aparelho.</p>}
      {details && <p className="client-detail-status">Última consulta: {new Date(details.savedAt).toLocaleString('pt-BR')}</p>}
      {error && <div className="global-error" role="alert">{error} <button type="button" className="secondary" onClick={() => setRetry(n => n + 1)}>Tentar novamente</button></div>}
      {cacheError && <p className="client-detail-status" role="status">{cacheError}</p>}
      {tabs.map((_, index) => <section key={index} role="tabpanel" hidden={tab !== index} id={`${id}-content-${index}`} aria-labelledby={`${id}-tab-${index}`} tabIndex={0}>
        {index === 0 && <><h3>Perfil do cliente</h3><dl className="client-detail-grid">
          <Info label="Código do parceiro" value={partnerId} /><Info label="Nome fantasia" value={profile.NOMEPARC} /><Info label="Razão social" value={profile.RAZAOSOCIAL} />
          <Info label="CPF / CNPJ" value={profile.CGCCPF} /><Info label="Inscrição estadual" value={profile.INSCESTAD} />
          <Info label="Tipo de pessoa" value={profile.TIPPESSOA === 'J' ? 'Pessoa jurídica' : profile.TIPPESSOA === 'F' ? 'Pessoa física' : null} />
          <Info label="Perfil principal" value={profile.PERFIL} /><Info label="Vendedor" value={profile.VENDEDOR || profile.CODVEND} />
          <Info label="Tabela de preço" value={client.CODTAB != null ? `Tabela ${client.CODTAB}` : 'Sem tabela definida'} />
        </dl></>}
        {index === 1 && <><h3>Contato principal</h3><dl className="client-detail-grid"><Info label="Telefone" value={profile.TELEFONE} /><Info label="Celular" value={profile.CELULAR} /><Info label="E-mail" value={profile.EMAIL} /><Info label="E-mail para NF" value={profile.EMAILNFE} /></dl>
          <h3>Contatos cadastrados</h3>{details ? details.contacts.length ? <div className="client-detail-contacts">{details.contacts.map(contact => <article key={String(contact.CODCONTATO)}><h4>{contact.NOMECONTATO}</h4><dl className="client-detail-grid"><Info label="Cargo" value={contact.CARGO} /><Info label="Telefone" value={contact.TELEFONE} /><Info label="Celular" value={contact.CELULAR} /><Info label="E-mail" value={contact.EMAIL} /></dl></article>)}</div> : <p className="client-detail-empty">Nenhum contato ativo cadastrado no Sankhya.</p> : <p className="client-detail-empty">{loading ? 'Carregando contatos...' : 'Conecte-se à internet para carregar os contatos cadastrados.'}</p>}
        </>}
        {index === 2 && <><h3>Endereço do cliente</h3><dl className="client-detail-grid">
          <Info label="CEP" value={profile.CEP} /><Info label="Endereço" value={[profile.TIPOEND, profile.ENDERECO].filter(Boolean).join(' ')} /><Info label="Número" value={profile.NUMEND} />
          <Info label="Complemento" value={profile.COMPLEMENTO} /><Info label="Bairro" value={profile.BAIRRO} /><Info label="Cidade" value={profile.NOMECID} /><Info label="Estado" value={profile.UF} /><Info label="Município fiscal (IBGE)" value={profile.CODMUNFIS} />
        </dl></>}
        {index === 3 && <><div className="client-history-heading"><h3>Histórico de pedidos</h3><span>{history.length} {history.length === 1 ? 'pedido' : 'pedidos'}</span></div>
          {!details && <p className="client-detail-status">Histórico disponível na carga deste aparelho. Conecte-se para consultar o histórico atualizado.</p>}
          {history.length ? <div className="client-detail-orders">{history.map(order => <article key={Number(order.NUNOTA)}><div><strong>Pedido {order.NUNOTA}</strong><span className={`client-order-status ${order.FATURADO === 'S' ? 'billed' : ''}`}>{order.FATURADO === 'S' ? 'Faturado' : order.STATUSNOTA === 'L' ? 'Confirmado' : 'Pendente'}</span></div><p>{Number(order.CODTIPOPER) === 6 ? 'TOP 6 · Bonificação' : 'TOP 5 · Pedido de venda'}</p><dl className="client-detail-grid"><Info label="Negociação" value={clientDetailDate(order.DTNEG)} /><Info label="Faturamento" value={order.FATURADO === 'S' ? clientDetailDate(order.DTFAT) : 'Não faturado'} /></dl><strong className="client-order-value">{currency(Number(order.VLRNOTA || 0))}</strong></article>)}</div> : <p className="client-detail-empty">{loading ? 'Carregando pedidos...' : details ? 'Nenhum pedido encontrado para este cliente nesta carteira.' : 'Nenhum pedido deste cliente disponível neste aparelho.'}</p>}
        </>}
      </section>)}
    </div>
  </dialog>;
}
