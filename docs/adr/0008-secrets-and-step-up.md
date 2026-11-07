# 0008 Secrets at rest and recent sign-in

- **Status:** Accepted. Implemented in milestone 2.1.
- **Date:** 2026-11-07

## Context

Phase 2 stores secrets Brawzer must be able to read back: authenticator-app
(TOTP) secrets and proxy credentials. They can't be hashed like passwords. A
database leak, backup leak or SQL-injection bug must not reveal them, and
keys must be rotatable without downtime.

Separately, a stolen or forgotten-but-open session shouldn't be enough to
change how the account is protected (passkeys, two-factor, email address,
deleting the account, signing other devices out).

## Decision

**Envelope encryption** (`apps/api/src/crypto/`):

- Each secret is encrypted with its own random 256-bit data key (AES-256-GCM, random 96-bit IV).
- The data key is stored only wrapped by a key-encryption key, which Brawzer never holds in production.
- Every ciphertext is bound to its record through GCM's authenticated data (for example `totp:<user id>`). A value copied onto another row fails to decrypt.
- Stored format: `v1.<key id>.<wrapped data key>.<iv>.<ciphertext>.<tag>`. The key ID makes rotation possible: new secrets use the current key, older ones still open.

**Key providers:**

- `local`: key-encryption keys from `ENCRYPTION_KEYS`, for development only. The API refuses it in production.
- `vault`: the Transit engine of HashiCorp Vault or OpenBao (same API). Data keys are generated and unwrapped by the key service, and the key-encryption key never leaves it. Local development runs OpenBao in dev mode to test this path. Cloud KMS providers (AWS, Google, Azure) can be added behind the same interface when hosting is chosen.

**Recent sign-in ("step-up"):**

- Every session records how it signed in (`auth_method`) and when its owner last proved who they are (`reauthenticated_at`, set at sign-in).
- `RecentAuthGuard` refuses sensitive routes with `403 reauthentication_required` when that is more than 10 minutes old.
- `POST /auth/reauthenticate` (password; passkey from milestone 2.2) refreshes it. Wrong passwords are rate-limited like sign-in.
- The web app's `useConfirmedRequest` shows a "Confirm it's you" dialog on that error and retries the action once.
- From 2.1 it protects signing other devices out. Later milestones add passkeys, two-factor, email changes and account deletion.

## Consequences

- A database dump alone reveals no TOTP secret or proxy password.
- With Vault/OpenBao, each seal and open is one call to the key service. That's fine for Brawzer's volumes (a sign-in, a proxy test); a short-lived data-key cache can be added if profiling shows a need.
- Production needs a reachable key service with a token scoped to the Transit key (encrypt, decrypt, datakey only).
