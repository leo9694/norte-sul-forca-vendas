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
  assert.match(html, /rel="manifest"/);
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
  assert.match(serviceWorker, /norte-sul-vendas-v2/);
  assert.doesNotMatch(serviceWorker, /const SHELL = \[[^\]]*["']\/["']/);
  assert.match(serviceWorker, /response\.ok/);
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
  assert.doesNotMatch(activeFlow, /className="stepper"/);
});
