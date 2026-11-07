import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";

/**
 * A software WebAuthn authenticator for API tests: it creates real P-256 key
 * pairs and produces genuine registration ("none" attestation) and
 * authentication responses, so the server's verification runs for real.
 */

// ── Minimal CBOR encoder (only what WebAuthn needs) ────────────────────────
function header(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  if (length < 65_536) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(length, 1);
  return out;
}

type CborValue = number | string | Buffer | Map<number | string, CborValue>;

function cbor(value: CborValue): Buffer {
  if (typeof value === "number") return value >= 0 ? header(0, value) : header(1, -1 - value);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([header(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([header(2, value.length), value]);
  const parts: Buffer[] = [header(5, value.size)];
  for (const [key, entry] of value) parts.push(cbor(key), cbor(entry));
  return Buffer.concat(parts);
}

const b64url = (value: Buffer) => value.toString("base64url");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest();

export interface SoftAuthenticatorOptions {
  rpId: string;
  origin: string;
  /** "platform" (built into the device) or "cross-platform" (phone, security key). */
  attachment?: "platform" | "cross-platform";
  /** Synced passkey (backup eligible and backed up). */
  synced?: boolean;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private counter = 0;
  userHandle: string | undefined;

  constructor(private readonly options: SoftAuthenticatorOptions) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private flags(attested: boolean): number {
    // User present (0x01) and verified (0x04); attested credential data (0x40);
    // backup eligible (0x08) and backed up (0x10) for synced passkeys.
    return 0x01 | 0x04 | (attested ? 0x40 : 0) | (this.options.synced ? 0x18 : 0);
  }

  private clientData(
    type: "webauthn.create" | "webauthn.get",
    challenge: string,
    origin?: string,
  ): Buffer {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: origin ?? this.options.origin,
        crossOrigin: false,
      }),
    );
  }

  /** Answers navigator.credentials.create() options with a new passkey. */
  register(
    options: Record<string, unknown>,
    overrides: { origin?: string } = {},
  ): Record<string, unknown> {
    const challenge = options.challenge as string;
    const user = options.user as { id: string } | undefined;
    this.userHandle = user?.id;

    const jwk = this.publicKey.export({ format: "jwk" });
    const coseKey = new Map<number, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? "", "base64url")],
      [-3, Buffer.from(jwk.y ?? "", "base64url")],
    ]);
    const signCount = Buffer.alloc(4);
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.options.rpId),
      Buffer.from([this.flags(true)]),
      signCount,
      Buffer.alloc(16), // AAGUID: unknown model
      credentialIdLength,
      this.credentialId,
      cbor(coseKey),
    ]);
    const attestationObject = cbor(
      new Map<string, CborValue>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      authenticatorAttachment: this.options.attachment ?? "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", challenge, overrides.origin)),
        attestationObject: b64url(attestationObject),
        transports: this.options.attachment === "cross-platform" ? ["hybrid"] : ["internal"],
      },
    };
  }

  /** Answers navigator.credentials.get() options by signing the challenge. */
  authenticate(
    options: Record<string, unknown>,
    overrides: { origin?: string } = {},
  ): Record<string, unknown> {
    const challenge = options.challenge as string;
    this.counter += 1;
    const signCount = Buffer.alloc(4);
    signCount.writeUInt32BE(this.counter);
    const authData = Buffer.concat([
      sha256(this.options.rpId),
      Buffer.from([this.flags(false)]),
      signCount,
    ]);
    const clientDataJSON = this.clientData("webauthn.get", challenge, overrides.origin);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      authenticatorAttachment: this.options.attachment ?? "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(this.userHandle ? { userHandle: this.userHandle } : {}),
      },
    };
  }

  /** Pretends to be a cloned authenticator by replaying an old signature counter. */
  rewindCounter(): void {
    this.counter = 0;
  }
}
