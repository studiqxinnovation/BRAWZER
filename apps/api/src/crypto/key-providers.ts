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
  /** Whether a wrapped data key still uses the current key-encryption key (and version). */
  isCurrent(keyId: string, wrapped: Buffer): Promise<boolean>;
  /** The same data key, wrapped by the current key-encryption key (and version). */
  rewrap(keyId: string, wrapped: Buffer): Promise<{ keyId: string; wrapped: Buffer }>;
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

  isCurrent(keyId: string): Promise<boolean> {
    return Promise.resolve(keyId === this.currentId);
  }

  async rewrap(keyId: string, wrapped: Buffer): Promise<{ keyId: string; wrapped: Buffer }> {
    const plaintext = await this.unwrap(keyId, wrapped);
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.currentKey, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        keyId: this.currentId,
        wrapped: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      };
    } finally {
      plaintext.fill(0);
    }
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
  data?: { plaintext?: string; ciphertext?: string; latest_version?: number };
  errors?: string[];
}

/** Transit ciphertexts carry the key version they were made with: `vault:v<N>:…`. */
function transitVersionOf(wrapped: Buffer): number | null {
  const match = /^vault:v(\d+):/.exec(wrapped.toString("utf8"));
  return match ? Number(match[1]) : null;
}

/**
 * Production: the Transit secrets engine of HashiCorp Vault or OpenBao
 * (same API). Data keys are generated and unwrapped by the key service; the
 * key-encryption key never leaves it.
 */
export class VaultTransitKeyProvider implements KeyProvider {
  private readonly keyId: string;
  /** The key's latest version, asked for at most once a minute. */
  private latest: { version: number; at: number } | null = null;

  constructor(private readonly options: VaultTransitOptions) {
    this.keyId = `transit-${options.keyName}`;
    if (!KEY_ID.test(this.keyId))
      throw new Error("Transit key names may only contain letters, digits, _ and -");
  }

  private async call(
    path: string,
    body: object | null,
  ): Promise<NonNullable<TransitResponse["data"]>> {
    const response = await fetch(
      new URL(`/v1/${this.options.mount}/${path}`, this.options.address),
      {
        method: body ? "POST" : "GET",
        headers: { "X-Vault-Token": this.options.token, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
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

  private async latestVersion(): Promise<number> {
    if (this.latest && Date.now() - this.latest.at < 60_000) return this.latest.version;
    const data = await this.call(`keys/${this.options.keyName}`, null);
    if (typeof data.latest_version !== "number") throw new Error("Key service named no version");
    this.latest = { version: data.latest_version, at: Date.now() };
    return data.latest_version;
  }

  async isCurrent(keyId: string, wrapped: Buffer): Promise<boolean> {
    if (keyId !== this.keyId) return false;
    const version = transitVersionOf(wrapped);
    return version !== null && version >= (await this.latestVersion());
  }

  /** The key service re-wraps under its latest version; the data key never leaves it. */
  async rewrap(keyId: string, wrapped: Buffer): Promise<{ keyId: string; wrapped: Buffer }> {
    if (keyId !== this.keyId) throw new Error(`Unknown key ID "${keyId}"`);
    const data = await this.call(`rewrap/${this.options.keyName}`, {
      ciphertext: wrapped.toString("utf8"),
    });
    if (!data.ciphertext) throw new Error("Key service returned no ciphertext");
    return { keyId: this.keyId, wrapped: Buffer.from(data.ciphertext, "utf8") };
  }
}
