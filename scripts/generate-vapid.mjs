import { readFile, writeFile } from "node:fs/promises";
import webpush from "web-push";

const envPath = new URL("../.env.treinamento", import.meta.url);
const current = await readFile(envPath, "utf8");
const keys = webpush.generateVAPIDKeys();
const values = {
  VAPID_SUBJECT: "mailto:admin@nortesulsementes.com.br",
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
};

let updated = current.trimEnd();
for (const [name, value] of Object.entries(values)) {
  const line = `${name}=${value}`;
  const expression = new RegExp(`^${name}=.*$`, "m");
  updated = expression.test(updated)
    ? updated.replace(expression, line)
    : `${updated}\n${line}`;
}

await writeFile(envPath, `${updated}\n`, "utf8");
console.log("Chaves de notificação configuradas em .env.treinamento.");
