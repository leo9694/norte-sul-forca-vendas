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
  assert.match(serviceWorker, /norte-sul-vendas-v4/);
  assert.match(manifest, /app-icon-192\.png/);
  assert.match(manifest, /app-icon-512\.png/);
  assert.match(manifest, /app-icon-maskable-512\.png/);
  assert.match(manifest, /"scope"\s*:\s*"\/"/);
  assert.match(serviceWorker, /cache\.put\(["']\/["']/);
  assert.match(serviceWorker, /html\.matchAll/);
  assert.match(serviceWorker, /cache\.addAll/);
  assert.match(serviceWorker, /response\.ok/);
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

test("provides authenticated shared communication between Sankhya users", async () => {
  const [appSource, styleSource, usersSource, conversationsSource, messagesSource, chatStore] = await Promise.all([
    readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "globals.css"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "chat", "users", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "chat", "conversations", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "chat", "messages", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "db", "chat.ts"), "utf8"),
  ]);

  assert.match(appSource, /function CommunicationScreen/);
  assert.match(appSource, />Comunicação</);
  assert.doesNotMatch(appSource, /Equipe Norte Sul/);
  assert.match(appSource, /Pesquisar usuário/);
  assert.match(appSource, /setInterval\(\(\) => void loadMessages/);
  assert.match(usersSource, /FROM TSIUSU/);
  assert.match(usersSource, /requireSession/);
  assert.match(conversationsSource, /createConversation/);
  assert.match(messagesSource, /addMessage/);
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
  const [sankhyaSource, orderSource, dataSource] = await Promise.all([
    readFile(path.join(projectRoot, "app", "api", "_lib", "sankhya.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "orders", "route.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "data", "route.ts"), "utf8"),
  ]);

  assert.match(sankhyaSource, /mgeSession=/);
  assert.match(sankhyaSource, /A sessão do Sankhya não foi reconhecida/);
  assert.match(sankhyaSource, /SESSION_DURATION_HOURS\s*=\s*12/);
  assert.match(sankhyaSource, /maxAge\s*=\s*SESSION_DURATION_SECONDS/);
  assert.match(dataSource, /RELEVANCIA/);
  assert.match(dataSource, /searchTokens\.map/);
  assert.match(dataSource, /!search && productGroups\.length/);
  assert.match(orderSource, /DHTIPOPER/);
  assert.match(orderSource, /DHTIPVENDA/);
  assert.match(orderSource, /CODNAT:\s*\{\s*\$:\s*"1010000"\s*\}/);
});
