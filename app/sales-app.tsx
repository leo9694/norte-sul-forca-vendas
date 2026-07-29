"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Box,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  CloudCheck,
  CloudOff,
  Database,
  Download,
  FileText,
  Filter,
  Home,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
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
import {
  getLatestOfflineSnapshot,
  getOfflineSnapshot,
  OfflineSnapshot,
  saveOfflineSnapshot,
} from "./offline-store";

type ApiRow = Record<string, string | number | null>;
type Partner = ApiRow & {
  CODPARC: number;
  NOMEPARC: string;
  CODTAB?: number | null;
  GRUPOICMS?: number | null;
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
  DESCRGRUPOPROD?: string;
};
type CartItem = Product & { quantity: number };
type PriceTable = { CODTAB: number; NOMETAB: string };
type Negotiation = { CODTIPVENDA: number; DESCRTIPVENDA: string };
type ProductGroup = { CODGRUPOPROD: number; DESCRGRUPOPROD: string };
type OrderPhase = "header" | "products" | "review";
type OrderDraft = {
  id: string;
  updatedAt: number;
  phase: OrderPhase;
  partner: Partner;
  priceCode: number;
  priceName: string;
  negotiation: number;
  negotiationName: string;
  observation: string;
  cart: CartItem[];
};

const OFFLINE_SESSION_KEY = "norte-sul-vendas:offline-session-enabled";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
type Client = ApiRow & {
  CODPARC: number;
  NOMEPARC: string;
  CGCCPF?: string;
  TELEFONE?: string;
  EMAIL?: string;
  CODTAB?: number | null;
  GRUPOICMS?: number | null;
};

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const sankhyaDate = (value: unknown) => {
  const raw = String(value ?? "");
  if (/^\d{8}/.test(raw)) return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)}`;
  return raw || "Hoje";
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: ({ error?: string } & T);
  try {
    data = JSON.parse(text) as ({ error?: string } & T);
  } catch {
    throw new Error(
      response.ok
        ? "O servidor retornou uma resposta inválida."
        : "O servidor não conseguiu concluir a solicitação. Reinicie o app e tente novamente.",
    );
  }
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data as T;
}

export function SalesApp() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [user, setUser] = useState("Leonardo");
  const [sellerId, setSellerId] = useState(0);
  const [sellerName, setSellerName] = useState("");
  const [screen, setScreen] = useState<"orders" | "new" | "clients" | "more">("orders");
  const [orders, setOrders] = useState<ApiRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [offlineData, setOfflineData] = useState<OfflineSnapshot | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosDevice, setIosDevice] = useState(false);
  const [secureContext, setSecureContext] = useState(true);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [startingPartner, setStartingPartner] = useState<Partner | null>(null);
  const [activeDraft, setActiveDraft] = useState<OrderDraft | null>(null);
  const [drafts, setDrafts] = useState<OrderDraft[]>([]);
  const [toast, setToast] = useState("");

  const applySnapshot = (snapshot: OfflineSnapshot, replaceOrders = true) => {
    setOfflineData(snapshot);
    setUser(snapshot.seller.user);
    setSellerId(snapshot.seller.sellerId);
    setSellerName(snapshot.seller.sellerName);
    setClients(snapshot.clients as Client[]);
    if (replaceOrders) setOrders(snapshot.orders);
    setAuthenticated(true);
  };

  const filterOfflineOrders = (rows: ApiRow[], dateFrom = "", dateTo = "") =>
    rows.filter((order) => {
      const raw = String(order.DTNEG ?? "");
      const date = /^\d{8}/.test(raw)
        ? `${raw.slice(4, 8)}-${raw.slice(2, 4)}-${raw.slice(0, 2)}`
        : raw.slice(0, 10);
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    });

  const loadOrders = async (dateFrom = "", dateTo = "") => {
    setLoadingOrders(true);
    try {
      const params = new URLSearchParams({ kind: "orders" });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const result = await api<{ rows: ApiRow[]; user?: string; sellerId?: number; sellerName?: string }>(`/api/sankhya/data?${params}`);
      setOrders(result.rows);
      if (result.user) setUser(result.user);
      if (result.sellerId) setSellerId(Number(result.sellerId));
      if (result.sellerName) setSellerName(String(result.sellerName));
      setAuthenticated(true);
    } catch (error) {
      const cached = offlineData
        ?? (sellerId ? await getOfflineSnapshot(sellerId) : await getLatestOfflineSnapshot());
      if (cached) {
        applySnapshot(cached, false);
        setOrders(filterOfflineOrders(cached.orders, dateFrom, dateTo));
        setToast("Exibindo os pedidos da última carga salva neste aparelho.");
      } else {
        setAuthenticated(false);
        setToast(error instanceof Error ? error.message : "Não foi possível carregar os pedidos.");
      }
    } finally {
      setLoadingOrders(false);
      setCheckingSession(false);
    }
  };

  const makeLoad = async (showSuccess = true) => {
    if (!navigator.onLine) {
      setToast("Conecte-se à internet para fazer uma nova carga.");
      return null;
    }
    setSyncing(true);
    try {
      const snapshot = await api<OfflineSnapshot>("/api/sankhya/sync");
      await saveOfflineSnapshot(snapshot);
      localStorage.setItem(OFFLINE_SESSION_KEY, "true");
      applySnapshot(snapshot);
      if (showSuccess) {
        setToast(`Carga concluída: ${snapshot.clients.length} clientes e ${snapshot.products.length} saldos de produtos.`);
      }
      return snapshot;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível fazer a carga.");
      return null;
    } finally {
      setSyncing(false);
    }
  };

  const installApplication = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setToast("Aplicativo instalado com sucesso.");
    setInstallPrompt(null);
  };

  const loadPortfolio = async () => {
    if (clients.length) return clients;
    setLoadingClients(true);
    try {
      const result = await api<{ rows: Client[] }>("/api/sankhya/data?kind=portfolio");
      setClients(result.rows);
      return result.rows;
    } catch (error) {
      const cached = offlineData
        ?? (sellerId ? await getOfflineSnapshot(sellerId) : await getLatestOfflineSnapshot());
      if (cached) {
        setOfflineData(cached);
        setClients(cached.clients as Client[]);
        return cached.clients as Client[];
      }
      setToast(error instanceof Error ? error.message : "Não foi possível carregar a carteira.");
      return [];
    } finally {
      setLoadingClients(false);
    }
  };

  const showClients = async () => {
    setScreen("clients");
    await loadPortfolio();
  };

  const openNewOrder = async () => {
    setClientPickerOpen(true);
    await loadPortfolio();
  };

  const draftKey = sellerId ? `norte-sul-vendas:drafts:${sellerId}` : "";

  useEffect(() => {
    if (!draftKey) return;
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey) || "[]") as OrderDraft[];
      setDrafts(Array.isArray(stored) ? stored : []);
    } catch {
      setDrafts([]);
    }
  }, [draftKey]);

  const saveDraft = (draft: OrderDraft) => {
    setDrafts((current) => {
      const next = [draft, ...current.filter((item) => item.id !== draft.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (draftKey) localStorage.setItem(draftKey, JSON.stringify(next));
      return next;
    });
  };

  const removeDraft = (id: string) => {
    setDrafts((current) => {
      const next = current.filter((draft) => draft.id !== id);
      if (draftKey) localStorage.setItem(draftKey, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    setIosDevice(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setSecureContext(window.isSecureContext);
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => null);
    navigator.storage?.persist?.().catch(() => false);

    const bootstrap = async () => {
      try {
        const result = await api<{ rows: ApiRow[]; user?: string; sellerId?: number; sellerName?: string }>(
          "/api/sankhya/data?kind=orders",
        );
        setOrders(result.rows);
        setUser(result.user || "");
        setSellerId(Number(result.sellerId || 0));
        setSellerName(result.sellerName || result.user || "");
        setAuthenticated(true);
        localStorage.setItem(OFFLINE_SESSION_KEY, "true");
        setCheckingSession(false);
        void makeLoad(false);
      } catch {
        const offlineEnabled = localStorage.getItem(OFFLINE_SESSION_KEY) === "true";
        const cached = offlineEnabled ? await getLatestOfflineSnapshot().catch(() => null) : null;
        if (cached) applySnapshot(cached);
        setCheckingSession(false);
      }
    };
    void bootstrap();
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const logout = async () => {
    if (navigator.onLine) await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    localStorage.setItem(OFFLINE_SESSION_KEY, "false");
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
        onLogin={(loginData) => {
          setUser(loginData.user);
          setSellerId(loginData.sellerId);
          setSellerName(loginData.sellerName);
          setAuthenticated(true);
          localStorage.setItem(OFFLINE_SESSION_KEY, "true");
          void makeLoad();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <DesktopSidebar active={screen} user={user} onOrders={() => setScreen("orders")} onClients={showClients} onMore={() => setScreen("more")} onLogout={logout} />
      <main className="main-shell">
        {screen === "orders" ? (
          <OrdersScreen
            orders={orders}
            loading={loadingOrders}
            drafts={drafts}
            user={user}
            onNew={openNewOrder}
            onResume={(draft) => {
              setActiveDraft(draft);
              setStartingPartner(draft.partner);
              setScreen("new");
            }}
            onPeriodChange={loadOrders}
            onLogout={logout}
          />
        ) : screen === "clients" ? (
          <ClientsScreen clients={clients} loading={loadingClients} user={user} onLogout={logout} />
        ) : screen === "more" ? (
          <MoreScreen
            user={user}
            sellerId={sellerId}
            sellerName={sellerName}
            online={online}
            syncing={syncing}
            snapshot={offlineData}
            canInstall={Boolean(installPrompt)}
            installed={installed}
            iosDevice={iosDevice}
            secureContext={secureContext}
            onInstall={() => void installApplication()}
            onLoad={() => void makeLoad()}
            onLogout={logout}
          />
        ) : (
          <NewOrderV2
            partner={startingPartner!}
            draft={activeDraft}
            offlineData={offlineData}
            online={online}
            onSaveDraft={saveDraft}
            onBack={() => {
              setScreen("orders");
              setActiveDraft(null);
              setStartingPartner(null);
            }}
            onSent={(id, draftId) => {
              removeDraft(draftId);
              setToast(`Pedido ${id || ""} enviado ao Sankhya com sucesso.`);
              setScreen("orders");
              setActiveDraft(null);
              setStartingPartner(null);
              loadOrders();
            }}
          />
        )}
      </main>
      {screen !== "new" && <MobileNav active={screen} onOrders={() => setScreen("orders")} onClients={showClients} onMore={() => setScreen("more")} />}
      {clientPickerOpen && (
        <ClientPickerModal
          clients={clients}
          loading={loadingClients}
          onClose={() => setClientPickerOpen(false)}
          onSelect={(client) => {
            setStartingPartner(client);
            setActiveDraft(null);
            setClientPickerOpen(false);
            setScreen("new");
          }}
        />
      )}
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

function LoginScreen({ onLogin }: { onLogin: (data: { user: string; sellerId: number; sellerName: string }) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ user: string; sellerId: number; sellerName: string }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      onLogin({
        user: result.user || username,
        sellerId: Number(result.sellerId),
        sellerName: result.sellerName || result.user || username,
      });
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
  onClients,
  onMore,
  onLogout,
}: {
  active: string;
  user: string;
  onOrders: () => void;
  onClients: () => void;
  onMore: () => void;
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
        <button className={active === "clients" ? "active" : ""} onClick={onClients}><UsersRound size={20} /> Clientes</button>
        <button><MapPin size={20} /> Roteiro</button>
        <button className={active === "more" ? "active" : ""} onClick={onMore}><Menu size={20} /> Mais</button>
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
  drafts,
  user,
  onNew,
  onResume,
  onPeriodChange,
  onLogout,
}: {
  orders: ApiRow[];
  loading: boolean;
  drafts: OrderDraft[];
  user: string;
  onNew: () => void;
  onResume: (draft: OrderDraft) => void;
  onPeriodChange: (dateFrom?: string, dateTo?: string) => void;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Todos");
  const [showPeriod, setShowPeriod] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filtered = orders.filter((order) => {
    const matchesSearch = `${order.NUNOTA} ${order.NUMNOTA} ${order.NOMEPARC}`.toLowerCase().includes(query.toLowerCase());
    const state = order.STATUSNOTA === "L" ? "Enviados" : "Aguardando";
    return matchesSearch && filter !== "Rascunhos" && (filter === "Todos" || filter === state);
  });
  const filteredDrafts = drafts.filter((draft) => {
    const matchesSearch = `${draft.partner.NOMEPARC} ${draft.partner.CODPARC}`.toLowerCase().includes(query.toLowerCase());
    return matchesSearch && (filter === "Todos" || filter === "Rascunhos");
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
        <button className={`filter-button ${dateFrom || dateTo ? "active" : ""}`} onClick={() => setShowPeriod((current) => !current)} aria-expanded={showPeriod}>
          <Filter size={20} /><span>{dateFrom || dateTo ? "Período ativo" : "Período"}</span>
        </button>
      </div>

      {showPeriod && (
        <section className="period-filter">
          <div><CalendarDays size={20} /><span><strong>Filtrar por período</strong><small>A consulta será refeita diretamente no Sankhya.</small></span></div>
          <label>De<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label>Até<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
          <button className="secondary" onClick={() => {
            setDateFrom("");
            setDateTo("");
            onPeriodChange("", "");
            setShowPeriod(false);
          }}>Limpar</button>
          <button className="primary" disabled={!dateFrom && !dateTo} onClick={() => {
            onPeriodChange(dateFrom, dateTo);
            setShowPeriod(false);
          }}>Aplicar</button>
        </section>
      )}

      <div className="filter-chips">
        {["Todos", "Enviados", "Rascunhos", "Aguardando"].map((item) => (
          <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>

      <section className="metrics">
        <Metric icon={<CircleDollarSign />} label="Total em carteira" value={money(total)} />
        <Metric icon={<Send />} label="Enviados" value={String(orders.filter((o) => o.STATUSNOTA === "L").length)} />
        <Metric blue icon={<FileText />} label="Rascunhos" value={String(drafts.length)} />
      </section>

      <section className="orders-section">
        <div className="section-heading"><div><span className="eyebrow">Movimentações</span><h2>Pedidos recentes</h2></div><button>Ver todos <ArrowRight size={17} /></button></div>
        <div className="order-table-head"><span>Cliente</span><span>Data</span><span>Valor</span><span>Status</span></div>
        <div className="order-list">
          {filteredDrafts.map((draft) => (
            <button className="order-card draft-card" key={draft.id} onClick={() => onResume(draft)}>
              <span className="order-icon"><FileText /></span>
              <div className="order-client"><strong>{draft.partner.NOMEPARC}</strong><small>Rascunho automático</small></div>
              <div className="order-date"><small>{new Date(draft.updatedAt).toLocaleDateString("pt-BR")}</small></div>
              <div className="order-total"><strong>{money(draft.cart.reduce((sum, item) => sum + Number(item.VLRVENDA) * item.quantity, 0))}</strong></div>
              <span className="status draft"><FileText size={15} /> Continuar</span>
            </button>
          ))}
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
          {!loading && !filtered.length && !filteredDrafts.length && <div className="empty-state">Nenhum pedido encontrado.</div>}
        </div>
      </section>
      <button className="mobile-fab" onClick={onNew}><Plus size={23} /> Novo pedido</button>
    </div>
  );
}

function Metric({ icon, label, value, blue }: { icon: React.ReactNode; label: string; value: string; blue?: boolean }) {
  return <div className={`metric ${blue ? "blue" : ""}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function ClientsScreen({
  clients,
  loading,
  user,
  onLogout,
}: {
  clients: Client[];
  loading: boolean;
  user: string;
  onLogout: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = clients.filter((client) =>
    `${client.NOMEPARC} ${client.CODPARC} ${client.CGCCPF ?? ""}`.toLowerCase().includes(normalized),
  );
  const configured = clients.filter((client) => client.CODTAB != null).length;

  return (
    <div className="page clients-page">
      <header className="mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Clientes</h1><p>Sua carteira no Sankhya</p></div>
        <button className="icon-button"><Bell size={23} /></button>
        <button className="avatar" onClick={onLogout}>{user.charAt(0).toUpperCase()}</button>
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Carteira comercial</span><h1>Clientes</h1><p>Todos os clientes ativos vinculados ao seu cadastro de vendedor.</p></div>
      </header>

      <label className="search-box clients-search">
        <Search size={21} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente por nome, código ou CPF/CNPJ" />
      </label>

      <section className="metrics client-metrics">
        <Metric icon={<UsersRound />} label="Clientes na carteira" value={String(clients.length)} />
        <Metric icon={<CircleDollarSign />} label="Com tabela de preço" value={String(configured)} />
        <Metric blue icon={<ClipboardList />} label="Sem tabela definida" value={String(clients.length - configured)} />
      </section>

      <section>
        <div className="section-heading">
          <div><span className="eyebrow">Vendedor logado</span><h2>Minha carteira</h2><p>{filtered.length} {filtered.length === 1 ? "cliente encontrado" : "clientes encontrados"}</p></div>
        </div>
        <div className="client-grid">
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando toda a carteira...</div> : filtered.map((client) => (
            <article className="client-card" key={client.CODPARC}>
              <span className="client-avatar"><Building2 size={20} /></span>
              <div className="client-main">
                <strong>{client.NOMEPARC}</strong>
                <small>Cód. {client.CODPARC}{client.CGCCPF ? ` · ${client.CGCCPF}` : ""}</small>
                <div className="client-contact">
                  {client.TELEFONE && <span><Phone size={13} /> {client.TELEFONE}</span>}
                  {client.EMAIL && <span><Mail size={13} /> {client.EMAIL}</span>}
                </div>
              </div>
              <div className="client-commercial">
                <span className={client.CODTAB != null ? "configured" : "missing"}>
                  {client.CODTAB != null ? `Tabela ${client.CODTAB}` : "Sem tabela"}
                </span>
                {client.GRUPOICMS != null && <small>Grupo ICMS {client.GRUPOICMS}</small>}
              </div>
            </article>
          ))}
          {!loading && !filtered.length && <div className="empty-state">Nenhum cliente encontrado na carteira.</div>}
        </div>
      </section>
    </div>
  );
}

function MoreScreen({
  user,
  sellerId,
  sellerName,
  online,
  syncing,
  snapshot,
  canInstall,
  installed,
  iosDevice,
  secureContext,
  onInstall,
  onLoad,
  onLogout,
}: {
  user: string;
  sellerId: number;
  sellerName: string;
  online: boolean;
  syncing: boolean;
  snapshot: OfflineSnapshot | null;
  canInstall: boolean;
  installed: boolean;
  iosDevice: boolean;
  secureContext: boolean;
  onInstall: () => void;
  onLoad: () => void;
  onLogout: () => void;
}) {
  const lastLoad = snapshot?.syncedAt
    ? new Date(snapshot.syncedAt).toLocaleString("pt-BR")
    : "Nenhuma carga realizada";

  return (
    <div className="page more-page">
      <header className="mobile-header">
        <BrandMark compact />
        <div className="page-title"><h1>Mais</h1><p>Dados e sincronização</p></div>
        <span className={`connection-dot ${online ? "online" : "offline"}`} title={online ? "Online" : "Offline"} />
        <button className="avatar" onClick={onLogout}>{user.charAt(0).toUpperCase()}</button>
      </header>
      <header className="desktop-header">
        <div><span className="eyebrow">Área do vendedor</span><h1>Mais</h1><p>Gerencie a carga local e consulte seus dados de acesso.</p></div>
        <span className={`connection-badge ${online ? "online" : "offline"}`}>
          {online ? <CloudCheck size={17} /> : <CloudOff size={17} />}
          {online ? "Conectado" : "Modo offline"}
        </span>
      </header>

      <section className="seller-profile-card">
        <span className="seller-profile-avatar">{(sellerName || user).charAt(0).toUpperCase()}</span>
        <div>
          <small>Vendedor logado</small>
          <h2>{sellerName || user}</h2>
          <p>Usuário {user} · Código do vendedor {sellerId}</p>
        </div>
        <span className={`connection-badge ${online ? "online" : "offline"}`}>
          {online ? <CloudCheck size={17} /> : <CloudOff size={17} />}
          {online ? "Online" : "Offline"}
        </span>
      </section>

      <section className="load-card">
        <div className="load-card-icon"><Database size={25} /></div>
        <div className="load-card-copy">
          <span className="eyebrow">Dados deste aparelho</span>
          <h2>Fazer carga</h2>
          <p>Atualiza clientes, pedidos, tabelas, preços e estoque com os dados atuais do Sankhya.</p>
          <small>Última carga: {lastLoad}</small>
        </div>
        <button className="primary load-button" onClick={onLoad} disabled={!online || syncing}>
          {syncing ? <><LoaderCircle className="spin" size={19} /> Atualizando...</> : <><RefreshCw size={19} /> Fazer carga</>}
        </button>
      </section>

      <section className={`install-card ${!secureContext ? "warning" : ""}`}>
        <div className="load-card-icon"><Download size={25} /></div>
        <div className="load-card-copy">
          <span className="eyebrow">Aplicativo móvel</span>
          <h2>{installed ? "Aplicativo instalado" : "Instalar aplicativo"}</h2>
          {installed ? (
            <p>Esta versão já está sendo executada como aplicativo no aparelho.</p>
          ) : !secureContext ? (
            <p>A instalação real exige um endereço HTTPS. Em endereço local HTTP, o navegador consegue criar somente um atalho.</p>
          ) : iosDevice ? (
            <p>No iPhone, toque em Compartilhar e depois em “Adicionar à Tela de Início”.</p>
          ) : canInstall ? (
            <p>Instale a versão completa para abrir sem a barra do navegador e trabalhar offline.</p>
          ) : (
            <p>Abra esta tela novamente após a primeira carga. O navegador liberará a instalação quando terminar de preparar o app.</p>
          )}
        </div>
        {canInstall && !installed && (
          <button className="primary load-button" onClick={onInstall}><Download size={19} /> Instalar aplicativo</button>
        )}
      </section>

      <section className="offline-summary">
        <article><UsersRound /><span><small>Clientes salvos</small><strong>{snapshot?.clients.length ?? 0}</strong></span></article>
        <article><ShoppingBag /><span><small>Pedidos salvos</small><strong>{snapshot?.orders.length ?? 0}</strong></span></article>
        <article><PackageCheck /><span><small>Saldos com preço</small><strong>{snapshot?.products.length ?? 0}</strong></span></article>
      </section>

      <div className={`offline-explanation ${online ? "" : "active"}`}>
        {online ? <CloudCheck size={21} /> : <CloudOff size={21} />}
        <div>
          <strong>{online ? "Dados disponíveis offline" : "Você está trabalhando offline"}</strong>
          <p>Clientes, pedidos, preços e estoque da última carga podem ser consultados. Rascunhos continuam sendo salvos; o envio ao Sankhya exige internet.</p>
        </div>
      </div>

      <button className="secondary more-logout" onClick={onLogout}><LogOut size={18} /> Sair do aplicativo</button>
    </div>
  );
}

function ClientPickerModal({
  clients,
  loading,
  onClose,
  onSelect,
}: {
  clients: Client[];
  loading: boolean;
  onClose: () => void;
  onSelect: (client: Partner) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = clients.filter((client) =>
    `${client.NOMEPARC} ${client.CODPARC} ${client.CGCCPF ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="modal-backdrop client-picker-backdrop" role="dialog" aria-modal="true" aria-label="Selecionar cliente">
      <section className="client-picker-modal">
        <header>
          <div><span className="eyebrow">Novo pedido</span><h2>Selecione o cliente</h2><p>Escolha um cliente da sua carteira para iniciar o pedido.</p></div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <label className="search-box wide"><Search size={21} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, código ou CPF/CNPJ" /></label>
        <div className="client-picker-list">
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando sua carteira...</div> : filtered.map((client) => (
            <button key={client.CODPARC} onClick={() => onSelect(client)}>
              <span className="client-avatar"><Building2 size={20} /></span>
              <span><strong>{client.NOMEPARC}</strong><small>Cód. {client.CODPARC}{client.CGCCPF ? ` · ${client.CGCCPF}` : ""}</small></span>
              <ArrowRight size={18} />
            </button>
          ))}
          {!loading && !filtered.length && <div className="empty-state">Nenhum cliente encontrado na sua carteira.</div>}
        </div>
      </section>
    </div>
  );
}

function NewOrderV2({
  partner,
  draft,
  offlineData,
  online,
  onSaveDraft,
  onBack,
  onSent,
}: {
  partner: Partner;
  draft: OrderDraft | null;
  offlineData: OfflineSnapshot | null;
  online: boolean;
  onSaveDraft: (draft: OrderDraft) => void;
  onBack: () => void;
  onSent: (id: string | undefined, draftId: string) => void;
}) {
  const [draftId] = useState(() => draft?.id ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [phase, setPhase] = useState<OrderPhase>(draft?.phase ?? "header");
  const [tables, setTables] = useState<PriceTable[]>([]);
  const [negotiations, setNegotiations] = useState<Negotiation[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [priceCode, setPriceCode] = useState(Number(draft?.priceCode || 0));
  const [negotiation, setNegotiation] = useState(Number(draft?.negotiation || 0));
  const [observation, setObservation] = useState(draft?.observation ?? "");
  const [cart, setCart] = useState<CartItem[]>(draft?.cart ?? []);
  const [productGroup, setProductGroup] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const selectedTable = tables.find((table) => Number(table.CODTAB) === priceCode);
  const selectedNegotiation = negotiations.find((item) => Number(item.CODTIPVENDA) === negotiation);
  const total = useMemo(() => cart.reduce((sum, item) => sum + Number(item.VLRVENDA) * item.quantity, 0), [cart]);
  const totalUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  const applyOfflineOptions = () => {
    const cachedPartner = offlineData?.clients.find((item) => Number(item.CODPARC) === Number(partner.CODPARC));
    if (!offlineData || !cachedPartner) return false;
    const partnerTable = Number(cachedPartner.CODTAB || 0);
    const cachedTables = offlineData.tables
      .filter((table) => Number(table.CODTAB) === partnerTable) as PriceTable[];
    const cachedNegotiations = offlineData.negotiations as Negotiation[];
    setTables(cachedTables);
    setNegotiations(cachedNegotiations);
    if (!priceCode) setPriceCode(Number(cachedTables[0]?.CODTAB || 0));
    if (!negotiation) {
      const preferred = cachedNegotiations.find(
        (item) => Number(item.CODTIPVENDA) === Number(cachedPartner.CODTIPVENDA),
      );
      setNegotiation(Number(preferred?.CODTIPVENDA ?? cachedNegotiations[0]?.CODTIPVENDA ?? 0));
    }
    return true;
  };

  const offlineGroups = () => {
    if (!offlineData) return [] as ProductGroup[];
    const unique = new Map<number, ProductGroup>();
    offlineData.products
      .filter((item) => Number(item.CODTAB) === priceCode)
      .forEach((item) => {
        const code = Number(item.CODGRUPOPROD);
        if (code && !unique.has(code)) {
          unique.set(code, {
            CODGRUPOPROD: code,
            DESCRGRUPOPROD: String(item.DESCRGRUPOPROD || `Grupo ${code}`),
          });
        }
      });
    return [...unique.values()].sort((left, right) =>
      left.DESCRGRUPOPROD.localeCompare(right.DESCRGRUPOPROD, "pt-BR"),
    );
  };

  const offlineProducts = () => {
    const term = search.trim().toLowerCase();
    return (offlineData?.products ?? [])
      .filter((item) =>
        Number(item.CODTAB) === priceCode
        && Number(item.CODGRUPOPROD) === productGroup
        && (!term || `${item.DESCRPROD} ${item.CODPROD}`.toLowerCase().includes(term)),
      ) as Product[];
  };

  const currentDraft = (): OrderDraft => ({
    id: draftId,
    updatedAt: Date.now(),
    phase,
    partner,
    priceCode,
    priceName: selectedTable?.NOMETAB ?? draft?.priceName ?? "",
    negotiation,
    negotiationName: selectedNegotiation?.DESCRTIPVENDA ?? draft?.negotiationName ?? "",
    observation,
    cart,
  });

  useEffect(() => {
    setLoading(true);
    setError("");
    if (!online) {
      if (!applyOfflineOptions()) setError("Faça uma carga online antes de criar pedidos offline.");
      setLoading(false);
      return;
    }
    api<{ partner: ApiRow; tables: PriceTable[]; negotiations: Negotiation[] }>(
      `/api/sankhya/data?kind=orderOptions&partner=${partner.CODPARC}`,
    )
      .then((result) => {
        setTables(result.tables);
        setNegotiations(result.negotiations);
        if (!priceCode) {
          const preferred = result.tables.find((table) => Number(table.CODTAB) === Number(result.partner.CODTAB));
          setPriceCode(Number(preferred?.CODTAB ?? result.tables[0]?.CODTAB ?? 0));
        }
        if (!negotiation) {
          const preferred = result.negotiations.find((item) => Number(item.CODTIPVENDA) === Number(result.partner.CODTIPVENDA));
          setNegotiation(Number(preferred?.CODTIPVENDA ?? result.negotiations[0]?.CODTIPVENDA ?? 0));
        }
      })
      .catch((err) => {
        if (!applyOfflineOptions()) setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [partner.CODPARC, online, offlineData]);

  useEffect(() => {
    if (phase !== "products" || !priceCode) return;
    if (!online) {
      setGroups(offlineGroups());
      return;
    }
    api<{ rows: ProductGroup[] }>(
      `/api/sankhya/data?kind=productGroups&partner=${partner.CODPARC}&priceCode=${priceCode}`,
    )
      .then((result) => setGroups(result.rows))
      .catch((err) => {
        const cached = offlineGroups();
        if (cached.length) setGroups(cached);
        else setError(err.message);
      });
  }, [phase, priceCode, partner.CODPARC, online, offlineData]);

  useEffect(() => {
    if (phase !== "products" || !productGroup) {
      setProducts([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoadingProducts(true);
      setError("");
      if (!online) {
        setProducts(offlineProducts());
        setLoadingProducts(false);
        return;
      }
      const params = new URLSearchParams({
        kind: "products",
        partner: String(partner.CODPARC),
        priceCode: String(priceCode),
        group: String(productGroup),
        q: search,
      });
      api<{ rows: Product[] }>(`/api/sankhya/data?${params}`)
        .then((result) => setProducts(result.rows))
        .catch((err) => {
          const cached = offlineProducts();
          if (cached.length) setProducts(cached);
          else setError(err.message);
        })
        .finally(() => setLoadingProducts(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [phase, productGroup, search, priceCode, partner.CODPARC, online, offlineData]);

  useEffect(() => {
    onSaveDraft(currentDraft());
  }, [phase, priceCode, negotiation, observation, cart]);

  const setQuantity = (product: Product, change: number) => {
    setCart((current) => {
      const existing = current.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE && item.CODLOCAL === product.CODLOCAL);
      const next = Math.max(0, Math.min(Number(product.DISPONIVEL), (existing?.quantity || 0) + change));
      if (!next) return current.filter((item) => item !== existing);
      if (existing) return current.map((item) => item === existing ? { ...item, quantity: next } : item);
      return [...current, { ...product, quantity: next }];
    });
  };

  const quantityOf = (product: Product) =>
    cart.find((item) => item.CODPROD === product.CODPROD && item.CONTROLE === product.CONTROLE && item.CODLOCAL === product.CODLOCAL)?.quantity || 0;

  const closeOrder = () => {
    onSaveDraft(currentDraft());
    onBack();
  };

  const sendOrder = async () => {
    if (!online) {
      setError("O pedido foi mantido como rascunho. Conecte-se à internet para enviar ao Sankhya.");
      setShowConfirm(false);
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await api<{ orderId?: string }>("/api/sankhya/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner: partner.CODPARC,
          operation: 5,
          negotiation,
          priceCode,
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
      onSent(result.orderId, draftId);
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
        <button className="back-button" onClick={closeOrder}><ArrowLeft size={20} /></button>
        <div><span className="eyebrow">Pedido de venda</span><h1>{draft ? "Continuar pedido" : "Novo pedido"}</h1></div>
        <span className="draft-saved"><FileText size={15} /> Rascunho automático</span>
        <span className={`sync-badge ${online ? "" : "offline"}`}>
          {online ? <CloudCheck size={16} /> : <CloudOff size={16} />}
          {online ? "Sankhya online" : "Modo offline"}
        </span>
      </header>

      <nav className="order-phase-nav" aria-label="Navegação do pedido">
        <button className={phase === "header" ? "active" : ""} onClick={() => setPhase("header")}>
          <ClipboardList size={17} /><span><small>Pedido</small>Cabeçalho</span>
        </button>
        <ArrowRight className="phase-arrow" size={16} />
        <button className={phase === "products" ? "active" : ""} disabled={!priceCode || !negotiation} onClick={() => setPhase("products")}>
          <ShoppingCart size={17} /><span><small>Seleção</small>Produtos</span>
        </button>
        <ArrowRight className="phase-arrow" size={16} />
        <button className={phase === "review" ? "active" : ""} disabled={!cart.length} onClick={() => setPhase("review")}>
          <CheckCircle2 size={17} /><span><small>Finalização</small>Revisão</span>
        </button>
      </nav>

      <div className="new-content order-workspace">
        {phase === "header" && (
          <section className="form-section conditions">
            <div className="section-heading"><div><span className="eyebrow">Cabeçalho do pedido</span><h2>Condições comerciais</h2><p>Confira a tabela cadastrada para o cliente e escolha o tipo de negociação.</p></div></div>
            <div className="selected-client"><span className="client-avatar"><Building2 /></span><div><small>Cliente selecionado</small><strong>{partner.NOMEPARC}</strong><span>Cód. {partner.CODPARC}{partner.GRUPOICMS != null ? ` · Grupo ICMS ${partner.GRUPOICMS}` : ""}</span></div></div>
            {loading ? <div className="empty-state"><LoaderCircle className="spin" /> Carregando condições do Sankhya...</div> : (
              <div className="condition-grid">
                <label>Empresa<div className="select-field"><Building2 size={19} /><span>1 — Norte Sul Sementes</span><LockKeyhole size={15} /></div></label>
                <label>Tipo de operação<div className="select-field valid"><ClipboardList size={19} /><span>TOP 5 — Pedido de venda</span><CheckCircle2 size={16} /></div></label>
                <label>Tabela de preço
                  <select className="native-select" value={priceCode} onChange={(event) => {
                    setPriceCode(Number(event.target.value));
                    setProductGroup(0);
                    setProducts([]);
                    setCart([]);
                  }}>
                    <option value={0}>Selecione a tabela</option>
                    {tables.map((table) => <option key={table.CODTAB} value={table.CODTAB}>{table.CODTAB} — {table.NOMETAB}</option>)}
                  </select>
                  <small>Tabela ativa cadastrada neste cliente para a empresa 1.</small>
                </label>
                <label>Tipo de negociação
                  <select className="native-select" value={negotiation} onChange={(event) => setNegotiation(Number(event.target.value))}>
                    <option value={0}>Selecione a negociação</option>
                    {negotiations.map((item) => <option key={item.CODTIPVENDA} value={item.CODTIPVENDA}>{item.CODTIPVENDA} — {item.DESCRTIPVENDA}</option>)}
                  </select>
                </label>
                <label className="observation-field">Observação<textarea value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="Informações adicionais do pedido" /></label>
              </div>
            )}
            <div className="rule-card"><ShieldCheck size={22} /><div><strong>Regras do Sankhya aplicadas</strong><p>A carteira, o Grupo de ICMS, a tabela, a negociação e a TOP 5 serão revalidados antes do envio.</p></div></div>
          </section>
        )}

        {phase === "products" && (
          <section className="form-section products-section">
            <div className="section-heading"><div><span className="eyebrow">Itens do pedido</span><h2>Adicionar produtos</h2><p>Selecione um grupo para consultar os produtos da tabela escolhida.</p></div><span className="table-tag">{selectedTable?.NOMETAB || `Tabela ${priceCode}`}</span></div>
            <div className="product-filters">
              <label>Grupo de produto
                <select className="native-select" value={productGroup} onChange={(event) => setProductGroup(Number(event.target.value))}>
                  <option value={0}>Selecione um grupo</option>
                  {groups.map((group) => <option key={group.CODGRUPOPROD} value={group.CODGRUPOPROD}>{group.DESCRGRUPOPROD}</option>)}
                </select>
              </label>
              <label>Buscar produto
                <span className="search-box"><Search size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou código" /></span>
              </label>
            </div>
            <div className="product-list">
              {!productGroup ? <div className="empty-state product-filter-empty"><Filter size={22} /> Nenhum filtro selecionado</div> :
                loadingProducts ? <div className="empty-state"><LoaderCircle className="spin" /> Consultando tabela, estoque e mobilidade...</div> :
                  products.map((product) => (
                    <article key={`${product.CODPROD}-${product.CODLOCAL}-${product.CONTROLE}`} className={quantityOf(product) ? "selected" : ""}>
                      <span className="product-icon"><Sprout size={22} /></span>
                      <div className="product-info"><strong>{product.DESCRPROD}</strong><small>Cód. {product.CODPROD} · {product.CODVOL}</small><span><PackageCheck size={14} /> {Number(product.DISPONIVEL).toLocaleString("pt-BR")} disponíveis</span></div>
                      <div className="product-price"><strong>{money(Number(product.VLRVENDA))}</strong><small>por {product.CODVOL}</small></div>
                      {quantityOf(product) ? (
                        <div className="quantity"><button onClick={() => setQuantity(product, -1)}><Minus size={16} /></button><strong>{quantityOf(product)}</strong><button onClick={() => setQuantity(product, 1)}><Plus size={16} /></button></div>
                      ) : <button className="add-button" onClick={() => setQuantity(product, 1)}><Plus size={17} /> Adicionar</button>}
                    </article>
                  ))}
              {productGroup > 0 && !loadingProducts && !products.length && <div className="empty-state">Nenhum produto elegível encontrado para este grupo e tabela.</div>}
            </div>
          </section>
        )}

        {phase === "review" && (
          <section className="form-section review-section">
            <div className="section-heading"><div><span className="eyebrow">Revisão</span><h2>Revise seu pedido</h2><p>Confira as condições e os itens antes de validar o envio.</p></div></div>
            <div className="review-grid">
              <article className="review-client"><div className="review-title"><Building2 size={19} /><strong>Cliente e condições</strong><button onClick={() => setPhase("header")}>Editar</button></div><h3>{partner.NOMEPARC}</h3><p>Cód. {partner.CODPARC}</p><dl><div><dt>Operação</dt><dd>TOP 5</dd></div><div><dt>Tabela</dt><dd>{selectedTable?.NOMETAB || priceCode}</dd></div><div><dt>Negociação</dt><dd>{selectedNegotiation?.DESCRTIPVENDA || negotiation}</dd></div></dl></article>
              <article className="review-items"><div className="review-title"><ShoppingCart size={19} /><strong>Itens do pedido</strong><button onClick={() => setPhase("products")}>Editar</button></div>{cart.map((item) => <div className="review-item" key={`${item.CODPROD}-${item.CODLOCAL}-${item.CONTROLE}`}><span>{item.quantity}×</span><div><strong>{item.DESCRPROD}</strong><small>{money(Number(item.VLRVENDA))} / {item.CODVOL}</small></div><strong>{money(item.quantity * Number(item.VLRVENDA))}</strong></div>)}</article>
            </div>
            {observation && <div className="review-observation"><small>Observação</small><p>{observation}</p></div>}
            <div className="order-summary"><span><small>{totalUnits} {totalUnits === 1 ? "unidade" : "unidades"}</small><strong>Total do pedido</strong></span><strong>{money(total)}</strong></div>
            <div className="validation-strip"><span><CheckCircle2 /> Cliente e ICMS</span><span><CheckCircle2 /> Tabela vigente</span><span><CheckCircle2 /> Estoque e mobilidade</span><span><CheckCircle2 /> Negociação ativa</span></div>
            {!online && <div className="offline-order-notice"><CloudOff size={20} /><span><strong>Rascunho salvo offline</strong><small>Conecte-se à internet para validar os dados atuais e enviar ao Sankhya.</small></span></div>}
          </section>
        )}
        {error && <div className="global-error">{error}</div>}
      </div>

      <footer className="new-footer">
        <button className="secondary" onClick={phase === "header" ? closeOrder : () => setPhase(phase === "review" ? "products" : "header")}>Voltar</button>
        <div className="footer-total">{phase !== "header" && <><small>{totalUnits} itens</small><strong>{money(total)}</strong></>}</div>
        <button className="primary" disabled={(phase === "header" && (!priceCode || !negotiation || loading)) || (phase === "products" && !cart.length) || (phase === "review" && !online)} onClick={() => {
          if (phase === "header") setPhase("products");
          else if (phase === "products") setPhase("review");
          else setShowConfirm(true);
        }}>
          {phase === "review"
            ? online
              ? <><ShieldCheck size={18} /> Validar e enviar</>
              : <><CloudOff size={18} /> Aguardando internet</>
            : <>Continuar <ArrowRight size={18} /></>}
        </button>
      </footer>

      {showConfirm && (
        <div className="modal-backdrop">
          <div className="confirm-modal">
            <button className="modal-close" onClick={() => setShowConfirm(false)}><X size={20} /></button>
            <span className="confirm-icon"><Send size={27} /></span>
            <h2>Enviar pedido ao Sankhya?</h2>
            <p>O cliente, a tabela, a negociação, os preços, o estoque e a TOP 5 serão validados novamente.</p>
            <div className="confirm-summary"><span><small>Cliente</small><strong>{partner.NOMEPARC}</strong></span><span><small>Total</small><strong>{money(total)}</strong></span></div>
            <div className="modal-actions"><button className="secondary" onClick={() => setShowConfirm(false)}>Revisar</button><button className="primary" onClick={sendOrder} disabled={sending}>{sending ? <LoaderCircle className="spin" /> : <><Send size={18} /> Confirmar envio</>}</button></div>
          </div>
        </div>
      )}
    </div>
  );
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

function MobileNav({
  active,
  onOrders,
  onClients,
  onMore,
}: {
  active: "orders" | "clients" | "more";
  onOrders: () => void;
  onClients: () => void;
  onMore: () => void;
}) {
  return (
    <nav className="mobile-nav">
      <button><Home /><span>Início</span></button>
      <button className={active === "orders" ? "active" : ""} onClick={onOrders}><ShoppingBag /><span>Pedidos</span></button>
      <button className={active === "clients" ? "active" : ""} onClick={onClients}><UsersRound /><span>Clientes</span></button>
      <button><MapPin /><span>Roteiro</span></button>
      <button className={active === "more" ? "active" : ""} onClick={onMore}><Menu /><span>Mais</span></button>
    </nav>
  );
}
