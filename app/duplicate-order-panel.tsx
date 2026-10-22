"use client";
import { useEffect, useId, useRef, useState } from 'react';
import { Copy, LoaderCircle, Search, X } from 'lucide-react';
import type { OrderDraft, Partner } from './sales-app';
import type { OfflineSnapshot } from './offline-store';
import { duplicateOrder } from './order-duplication';

export function DuplicateOrderPanel({ source, userId, sessionSellerId, sellerId, sellerName, online, offlineData, onClose, onDuplicate }: {
  source: OrderDraft; userId: number; sessionSellerId: number; sellerId: number; sellerName: string;
  online: boolean; offlineData: OfflineSnapshot | null; onClose: () => void; onDuplicate: (draft: OrderDraft) => Promise<void>;
}) {
  const [choice, setChoice] = useState<'same' | 'other' | null>(null);
  const [clients, setClients] = useState<Partner[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false), dialogRef = useRef<HTMLDialogElement>(null);
  const copyId = useRef<string | null>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (choice !== 'other') return;
    let cancelled = false;
    const controller = new AbortController();
    const cached = offlineData?.seller.sellerId === sellerId ? offlineData.clients as Partner[] : [];
    setClients(cached); setError(''); setLoading(online);
    if (online) void (async () => {
      try {
        const response = await fetch(`/api/sankhya/data?kind=portfolio&seller=${sellerId}`, {
          cache: 'no-store', signal: controller.signal,
          headers: { 'X-FV-User-Id': String(userId), 'X-FV-Seller-Id': String(sessionSellerId) },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Não foi possível consultar a carteira.');
        if (!Array.isArray(body.rows)) throw new Error('A carteira retornou dados inválidos.');
        if (!cancelled) setClients(body.rows);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Não foi possível consultar a carteira.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [choice, sellerId, sessionSellerId, userId, online, offlineData]);
  const term = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = clients.filter(c => `${c.CODPARC} ${c.NOMEPARC} ${c.CGCCPF || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(term));
  const target = choice === 'same' ? source.partner : clients.find(c => Number(c.CODPARC) === selected);
  const submit = async () => {
    if (!target || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const copy = duplicateOrder(source, target, sellerId, sellerName);
      copyId.current ||= copy.id;
      copy.id = copyId.current;
      await onDuplicate(copy);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar a cópia. O original foi mantido.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <dialog ref={dialogRef} className="duplicate-order-panel" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}>
    <header><span className="client-avatar"><Copy size={22} /></span><div><span className="eyebrow">Novo rascunho</span><h2 id={titleId}>Duplicar pedido</h2></div><button type="button" className="icon-button" aria-label="Cancelar duplicação" disabled={saving} onClick={onClose}><X size={22} /></button></header>
    <div className="duplicate-order-body"><div className="duplicate-order-origin"><span>Pedido de</span><strong>{source.partner.NOMEPARC}</strong></div>
      <div><p className="duplicate-order-label" id={`${titleId}-destination`}>Duplicar para</p><div className="duplicate-order-choices" role="group" aria-labelledby={`${titleId}-destination`}><button type="button" className={choice === 'same' ? 'selected' : ''} aria-pressed={choice === 'same'} disabled={saving} onClick={() => { setChoice('same'); setError(''); }}>Mesmo cliente</button><button type="button" className={choice === 'other' ? 'selected' : ''} aria-pressed={choice === 'other'} disabled={saving} onClick={() => setChoice('other')}>Outro cliente da carteira</button></div></div>
      {choice === 'other' && <><label className="search-box"><Search size={18} /><input aria-label="Pesquisar cliente da carteira" value={query} disabled={saving} onChange={event => setQuery(event.target.value)} placeholder="Nome, código ou CPF/CNPJ" /></label>
        {loading && <p role="status"><LoaderCircle size={16} className="spin" /> Carregando carteira...</p>}
        {!online && <p className="registration-hint">Usando os clientes da última carga deste vendedor.</p>}
        <div className="duplicate-client-list" aria-label="Clientes da carteira">{filtered.map(client => <button type="button" key={Number(client.CODPARC)} aria-pressed={selected === Number(client.CODPARC)} disabled={saving || loading} className={selected === Number(client.CODPARC) ? 'selected' : ''} onClick={() => setSelected(Number(client.CODPARC))}><strong>{client.CODPARC} — {client.NOMEPARC}</strong><small>{client.CGCCPF || 'CPF/CNPJ não informado'}</small></button>)}{!loading && !filtered.length && <p>Nenhum cliente disponível na carteira para esta pesquisa.</p>}</div>
      </>}
      {error && <div className="global-error" role="alert">{error}</div>}
    </div><footer><button type="button" className="secondary" disabled={saving} onClick={onClose}>Cancelar</button><button type="button" className="primary" disabled={!target || saving || (choice === 'other' && loading)} onClick={() => void submit()}>{saving ? <LoaderCircle size={18} className="spin" /> : <Copy size={18} />} {saving ? 'Salvando cópia...' : 'Duplicar e revisar'}</button></footer>
  </dialog>;
}
