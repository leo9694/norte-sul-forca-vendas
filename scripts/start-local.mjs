import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const publicPort = Number(process.env.PORT || 3000);
const publicHost = "0.0.0.0";
const loopback = "127.0.0.1";
const localUrl = `http://localhost:${publicPort}`;
const projectRoot = process.cwd();
const clientDir = path.resolve(projectRoot, "dist", "client");
const serverEntry = path.resolve(projectRoot, "dist", "server", "index.js");
const clientManifest = path.resolve(clientDir, ".vite", "manifest.json");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function portIsBusy(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: loopback, port });
    socket.setTimeout(600);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, loopback, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function staticFileFor(urlPath) {
  if (!urlPath || urlPath === "/") return null;
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const candidate = path.resolve(clientDir, `.${decoded}`);
  if (candidate !== clientDir && !candidate.startsWith(`${clientDir}${path.sep}`)) return null;
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function newestModifiedTime(target) {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.mtimeMs;
    if (!stat.isDirectory()) return 0;
    return fs.readdirSync(target, { withFileTypes: true }).reduce((newest, entry) => {
      const entryPath = path.join(target, entry.name);
      return Math.max(newest, newestModifiedTime(entryPath));
    }, stat.mtimeMs);
  } catch {
    return 0;
  }
}

function buildIsOutdated() {
  if (!fs.existsSync(serverEntry) || !fs.existsSync(clientManifest)) return true;
  const buildTime = Math.min(
    fs.statSync(serverEntry).mtimeMs,
    fs.statSync(clientManifest).mtimeMs,
  );
  const sourceTargets = [
    "app",
    "build",
    "public",
    "worker",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "next.config.ts",
  ];
  return sourceTargets.some((target) =>
    newestModifiedTime(path.resolve(projectRoot, target)) > buildTime,
  );
}

function serveStatic(request, response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
    "Content-Length": String(fs.statSync(filePath).size),
    "Cache-Control": filePath.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
  response.writeHead(200, headers);
  if (request.method === "HEAD") return response.end();
  fs.createReadStream(filePath).pipe(response);
}

if (buildIsOutdated()) {
  console.log("\nAlterações detectadas. Atualizando o app antes de iniciar...\n");
  const buildCommand = process.platform === "win32"
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm run build"] }
    : { command: "npm", args: ["run", "build"] };
  const build = spawnSync(buildCommand.command, buildCommand.args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    console.error("\nA atualização falhou. Corrija o erro acima e execute npm start novamente.\n");
    process.exit(build.status || 1);
  }
}

if (await portIsBusy(publicPort)) {
  console.log(`\nO app já está rodando em ${localUrl}\n`);
  process.exit(0);
}

const internalPort = await getFreePort();
const vinext = spawn(
  process.execPath,
  ["node_modules/vinext/dist/cli.js", "start", "--port", String(internalPort), "--hostname", loopback],
  { cwd: projectRoot, env: process.env, stdio: ["ignore", "ignore", "pipe"] },
);

vinext.stderr.on("data", (chunk) => process.stderr.write(chunk));

const startedAt = Date.now();
while (!(await portIsBusy(internalPort))) {
  if (vinext.exitCode !== null) {
    console.error("\nO servidor interno não conseguiu iniciar.\n");
    process.exit(vinext.exitCode || 1);
  }
  if (Date.now() - startedAt > 15_000) {
    vinext.kill();
    console.error("\nO servidor demorou mais que o esperado para iniciar.\n");
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", localUrl);
  const staticFile = (request.method === "GET" || request.method === "HEAD")
    ? staticFileFor(requestUrl.pathname)
    : null;

  if (staticFile) {
    serveStatic(request, response, staticFile);
    return;
  }

  const proxy = http.request({
    host: loopback,
    port: internalPort,
    method: request.method,
    path: request.url,
    headers: {
      ...request.headers,
      host: request.headers.host || `localhost:${publicPort}`,
      "x-forwarded-host": request.headers.host || `localhost:${publicPort}`,
      "x-forwarded-proto": "http",
    },
  }, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode || 500, proxyResponse.headers);
    proxyResponse.pipe(response);
  });

  proxy.once("error", () => {
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Servidor local indisponível.");
  });
  request.pipe(proxy);
});

function shutdown() {
  if (!vinext.killed) vinext.kill();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
vinext.once("exit", (code) => {
  if (server.listening) server.close();
  if (code && code !== 0) process.exitCode = code;
});

server.listen(publicPort, publicHost, () => {
  console.log(`\nApp rodando em ${localUrl}`);
  console.log("Pressione Ctrl+C para encerrar.\n");
});
