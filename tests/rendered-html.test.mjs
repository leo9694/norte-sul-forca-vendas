import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const clientRoot = path.join(projectRoot, "dist", "client");

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost:3000/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the sales application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="pt-BR">/i);
  assert.match(html, /<title>Norte Sul Vendas<\/title>/i);
  assert.match(html, /Conectando ao Sankhya/);
  assert.match(html, /rel="manifest"\s+href="\/manifest\.webmanifest"/);
  assert.doesNotMatch(html, /rel="manifest"[^>]+localhost/i);
  assert.match(html, /\/assets\/[^"]+\.css/);
  assert.match(html, /\/assets\/[^"]+\.js/);
});

test("emits every stylesheet and script referenced by the page", async () => {
  const html = await (await render()).text();
  const assetPaths = [...html.matchAll(/["'](\/assets\/[^"'?]+?\.(?:css|js))["']/g)]
    .map((match) => match[1]);
  const uniqueAssets = [...new Set(assetPaths)];

  assert.ok(uniqueAssets.length >= 2);
  await Promise.all(uniqueAssets.map((assetPath) =>
    access(path.join(clientRoot, ...assetPath.split("/").filter(Boolean))),
  ));
});

test("ships installable PWA files with the current cache policy", async () => {
  const [manifest, serviceWorker] = await Promise.all([
    readFile(path.join(clientRoot, "manifest.webmanifest"), "utf8"),
    readFile(path.join(clientRoot, "sw.js"), "utf8"),
  ]);

  assert.match(manifest, /"display"\s*:\s*"standalone"/);
  assert.match(manifest, /Norte Sul/);
  assert.match(serviceWorker, /norte-sul-vendas-v7/);
  assert.match(manifest, /brand-app-icon-192\.png/);
  assert.match(manifest, /brand-app-icon-512\.png/);
  assert.match(manifest, /brand-app-icon-maskable-512\.png/);
  assert.match(manifest, /"scope"\s*:\s*"\/"/);
  assert.match(serviceWorker, /cache\.put\(["']\/["']/);
  assert.match(serviceWorker, /html\.matchAll/);
  assert.match(serviceWorker, /cache\.addAll/);
  assert.match(serviceWorker, /response\.ok/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /OPEN_COMMUNICATION/);
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
});

test("keeps a seller-scoped offline load and manual refresh screen", async () => {
  const [appSource, storeSource, syncSource] = await Promise.all([
    readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "offline-store.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "sync", "route.ts"), "utf8"),
  ]);

  assert.match(storeSource, /indexedDB\.open/);
  assert.match(storeSource, /seller\.sellerId/);
  assert.match(syncSource, /clients,\s*orders,\s*tables,\s*negotiations,\s*products/);
  assert.match(syncSource, /CODGRUPAI/);
  assert.match(syncSource, /P\.MARCA/);
  assert.match(appSource, /function MoreScreen/);
  assert.match(appSource, />Fazer carga</);
  assert.match(appSource, /Aguardando internet/);
  assert.match(appSource, /beforeinstallprompt/);
  assert.match(appSource, /Instalar aplicativo/);
  assert.match(appSource, /Deseja sair do aplicativo/);
  assert.doesNotMatch(appSource, /button className="avatar"/);
  assert.match(appSource, /addEventListener\("popstate"/);
  assert.match(appSource, /history\.pushState/);
  assert.match(appSource, /phase:\s*nextPhase/);
});

test("shows a seller-scoped monthly performance dashboard", async () => {
  const [appSource, dataSource, styleSource, sankhyaSource] = await Promise.all([
    readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "data", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "globals.css"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "_lib", "sankhya.ts"), "utf8"),
  ]);

  assert.match(appSource, /function HomeScreen/);
  assert.match(appSource, /useState<AppScreen>\("home"\)/);
  assert.match(appSource, /replaceHistoryView\("home"\)/);
  assert.match(appSource, /Produtos mais vendidos/);
  assert.match(appSource, /Valor de vendas por dia/);
  assert.match(appSource, /Principais clientes do período/);
  assert.match(appSource, /function DashboardDetailPanel/);
  assert.match(appSource, /Abrir pedidos do dia/);
  assert.match(appSource, /Saiba mais/);
  assert.match(appSource, /dialog: "dashboard-detail"/);
  assert.match(appSource, /Carteira de clientes/);
  assert.match(appSource, /Clientes reativados/);
  assert.match(appSource, /type: "newClients"/);
  assert.match(appSource, /type: "recurringClients"/);
  assert.match(appSource, /type: "reactivatedClients"/);
  assert.match(appSource, />Ver clientes/);
  assert.match(appSource, /Vendas por grupo de produto/);
  assert.match(appSource, /Gerar relatório completo/);
  assert.match(appSource, /downloadSalesReport/);
  assert.match(appSource, /downloadDashboardPanelReport/);
  assert.match(appSource, /className="panel-pdf-button"/);
  assert.match(appSource, /panelPdfButton\("evolution"/);
  assert.match(appSource, /panelPdfButton\("products"/);
  assert.match(appSource, /panelPdfButton\("groups"/);
  assert.match(appSource, /panelPdfButton\("clients"/);
  assert.match(appSource, /panelPdfButton\("portfolio"/);
  assert.match(appSource, /salesGroupPie/);
  assert.match(appSource, /Top 10 produtos mais vendidos/);
  assert.match(appSource, /sort\(\(left, right\) => Number\(right\.SALES_VALUE\) - Number\(left\.SALES_VALUE\)\)\s*\.slice\(0, 10\)/);
  assert.match(appSource, /Grafico vertical por dia/);
  assert.match(appSource, /Lista completa de produtos vendidos/);
  const panelProductReport = appSource.slice(appSource.indexOf('if (kind === "products")'), appSource.indexOf('if (kind === "groups")'));
  assert.doesNotMatch(panelProductReport, /slice\(0, 10\)/);
  assert.match(appSource, /document\.save\(`relatorio-vendas-/);
  assert.match(appSource, /kind=dashboardProducts/);
  assert.match(appSource, /kind=dashboardClients/);
  assert.match(appSource, /group-sales-bars/);
  assert.match(appSource, /type: "groupProducts"/);
  assert.match(appSource, /Produtos vendidos —/);
  assert.match(appSource, /dashboardInactiveClients/);
  assert.match(appSource, /Últimos 30 dias/);
  assert.match(appSource, /type="date"/);
  assert.match(appSource, /norte-sul-vendas:dashboard:/);
  assert.match(appSource, /kind=dashboardSellers/);
  assert.match(appSource, /Analisando vendedor/);
  assert.match(appSource, /seller: String\(selectedSellerId\)/);
  assert.match(dataSource, /kind === "dashboardSellers"/);
  assert.match(dataSource, /canAnalyzeOtherSellers\(session\)/);
  assert.match(dataSource, /dashboardSellerId = requestedSellerId/);
  assert.match(dataSource, /Vendedor inválido ou inativo/);
  assert.match(sankhyaSource, /JOIN TSIGRU G ON G\.CODGRUPO = U\.CODGRUPO/);
  assert.match(sankhyaSource, /group === "diretoria" \|\| group === "gerente"/);
  assert.match(dataSource, /kind === "dashboard"/);
  assert.match(dataSource, /C\.CODVEND = \$\{session\.sellerId\}/);
  assert.match(dataSource, /TRUNC\(SYSDATE, 'MM'\)/);
  assert.match(dataSource, /safeDate\(url\.searchParams\.get\("dateFrom"\)\)/);
  assert.match(dataSource, /JOIN TGFITE/);
  assert.match(dataSource, /kind === "dashboardDay"/);
  assert.match(dataSource, /kind === "dashboardProducts"/);
  assert.match(dataSource, /kind === "dashboardGroupProducts"/);
  assert.match(dataSource, /P\.CODGRUPOPROD = \$\{group\}/);
  assert.match(dataSource, /kind === "dashboardClients"/);
  assert.match(dataSource, /CODPROD ENTITY_ID, P\.DESCRPROD ENTITY_NAME/);
  assert.match(dataSource, /CODPARC ENTITY_ID, P\.NOMEPARC ENTITY_NAME/);
  assert.match(dataSource, /NEW_CLIENTS/);
  assert.match(dataSource, /RECURRING_CLIENTS/);
  assert.match(dataSource, /REACTIVATED_CLIENTS/);
  assert.match(dataSource, /INACTIVE_30/);
  assert.match(dataSource, /kind === "dashboardInactiveClients"/);
  assert.match(dataSource, /kind === "dashboardNewClients"/);
  assert.match(dataSource, /kind === "dashboardRecurringClients"/);
  assert.match(dataSource, /kind === "dashboardReactivatedClients"/);
  assert.match(dataSource, /DESCRGRUPOPROD/);
  assert.match(dataSource, /AND C\.STATUSNOTA = 'L'/);
  assert.match(styleSource, /\.dashboard-kpis/);
  assert.match(styleSource, /\.dashboard-detail-panel/);
  assert.match(styleSource, /\.dashboard-secondary-grid/);
  assert.ok(
    appSource.indexOf('className="dashboard-card product-ranking-card"') < appSource.indexOf('className="dashboard-card group-sales-card"')
      && appSource.indexOf('className="dashboard-card group-sales-card"') < appSource.indexOf('className="dashboard-card clients-ranking-card"'),
    "sales by group should stay next to the sales mix and before customer relationship",
  );
});

test("defaults the orders list to the current month with quick period filters", async () => {
  const [appSource, dataSource] = await Promise.all([
    readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "data", "route.ts"), "utf8"),
  ]);
  const ordersScreen = appSource.slice(appSource.indexOf("function OrdersScreen"), appSource.indexOf("function Metric"));

  assert.match(ordersScreen, /useState\(\(\) => currentMonthStart\(\)\)/);
  assert.match(ordersScreen, /Últimos 30 dias/);
  assert.match(ordersScreen, /Últimos 3 meses/);
  assert.match(ordersScreen, /period-filter-presets/);
  assert.match(dataSource, /kind === "orders"[\s\S]*?AND C\.DTNEG >= TRUNC\(SYSDATE, 'MM'\)/);
});

test("restricts and renders the consolidated company sales monitor", async () => {
  const [appSource, dataSource, styleSource] = await Promise.all([
    readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "data", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "globals.css"), "utf8"),
  ]);
  const generalSalesSource = dataSource.slice(
    dataSource.indexOf('if (kind === "generalSalesCompanies"'),
    dataSource.indexOf('if (kind === "dashboardSellers"'),
  );

  assert.match(appSource, /function GeneralSalesScreen/);
  assert.match(appSource, /function MonthlySalesChart/);
  assert.match(appSource, /canMonitorSales/);
  assert.match(appSource, /general-sales/);
  assert.match(appSource, /Ranking de vendedores/);
  assert.match(appSource, /Grupos mais vendidos/);
  assert.match(appSource, /Vendas por m.s/);
  assert.match(dataSource, /kind === "generalSalesCompanies" \|\| kind === "generalSales"/);
  assert.match(dataSource, /canAnalyzeOtherSellers\(session\)/);
  assert.match(dataSource, /JOIN TSIEMP E ON E\.CODEMP = D\.CODEMP/);
  assert.match(dataSource, /JOIN TGFVEN V ON V\.CODVEND = D\.CODVEND/);
  assert.match(dataSource, /TRUNC\(C\.DTNEG, 'MM'\)/);
  assert.match(dataSource, /OPEN_ORDER_COUNT/);
  assert.match(generalSalesSource, /C\.CODTIPOPER = 35/);
  assert.match(generalSalesSource, /C\.TIPMOV = 'V'/);
  assert.match(generalSalesSource, /SUM\(I\.VLRTOT\)/);
  assert.match(generalSalesSource, /ITEM_VALUE/);
  assert.doesNotMatch(generalSalesSource, /C\.VLRNOTA/);
  assert.doesNotMatch(generalSalesSource, /C\.CODTIPOPER = 5/);
  assert.match(styleSource, /\.general-monitor-grid/);
  assert.match(styleSource, /\.general-line-chart/);
  assert.match(styleSource, /\.general-donut/);
  assert.match(styleSource, /\.general-company-table/);
  assert.match(styleSource, /\.general-company-row/);
  assert.match(styleSource, /\.mobile-nav\.management/);
});

test("provides authenticated shared communication between Sankhya users", async () => {
  const [appSource, styleSource, usersSource, conversationsSource, messagesSource, pushSource, chatStore] = await Promise.all([
    readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "globals.css"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "chat", "users", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "chat", "conversations", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "chat", "messages", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "chat", "push", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "db", "chat.ts"), "utf8"),
  ]);

  assert.match(appSource, /function CommunicationScreen/);
  assert.match(appSource, />Comunicação</);
  assert.doesNotMatch(appSource, /Equipe Norte Sul/);
  assert.match(appSource, /Pesquisar usuário/);
  assert.match(appSource, /setInterval\(\(\) => void loadMessages/);
  assert.match(appSource, /unreadMessages/);
  assert.match(appSource, /Notification\.requestPermission/);
  assert.match(appSource, /pushManager\.subscribe/);
  assert.match(appSource, /\/api\/chat\/push/);
  assert.match(appSource, /nav-unread-badge/);
  assert.match(usersSource, /FROM TSIUSU/);
  assert.match(usersSource, /requireSession/);
  assert.match(conversationsSource, /createConversation/);
  assert.match(messagesSource, /addMessage/);
  assert.match(messagesSource, /sendChatPush/);
  assert.match(pushSource, /savePushSubscription/);
  assert.match(chatStore, /chat-store\.json/);
  assert.match(chatStore, /mutationQueue/);
  assert.match(styleSource, /\.chat-shell\s*\{[\s\S]*?min-height:\s*0/);
  assert.doesNotMatch(styleSource, /\.chat-shell\s*\{[\s\S]*?min-height:\s*520px/);
  assert.match(styleSource, /height:\s*calc\(100dvh - 68px - env\(safe-area-inset-bottom,\s*0px\)\)/);
  assert.match(styleSource, /\.communication-page\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(styleSource, /\.message-bubble p\s*\{[^}]*font-size:\s*14px/);
  assert.match(styleSource, /\.message-bubble p\s*\{[^}]*font-size:\s*15px/);
});

test("keeps the new sales-order flow modal, filter-first and draft-aware", async () => {
  const source = await readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8");
  const activeFlow = source.slice(
    source.indexOf("function NewOrderV2"),
    source.indexOf("function NewOrder(", source.indexOf("function NewOrderV2")),
  );

  assert.match(source, /function ClientPickerModal/);
  assert.match(activeFlow, /Selecione uma marca, grupo ou pesquise um produto/);
  assert.match(source, /normalizeProductSearch/);
  assert.match(activeFlow, /!selectedGroups\.length && !brand && !search\.trim/);
  assert.match(activeFlow, />Aplicar</);
  assert.match(activeFlow, /Rascunho automático/);
  assert.match(activeFlow, /kind=productGroups/);
  assert.match(activeFlow, /Filtrar por grupo/);
  assert.match(activeFlow, /groups:\s*selectedGroups\.join/);
  assert.match(activeFlow, /Todas as marcas/);
  assert.match(activeFlow, /CODGRUPAI/);
  assert.match(activeFlow, /setExpandedGroups\(\[\]\)/);
  assert.match(activeFlow, /clearProductFilters/);
  assert.match(activeFlow, /Limpar filtros/);
  assert.match(activeFlow, /className="order-phase-nav"/);
  assert.match(activeFlow, /Tabela ativa cadastrada neste cliente/);
  assert.doesNotMatch(activeFlow, /className="stepper"/);
});

test("sends orders through an authenticated Sankhya service session", async () => {
  const [sankhyaSource, orderSource, dataSource, logoutSource] = await Promise.all([
    readFile(path.join(projectRoot, "app", "api", "_lib", "sankhya.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "orders", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "data", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "auth", "logout", "route.ts"), "utf8"),
  ]);

  assert.match(sankhyaSource, /mgeSession=/);
  assert.match(sankhyaSource, /A sessão do Sankhya não foi reconhecida/);
  assert.match(sankhyaSource, /SESSION_DURATION_HOURS\s*=\s*12/);
  assert.match(sankhyaSource, /maxAge\s*=\s*SESSION_DURATION_SECONDS/);
  assert.match(sankhyaSource, /TECHNICAL_SESSION_REUSE_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  assert.match(sankhyaSource, /isSankhyaAuthenticationError/);
  assert.match(sankhyaSource, /getTechnicalSession\(true\)/);
  assert.match(sankhyaSource, /return \{ \.\.\.session, jsessionid: technicalSession\.jsessionid \}/);
  assert.doesNotMatch(logoutSource, /MobileLoginSP\.logout/);
  assert.match(dataSource, /RELEVANCIA/);
  assert.match(dataSource, /searchTokens\.map/);
  assert.match(dataSource, /!search && productGroups\.length/);
  assert.match(orderSource, /DHTIPOPER/);
  assert.match(orderSource, /DHTIPVENDA/);
  assert.match(orderSource, /CODNAT:\s*\{\s*\$:\s*"1010000"\s*\}/);
});
