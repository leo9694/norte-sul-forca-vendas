"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Box,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  CloudCheck,
  FileText,
  Filter,
  Home,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sprout,
  UserRound,
  UsersRound,
  Wifi,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ApiRow = Record<string, string | number | null>;
type Partner = ApiRow & {
  CODPARC: number;
  NOMEPARC: string;
  CODTAB: number;
  GRUPOICMS: number;
};
type Product = ApiRow & {
  CODPROD: number;
  DESCRPROD: string;
  CODVOL: string;
  CODLOCAL: number;
  CONTROLE: string;
  DISPONIVEL: number;
  NUTAB: number;
  VLRVENDA: number;
};
type CartItem = Product & { quantity: number };

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const sankhyaDate = (value: unknown) => {
  const raw = String(value ?? "");
  if (/^\d{8}/.test(raw)) return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)}`;
  return raw || "Hoje";
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data as T;
}

export function SalesApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [user, setUser] = useState("Leonardo");
  const [screen, setScreen] = useState<"orders" | "new">("orders");
  const [orders, setOrders] = useState<ApiRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [toast, setToast] = useState("");

  const loadOrders = async () => {
    setLoadingOrders(true);
    try {
      const result = await api<{ rows: ApiRow[] }>("/api/sankhya/data?kind=orders");
      setOrders(result.rows);
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    } finally {
      setLoadingOrders(false);
      setCheckingSession(false);
    }
  };

  useEffect(() => {
    loadOrders();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => null);
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setScreen("orders");
  };

  if (checkingSession) {
    return (
      <div className="app-loader">
        <BrandMark />
        <LoaderCircle className="spin" size={26} />
        <span>Conectando ao Sankhya...</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginScreen
        onLogin={(loginUser) => {
          setUser(loginUser);
          setAuthenticated(true);
          loadOrders();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <DesktopSidebar active={screen} user={user} onOrders={() => setScreen("orders")} onLogout={logout} />
      <main className="main-shell">
        {screen === "orders" ? (
          <OrdersScreen
            orders={orders}
            loading={loadingOrders}
            user={user}
            onNew={() => setScreen("new")}
            onLogout={logout}
          />
        ) : (
          <NewOrder
            onBack={() => setScreen("orders")}
            onSent={(id) => {
              setToast(`Pedido ${id || ""} enviado ao Sankhya com sucesso.`);
              setScreen("orders");
              loadOrders();
            }}
          />
        )}
      </main>
      {screen === "orders" && <MobileNav />}
      {toast && (
        <button className="toast" onClick={() => setToast("")}>
          <CheckCircle2 size={20} />
          {toast}
          <X size={17} />
        </button>
      )}
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "compact" : ""}`}>
      <span className="brand-mark"><Sprout size={compact ? 22 : 28} strokeWidth={2.2} /></span>
      {!compact && (
        <span><strong>Norte Sul</strong><small>Força de vendas</small></span>
      )}
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ user: string }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      onLogin(result.user || username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story">
        <BrandMark />
        <div className="story-copy">
          <span className="eyebrow light"><Wifi size={15} /> Conectado ao seu ERP</span>
          <h1>Vendas no campo.<br />Gestão em tempo real.</h1>
          <p>Crie pedidos com preços, estoque e regras comerciais sincronizados com o Sankhya.</p>
        </div>
        <div className="login-benefits">
          <span><ShieldCheck size={19} /> Regras comerciais validadas</span>
          <span><PackageCheck size={19} /> Estoque disponível em tempo real</span>
          <span><CloudCheck size={19} /> Envio direto para o Sankhya</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-mobile-brand"><BrandMark /></div>
        <form className="login-card" onSubmit={submit}>
          <span className="eyebrow">Acesso seguro</span>
          <h2>Bem-vindo de volta</h2>
          <p>Use as mesmas credenciais do Sankhya.</p>
          <label>
            Usuário
            <span className="field">
              <UserRound size={19} />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Seu usuário Sankhya"
                autoComplete="username"
                required
              />
            </span>
          </label>
          <label>
            Senha
            <span className="field">
              <LockKeyhole size={19} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="Sua senha"
                autoComplete="current-password"
                required
              />
            </span>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary large" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={20} /> : <>Entrar <ArrowRight size={19} /></>}
          </button>
          <div className="security-note"><ShieldCheck size={16} /> Suas credenciais não ficam salvas neste dispositivo.</div>
        </form>
      </section>
    </main>
  );
}

function DesktopSidebar({
  active,
  user,
  onOrders,
  onLogout,
}: {
  active: string;
  user: string;
  onOrders: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="desktop-sidebar">
      <BrandMark />
      <nav>
        <button><Home size={20} /> Visão geral</button>
        <button className={active === "orders" || active === "new" ? "active" : ""} onClick={onOrders}>
          <ShoppingBag size={20} /> Pedidos
        </button>
        <button><UsersRound size={20} /> Clientes</button>
        <button><MapPin size={20} /> Roteiro</button>
      </nav>
      <div className="sidebar-user">
        <span className="avatar">{user.charAt(0).toUpperCase()}</span>
        <span><strong>{user}</strong><small>Vendedor</small></span>
        <button onClick={onLogout} aria-label="Sair"><LogOut size={18} /></button>
      </div>
    </aside>
  );
}

function OrdersScreen({
  orders,
  loading,
  user,
  onNew,
  onLogout,
}: {
  orders: ApiRow[];
  loading: boolean;
  user: string;
  onNew: () => void;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todos");
  const filtered = orders.filter((order) => {
    const matchesSearch = `${order.NUNOTA} ${order.NUMNOTA} ${order.NOMEPARC}`.toLowerCase().includes(query.toLowerCase());
    const state = order.STATUSNOTA === "L" ? "Enviados" : "Aguardando";
    return matchesSearch && (filter === "Todos" || filter === state);
  });
  const total = orders.reduce((sum, order) => sum + Number(order.VLRNOTA || 0), 0);

  return (
    <div className="page orders-page">
      <header className="mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Pedidos</h1><p>Acompanhe seus pedidos e rascunhos</p></div>
        <button className="icon-button"><Bell size={23} /></button>
        <button className="avatar" onClick={onLogout}>{user.charAt(0).toUpperCase()}</button>
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Operação comercial</span><h1>Pedidos</h1><p>Acompanhe sua carteira e crie novas vendas.</p></div>
        <button className="primary" onClick={onNew}><Plus size={19} /> Novo pedido</button>
      </header>

      <div className="search-row">
        <label className="search-box"><Search size={21} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pedido ou cliente" /></label>
        <button className="filter-button"><Filter size={20} /><span>Filtros</span></button>
      </div>

      <div className="filter-chips">
        {["Todos", "Enviados", "Rascunhos", "Aguardando"].map((item) => (
          <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>

      <section className="metrics">
        <Metric icon={<CircleDollarSign />} label="Total em carteira" value={money(total)} />
        <Metric icon={<Send />} label="Enviados" value={String(orders.filter((o) => o.STATUSNOTA === "L").length)} />
        <Metric blue icon={<FileText />} label="Rascunhos" value="0" />
      </section>

      <section className="orders-section">
        <div className="section-heading"><div><span className="eyebrow">Movimentações</span><h2>Pedidos recentes</h2></div><button>Ver todos <ArrowRight size={17} /></button></div>
        <div className="order-table-head"><span>Cliente</span><span>Data</span><span>Valor</span><span>Status</span></div>
        <div className="order-list">
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando pedidos...</div> : filtered.map((order, index) => (
            <article className="order-card" key={String(order.NUNOTA)}>
              <span className="order-icon">{index % 2 ? <Leaf /> : <Building2 />}</span>
              <div className="order-client"><strong>{String(order.NOMEPARC)}</strong><small>PED-{String(order.NUNOTA)}</small></div>
              <div className="order-date"><small>{sankhyaDate(order.DTNEG)}</small></div>
              <div className="order-total"><strong>{money(Number(order.VLRNOTA || 0))}</strong></div>
              <span className={`status ${order.STATUSNOTA === "L" ? "sent" : "waiting"}`}>
                {order.STATUSNOTA === "L" ? <><Send size={15} /> Enviado</> : <>Aguardando</>}
              </span>
            </article>
          ))}
          {!loading && !filtered.length && <div className="empty-state">Nenhum pedido encontrado.</div>}
        </div>
      </section>
      <button className="mobile-fab" onClick={onNew}><Plus size={23} /> Novo pedido</button>
    </div>
  );
}

function Metric({ icon, label, value, blue }: { icon: React.ReactNode; label: string; value: string; blue?: boolean }) {
  return <div className={`metric ${blue ? "blue" : ""}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function NewOrder({ onBack, onSent }: { onBack: () => void; onSent: (id?: string) => void }) {
  const [step, setStep] = useState(1);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [observation, setObservation] = useState("");

  useEffect(() => {
    if (step !== 1) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api<{ rows: Partner[] }>(`/api/sankhya/data?kind=partners&q=${encodeURIComponent(search)}`)
        .then((result) => setPartners(result.rows))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, step]);

  useEffect(() => {
    if (step !== 3 || !selectedPartner) return;
    setLoading(true);
    setError("");
    api<{ rows: Product[] }>(`/api/sankhya/data?kind=products&partner=${selectedPartner.CODPARC}&q=${encodeURIComponent(search)}`)
      .then((result) => setProducts(result.rows))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [step, selectedPartner, search]);

  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.VLRVENDA) * item.quantity, 0), [cart]);
  const totalUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  const setQuantity = (product: Product, change: number) => {
    setCart((current) => {
      const existing = current.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE);
      const next = Math.max(0, Math.min(Number(product.DISPONIVEL), (existing?.quantity || 0) + change));
      if (!next) return current.filter((item) => !(item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE));
      if (existing) return current.map((item) => item === existing ? { ...item, quantity: next } : item);
      return [...current, { ...product, quantity: next }];
    });
  };

  const quantityOf = (product: Product) =>
    cart.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE)?.quantity || 0;

  const sendOrder = async () => {
    if (!selectedPartner) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{ orderId?: string }>("/api/sankhya/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner: selectedPartner.CODPARC,
          operation: 5,
          observation,
          items: cart.map((item) => ({
            product: Number(item.CODPROD),
            quantity: item.quantity,
            unitPrice: Number(item.VLRVENDA),
            volume: item.CODVOL,
            location: Number(item.CODLOCAL),
            control: item.CONTROLE,
            priceTable: Number(item.NUTAB),
          })),
        }),
      });
      onSent(result.orderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no envio.");
      setShowConfirm(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page new-order-page">
      <header className="new-header">
        <button className="back-button" onClick={step === 1 ? onBack : () => setStep(step - 1)}><ArrowLeft size={20} /></button>
        <div><span className="eyebrow">Pedido de venda</span><h1>Novo pedido</h1></div>
        <span className="sync-badge"><CloudCheck size={16} /> Sankhya online</span>
      </header>
      <div className="stepper">
        {["Cliente", "Condições", "Produtos", "Revisão"].map((label, index) => (
          <div key={label} className={`${step === index + 1 ? "active" : ""} ${step > index + 1 ? "done" : ""}`}>
            <span>{step > index + 1 ? <Check size={15} /> : index + 1}</span><small>{label}</small>
          </div>
        ))}
      </div>

      <div className="new-content">
        {step === 1 && (
          <section className="form-section">
            <div className="section-heading"><div><span className="eyebrow">Etapa 1 de 4</span><h2>Para quem é o pedido?</h2><p>Selecione um cliente ativo com configuração comercial válida.</p></div></div>
            <label className="search-box wide"><Search size={21} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou código" /></label>
            <div className="partner-list">
              {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Buscando clientes...</div> : partners.filter((p) => `${p.NOMEPARC} ${p.CODPARC}`.toLowerCase().includes(search.toLowerCase())).slice(0, 18).map((partner) => (
                <button key={partner.CODPARC} className={selectedPartner?.CODPARC === partner.CODPARC ? "selected" : ""} onClick={() => setSelectedPartner(partner)}>
                  <span className="client-avatar"><Building2 size={20} /></span>
                  <span><strong>{partner.NOMEPARC}</strong><small>Cód. {partner.CODPARC} · Grupo ICMS {partner.GRUPOICMS}</small></span>
                  <span className="radio">{selectedPartner?.CODPARC === partner.CODPARC && <Check size={15} />}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && selectedPartner && (
          <section className="form-section conditions">
            <div className="section-heading"><div><span className="eyebrow">Etapa 2 de 4</span><h2>Condições comerciais</h2><p>Os dados abaixo vêm da configuração atual do Sankhya.</p></div></div>
            <div className="selected-client"><span className="client-avatar"><Building2 /></span><div><small>Cliente selecionado</small><strong>{selectedPartner.NOMEPARC}</strong><span>Cód. {selectedPartner.CODPARC}</span></div><button onClick={() => setStep(1)}>Alterar</button></div>
            <div className="condition-grid">
              <label>Empresa<div className="select-field"><Building2 size={19} /><span>1 — Norte Sul Sementes</span><LockKeyhole size={15} /></div></label>
              <label>Tipo de operação<div className="select-field valid"><ClipboardList size={19} /><span>TOP 5 — Pedido de venda</span><CheckCircle2 size={16} /></div></label>
              <label>Tabela de preço<div className="select-field valid"><CircleDollarSign size={19} /><span>Tabela {selectedPartner.CODTAB}</span><CheckCircle2 size={16} /></div><small>Definida pelo Grupo ICMS {selectedPartner.GRUPOICMS}</small></label>
              <label>Observação<textarea value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Informações adicionais do pedido" /></label>
            </div>
            <div className="rule-card"><ShieldCheck size={22} /><div><strong>Regras do Sankhya aplicadas</strong><p>A empresa, o vendedor, a negociação e a tabela são revalidados antes do envio.</p></div></div>
          </section>
        )}

        {step === 3 && selectedPartner && (
          <section className="form-section products-section">
            <div className="section-heading"><div><span className="eyebrow">Etapa 3 de 4</span><h2>Adicionar produtos</h2><p>Somente itens com estoque disponível e mobilidade ativa.</p></div><span className="table-tag">Tabela {selectedPartner.CODTAB}</span></div>
            <label className="search-box wide"><Search size={21} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto por nome ou código" /></label>
            <div className="product-list">
              {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Consultando estoque e preços...</div> : products.map((product) => (
                <article key={`${product.CODPROD}-${product.CONTROLE}`} className={quantityOf(product) ? "selected" : ""}>
                  <span className="product-icon"><Sprout size={22} /></span>
                  <div className="product-info"><strong>{product.DESCRPROD}</strong><small>Cód. {product.CODPROD} · {product.CODVOL}</small><span><PackageCheck size={14} /> {Number(product.DISPONIVEL).toLocaleString("pt-BR")} disponíveis</span></div>
                  <div className="product-price"><strong>{money(Number(product.VLRVENDA))}</strong><small>por {product.CODVOL}</small></div>
                  {quantityOf(product) ? (
                    <div className="quantity"><button onClick={() => setQuantity(product, -1)}><Minus size={16} /></button><strong>{quantityOf(product)}</strong><button onClick={() => setQuantity(product, 1)}><Plus size={16} /></button></div>
                  ) : <button className="add-button" onClick={() => setQuantity(product, 1)}><Plus size={17} /> Adicionar</button>}
                </article>
              ))}
              {!loading && !products.length && <div className="empty-state">Nenhum produto elegível encontrado para esta tabela.</div>}
            </div>
          </section>
        )}

        {step === 4 && selectedPartner && (
          <section className="form-section review-section">
            <div className="section-heading"><div><span className="eyebrow">Etapa 4 de 4</span><h2>Revise seu pedido</h2><p>Confira os dados antes de preparar o envio.</p></div></div>
            <div className="review-grid">
              <article className="review-client"><div className="review-title"><Building2 size={19} /><strong>Cliente e condições</strong><button onClick={() => setStep(2)}>Editar</button></div><h3>{selectedPartner.NOMEPARC}</h3><p>Cód. {selectedPartner.CODPARC}</p><dl><div><dt>Operação</dt><dd>TOP 5</dd></div><div><dt>Tabela</dt><dd>{selectedPartner.CODTAB}</dd></div><div><dt>Empresa</dt><dd>1</dd></div></dl></article>
              <article className="review-items"><div className="review-title"><ShoppingCart size={19} /><strong>Itens do pedido</strong><button onClick={() => setStep(3)}>Editar</button></div>{cart.map((item) => <div className="review-item" key={`${item.CODPROD}-${item.CONTROLE}`}><span>{item.quantity}×</span><div><strong>{item.DESCRPROD}</strong><small>{money(Number(item.VLRVENDA))} / {item.CODVOL}</small></div><strong>{money(item.quantity * Number(item.VLRVENDA))}</strong></div>)}</article>
            </div>
            <div className="order-summary"><span><small>{totalUnits} {totalUnits === 1 ? "unidade" : "unidades"}</small><strong>Total do pedido</strong></span><strong>{money(total)}</strong></div>
            <div className="validation-strip"><span><CheckCircle2 /> Cliente e Grupo ICMS</span><span><CheckCircle2 /> TOP 5 vigente</span><span><CheckCircle2 /> Estoque e mobilidade</span><span><CheckCircle2 /> Preços da tabela</span></div>
          </section>
        )}
        {error && <div className="global-error">{error}</div>}
      </div>

      <footer className="new-footer">
        <button className="secondary" onClick={step === 1 ? onBack : () => setStep(step - 1)}>Voltar</button>
        <div className="footer-total">{step >= 3 && <><small>{totalUnits} itens</small><strong>{money(total)}</strong></>}</div>
        <button className="primary" disabled={(step === 1 && !selectedPartner) || (step === 3 && !cart.length)} onClick={() => {
          if (step < 4) {
            if (step === 1) setSearch("");
            setStep(step + 1);
          } else {
            setShowConfirm(true);
          }
        }}>
          {step === 4 ? <><ShieldCheck size={18} /> Validar e enviar</> : <>Continuar <ArrowRight size={18} /></>}
        </button>
      </footer>

      {showConfirm && (
        <div className="modal-backdrop">
          <div className="confirm-modal">
            <button className="modal-close" onClick={() => setShowConfirm(false)}><X size={20} /></button>
            <span className="confirm-icon"><Send size={27} /></span>
            <h2>Enviar pedido ao Sankhya?</h2>
            <p>Uma última validação será feita no estoque, no Grupo de ICMS, na tabela de preço e na TOP 5.</p>
            <div className="confirm-summary"><span><small>Cliente</small><strong>{selectedPartner?.NOMEPARC}</strong></span><span><small>Total</small><strong>{money(total)}</strong></span></div>
            <div className="modal-actions"><button className="secondary" onClick={() => setShowConfirm(false)}>Revisar</button><button className="primary" onClick={sendOrder} disabled={sending}>{sending ? <LoaderCircle className="spin" /> : <><Send size={18} /> Confirmar envio</>}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileNav() {
  return (
    <nav className="mobile-nav">
      <button><Home /><span>Início</span></button>
      <button className="active"><ShoppingBag /><span>Pedidos</span></button>
      <button><UsersRound /><span>Clientes</span></button>
      <button><MapPin /><span>Roteiro</span></button>
      <button><Menu /><span>Mais</span></button>
    </nav>
  );
}
