import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * A profile's history key, split for its two uses (ADR 0020): one half
 * encrypts entries (AES-256-GCM, bound to their row), the other makes the
 * keyed digest that finds an address's row without storing the address.
 */
export interface HistoryKeys {
  encrypt: Buffer;
  digest: Buffer;
}

export function newHistoryKey(): Buffer {
  return randomBytes(32);
}

export function deriveHistoryKeys(master: Buffer): HistoryKeys {
  return {
    encrypt: Buffer.from(
      hkdfSync("sha256", master, Buffer.alloc(0), "brawzer history encrypt", 32),
    ),
    digest: Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "brawzer history digest", 32)),
  };
}

/** The digest of an address: the same address always gives the same one, for one profile only. */
export function urlDigest(keys: HistoryKeys, url: string): string {
  return createHmac("sha256", keys.digest).update(url, "utf8").digest("base64url");
}

/** iv (12) | ciphertext | tag (16), as base64url; `context` is authenticated, not stored. */
export function sealValue(keys: HistoryKeys, context: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.encrypt, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

export function openValue(keys: HistoryKeys, context: string, sealed: string): unknown {
  const bytes = Buffer.from(sealed, "base64url");
  if (bytes.length < 28) throw new Error("Not a sealed history value");
  const decipher = createDecipheriv("aes-256-gcm", keys.encrypt, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  const plain = Buffer.concat([
    decipher.update(bytes.subarray(12, bytes.length - 16)),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8")) as unknown;
}

/** What a tab may leave in history or saved tabs: a real page, not Brawzer's start page. */
export function isRecordable(url: string): boolean {
  if (url.length === 0 || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname !== "bee.invalid"
    );
  } catch {
    return false;
  }
}

/**
 * How many visits one stream may record in a window. A page (or an engine
 * gone wrong) can navigate as fast as it likes; the history doesn't follow.
 */
export class VisitBudget {
  private started: number;
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.started = now();
  }

  take(): boolean {
    const at = this.now();
    if (at - this.started >= this.windowMs) {
      this.started = at;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}
