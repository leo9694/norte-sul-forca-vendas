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
  assert.match(appSource, /function MoreScreen/);
  assert.match(appSource, />Fazer carga</);
  assert.match(appSource, /Aguardando internet/);
  assert.match(appSource, /beforeinstallprompt/);
  assert.match(appSource, /Instalar aplicativo/);
});

test("keeps the new sales-order flow modal, filter-first and draft-aware", async () => {
  const source = await readFile(path.join(projectRoot, "app", "sales-app.tsx"), "utf8");
  const activeFlow = source.slice(
    source.indexOf("function NewOrderV2"),
    source.indexOf("function NewOrder(", source.indexOf("function NewOrderV2")),
  );

  assert.match(source, /function ClientPickerModal/);
  assert.match(activeFlow, /Nenhum filtro selecionado/);
  assert.match(activeFlow, /Rascunho automático/);
  assert.match(activeFlow, /kind=productGroups/);
  assert.match(activeFlow, /className="order-phase-nav"/);
  assert.match(activeFlow, /Tabela ativa cadastrada neste cliente/);
  assert.doesNotMatch(activeFlow, /className="stepper"/);
});

test("sends orders through an authenticated Sankhya service session", async () => {
  const [sankhyaSource, orderSource] = await Promise.all([
    readFile(path.join(projectRoot, "app", "api", "_lib", "sankhya.ts"), "utf8"),
    readFile(path.join(projectRoot, "app", "api", "sankhya", "orders", "route.ts"), "utf8"),
  ]);

  assert.match(sankhyaSource, /mgeSession=/);
  assert.match(sankhyaSource, /A sessão do Sankhya não foi reconhecida/);
  assert.match(orderSource, /DHTIPOPER/);
  assert.match(orderSource, /DHTIPVENDA/);
  assert.match(orderSource, /CODNAT:\s*\{\s*\$:\s*"1010000"\s*\}/);
});
