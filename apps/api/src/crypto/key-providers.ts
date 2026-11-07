import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** A data key: used once to encrypt one secret, then stored only in wrapped form. */
export interface DataKey {
  /** Which key-encryption key wrapped it; letters, digits, "_" and "-" only. */
  keyId: string;
  plaintext: Buffer;
  wrapped: Buffer;
}

/**
 * Holds the key-encryption keys. Brawzer never stores them: locally they come
 * from the environment, in production they never leave the key service.
 */
export interface KeyProvider {
  generateDataKey(): Promise<DataKey>;
  unwrap(keyId: string, wrapped: Buffer): Promise<Buffer>;
}

const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Development only: key-encryption keys from ENCRYPTION_KEYS. The first one wraps new data keys. */
export class LocalKeyProvider implements KeyProvider {
  private readonly keys: ReadonlyMap<string, Buffer>;
  private readonly currentId: string;
  private readonly currentKey: Buffer;

  constructor(keys: readonly { id: string; key: Buffer }[]) {
    const first = keys[0];
    if (!first) throw new Error("LocalKeyProvider needs at least one key");
    for (const { id, key } of keys) {
      if (!KEY_ID.test(id)) throw new Error("Key IDs may only contain letters, digits, _ and -");
      if (key.length !== 32) throw new Error("Keys must be 256 bits");
    }
    this.keys = new Map(keys.map(({ id, key }) => [id, key]));
    this.currentId = first.id;
    this.currentKey = first.key;
  }

  generateDataKey(): Promise<DataKey> {
    const plaintext = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.currentKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrapped = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    return Promise.resolve({ keyId: this.currentId, plaintext, wrapped });
  }

  unwrap(keyId: string, wrapped: Buffer): Promise<Buffer> {
    const kek = this.keys.get(keyId);
    if (!kek) return Promise.reject(new Error(`Unknown key ID "${keyId}"`));
    const decipher = createDecipheriv("aes-256-gcm", kek, wrapped.subarray(0, 12));
    decipher.setAuthTag(wrapped.subarray(12, 28));
    return Promise.resolve(
      Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]),
    );
  }
}

export interface VaultTransitOptions {
  /** e.g. https://vault.internal:8200 */
  address: string;
  token: string;
  mount: string;
  keyName: string;
}

interface TransitResponse {
  data?: { plaintext?: string; ciphertext?: string };
  errors?: string[];
}

/**
 * Production: the Transit secrets engine of HashiCorp Vault or OpenBao
 * (same API). Data keys are generated and unwrapped by the key service; the
 * key-encryption key never leaves it.
 */
export class VaultTransitKeyProvider implements KeyProvider {
  private readonly keyId: string;

  constructor(private readonly options: VaultTransitOptions) {
    this.keyId = `transit-${options.keyName}`;
    if (!KEY_ID.test(this.keyId))
      throw new Error("Transit key names may only contain letters, digits, _ and -");
  }

  private async call(path: string, body: object): Promise<NonNullable<TransitResponse["data"]>> {
    const response = await fetch(
      new URL(`/v1/${this.options.mount}/${path}`, this.options.address),
      {
        method: "POST",
        headers: { "X-Vault-Token": this.options.token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as TransitResponse;
    if (!response.ok || !payload.data) {
      // The key service's own messages never include key material.
      throw new Error(
        `Key service responded ${String(response.status)}${payload.errors?.length ? `: ${payload.errors.join("; ")}` : ""}`,
      );
    }
    return payload.data;
  }

  async generateDataKey(): Promise<DataKey> {
    const data = await this.call(`datakey/plaintext/${this.options.keyName}`, { bits: 256 });
    if (!data.plaintext || !data.ciphertext) throw new Error("Key service returned no data key");
    return {
      keyId: this.keyId,
      plaintext: Buffer.from(data.plaintext, "base64"),
      wrapped: Buffer.from(data.ciphertext, "utf8"),
    };
  }

  async unwrap(keyId: string, wrapped: Buffer): Promise<Buffer> {
    if (keyId !== this.keyId) throw new Error(`Unknown key ID "${keyId}"`);
    const data = await this.call(`decrypt/${this.options.keyName}`, {
      ciphertext: wrapped.toString("utf8"),
    });
    if (!data.plaintext) throw new Error("Key service returned no plaintext");
    return Buffer.from(data.plaintext, "base64");
  }
}
