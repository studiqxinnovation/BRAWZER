# 0009 Passkeys and two-factor authentication

- **Status:** Accepted. Passkeys implemented in milestone 2.2, two-factor authentication in 2.3.
- **Date:** 2026-11-07

## Context

Brawzer is used on computers people don't own, where a keylogger can record
anything typed. The safest sign-in there involves no typing at all. Passkeys
(WebAuthn) are phishing-resistant, need no shared secret on the server, and
can be used from a phone held near the computer (the "hybrid" transport).

## Decision: passkeys

- **Library:** SimpleWebAuthn on the server (verification) and in the browser (ceremonies).
- **Discoverable credentials and user verification required.** You can sign in without typing your email, and the authenticator always checks it's you (Face ID, fingerprint, PIN).
- **Only public keys are stored** (`webauthn_credentials`), with the signature counter, transports, synced or device-bound type, and the owner's label.
- **Random user handle.** Each account gets a random 32-byte WebAuthn handle, so passkeys never contain the email address or database ID.
- **Domain binding.** The RP ID is `WEB_ORIGIN`'s host name unless `WEBAUTHN_RP_ID` names a parent domain. Accepted origins are the allowed origins under that domain; IP addresses never qualify. Changing the production domain after launch would orphan existing passkeys.
- **Challenges** live in `auth_challenges`, are single use, expire after 5 minutes, and are bound to the session that requested them. A challenge issued to confirm identity can't be used to sign in.
- **Signature counters** are checked, so a cloned device-bound authenticator is refused. Synced passkeys report 0 and are exempt, as the standard intends.
- **Shared computers.**
  - In shared-computer sessions, registration asks only for cross-platform authenticators (phone, security key).
  - The server also refuses a response reporting `authenticatorAttachment: "platform"`.
  - A passkey saved in a library PC's Windows Hello would stay with that PC's shared Windows account.
- **Adding and removing passkeys** needs a recent sign-in (ADR 0008), and sends an email.
- **Passkey sign-in counts as two factors.** The device proves possession and its user verification proves the person, so no second step follows.
- **Confirming it's you** works with a passkey as well as the password.

## Decision: two-factor authentication

For accounts that still sign in with a password:

- **Authenticator-app codes** (TOTP, RFC 6238: 30-second steps, 6 digits, SHA-1) via otplib.
- **Encrypted secrets.** Secrets are sealed with envelope encryption (ADR 0008). The setup QR code is drawn on the server as an SVG and shown in an image element, never inlined as HTML.
- **Setup:** setup is finished by entering a first code. Turning on, turning off and creating new recovery codes all need a recent sign-in and send an email.
- **No replays.** One step either side is accepted for clock drift, and the last accepted step is stored, so a code can't be used twice (an atomic update guards concurrent requests).
- **Recovery codes.** Ten single-use codes of about 50 bits each are stored as SHA-256 hashes and shown once, with no download, since downloads stay on shared computers. Using one sends an email that says how many are left.
- **Sign-in.** A correct password on a two-factor account returns a ticket instead of a session.
  - The ticket is single use, valid for 5 minutes, and stored as a hash.
  - `POST /api/v1/auth/mfa/verify` exchanges it and a code for a session.
  - Five wrong codes burn the ticket. Per-address and per-account limits also apply.
- **Confirming it's you** with the password also needs a current code. Recovery codes aren't spent on that.
- **No self-service bypass.** Someone who loses both their authenticator and their recovery codes can't remove two-factor themselves, since that would undo it. A support-verified recovery process is a pre-launch task.

## Consequences

- People can sign in on any computer without typing a password, through the browser's own passkey dialog, which offers "use a phone or tablet" where the computer has Bluetooth.
- Computers without Bluetooth can't use the phone option. Milestone 2.7 adds a QR approval flow for them.
- The API is tested with a software authenticator producing real signatures (wrong origin, replayed challenge, cloned counter, someone else's passkey, the shared-computer rule). The browser flows are tested with Chromium's virtual authenticator.
