import { describe, expect, it } from "vitest";
import { loadLocalEnvFile } from "../src/config/env.js";
import { VaultTransitKeyProvider } from "../src/crypto/key-providers.js";
import { SecretBox } from "../src/crypto/secret-box.js";

// Requires the local OpenBao from `pnpm infra:up` (Vault-compatible API).
loadLocalEnvFile();
const options = {
  address: process.env.VAULT_ADDR ?? "http://127.0.0.1:8210",
  token: process.env.VAULT_TOKEN ?? "brawzer_local_only",
  mount: "transit",
  keyName: "brawzer",
};

describe("Vault/OpenBao Transit key provider", () => {
  it("seals and opens secrets with data keys from the real key service", async () => {
    const box = new SecretBox(new VaultTransitKeyProvider(options));
    const sealed = await box.seal("otpauth-secret-JBSWY3DP", "totp:integration");
    expect(sealed).not.toContain("JBSWY3DP");
    expect(await box.open(sealed, "totp:integration")).toBe("otpauth-secret-JBSWY3DP");
    await expect(box.open(sealed, "totp:someone-else")).rejects.toThrow();
  });

  it("fails clearly with a wrong token", async () => {
    const provider = new VaultTransitKeyProvider({ ...options, token: "wrong-token" });
    await expect(provider.generateDataKey()).rejects.toThrow(/Key service responded 403/);
  });
});
