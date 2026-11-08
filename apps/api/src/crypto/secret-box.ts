import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyProvider } from "./key-providers.js";

const VERSION = "v1";

const encode = (value: Buffer) => value.toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url");

/**
 * Envelope encryption for secrets stored in the database (TOTP secrets,
 * proxy credentials). Every secret gets its own random AES-256-GCM data key,
 * wrapped by the key provider. `context` is authenticated but not stored:
 * pass something unique to the record (e.g. "totp:<user id>"), so a sealed
 * value copied onto another record can't be opened.
 *
 * Format: v1.<key id>.<wrapped data key>.<iv>.<ciphertext>.<tag>
 */
export class SecretBox {
  constructor(private readonly keys: KeyProvider) {}

  async seal(plaintext: string, context: string): Promise<string> {
    const dataKey = await this.keys.generateDataKey();
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", dataKey.plaintext, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [
        VERSION,
        dataKey.keyId,
        encode(dataKey.wrapped),
        encode(iv),
        encode(ciphertext),
        encode(cipher.getAuthTag()),
      ].join(".");
    } finally {
      dataKey.plaintext.fill(0);
    }
  }

  async open(sealed: string, context: string): Promise<string> {
    const parts = sealed.split(".");
    const [version, keyId, wrapped, iv, ciphertext, tag] = parts;
    if (
      parts.length !== 6 ||
      version !== VERSION ||
      !keyId ||
      !wrapped ||
      !iv ||
      !ciphertext ||
      !tag
    ) {
      throw new Error("Not a sealed secret");
    }
    const dataKey = await this.keys.unwrap(keyId, decode(wrapped));
    try {
      const decipher = createDecipheriv("aes-256-gcm", dataKey, decode(iv));
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(decode(tag));
      return Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString(
        "utf8",
      );
    } finally {
      dataKey.fill(0);
    }
  }

  /** The key that wrapped a sealed value, for rotation reports. */
  static keyIdOf(sealed: string): string | undefined {
    return sealed.split(".")[1];
  }

  /**
   * After a key rotation: the same secret, its data key wrapped by the
   * current key. Only the wrapping changes; the ciphertext, and so the
   * context it is bound to, stay as they were. Null when nothing is to do.
   */
  async rewrap(sealed: string): Promise<string | null> {
    const parts = sealed.split(".");
    const [version, keyId, wrapped, iv, ciphertext, tag] = parts;
    if (
      parts.length !== 6 ||
      version !== VERSION ||
      !keyId ||
      !wrapped ||
      !iv ||
      !ciphertext ||
      !tag
    ) {
      throw new Error("Not a sealed secret");
    }
    if (await this.keys.isCurrent(keyId, decode(wrapped))) return null;
    const fresh = await this.keys.rewrap(keyId, decode(wrapped));
    return [VERSION, fresh.keyId, encode(fresh.wrapped), iv, ciphertext, tag].join(".");
  }
}
