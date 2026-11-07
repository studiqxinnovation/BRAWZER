// Prepares the local OpenBao (Vault-compatible) key service: enables the
// Transit engine and creates Brawzer's key-encryption key. Idempotent, and
// for the local development container only.
import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const address = process.env.VAULT_ADDR ?? "http://127.0.0.1:8210";
const token = process.env.VAULT_TOKEN ?? "brawzer_local_only";
const mount = process.env.VAULT_TRANSIT_MOUNT ?? "transit";
const key = process.env.VAULT_TRANSIT_KEY ?? "brawzer";

async function call(method, route, body) {
  const response = await fetch(new URL(route, address), {
    method,
    headers: { "X-Vault-Token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.text() };
}

const mounts = await call("GET", "/v1/sys/mounts");
if (!mounts.body.includes(`"${mount}/"`)) {
  const enabled = await call("POST", `/v1/sys/mounts/${mount}`, { type: "transit" });
  if (enabled.status >= 300)
    throw new Error(`Enabling transit failed (${enabled.status}): ${enabled.body}`);
}
const created = await call("POST", `/v1/${mount}/keys/${key}`, { type: "aes256-gcm96" });
if (created.status >= 300)
  throw new Error(`Creating the key failed (${created.status}): ${created.body}`);
console.log(`OpenBao ready: transit engine "${mount}", key "${key}" at ${address}`);
