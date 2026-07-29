import { spawn } from "node:child_process";
import net from "node:net";

const port = Number(process.env.PORT || 3000);
const host = "127.0.0.1";
const localUrl = `http://localhost:${port}`;

function portIsBusy() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(700);
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

if (await portIsBusy()) {
  console.log(`\nO app já está rodando em ${localUrl}\n`);
  process.exit(0);
}

const server = spawn(
  process.execPath,
  ["node_modules/vinext/dist/cli.js", "start", "--port", String(port)],
  { env: process.env, stdio: "inherit" },
);

server.once("exit", (code) => process.exit(code ?? 0));
