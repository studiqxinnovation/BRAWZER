# ADR 0011: Drive files: encrypted objects and malware scanning

- **Status:** Accepted (milestone 4.1)
- **Date:** 2026-11-07

## Context

Brawzer Drive holds people's files in an S3-compatible object store. The
store is operated by a hosting provider, backed up by them, and reachable by
anyone who gets its credentials. Files also arrive from untrusted places (the
web, and later the cloud browser), so some will be malicious.

## Decision

### The object store sees only ciphertext

Every file gets its own random 256-bit key. The key is wrapped by the key
provider (ADR 0008: the local provider in development, Vault/OpenBao Transit
in production) with the context `drive-file:<userId>:<fileId>`, and the
wrapped key is stored on the file's row. A leaked bucket therefore reveals
object sizes and nothing else, and a leaked database row can't be used
without the key service.

### Chunked AES-256-GCM, so downloads verify before they send

Content is encrypted in 1 MiB chunks (`apps/api/src/storage/encrypted-chunks.ts`):

- **Header (9 bytes):** a version byte (`1`) and an 8-byte random nonce prefix.
- **Chunk nonce:** the prefix plus the chunk index (32-bit, big-endian).
- **Authenticated data per chunk:** `brawzer-drive`, the version, the file ID, the chunk index, and whether this is the last chunk. A chunk can't be moved to another position, another file, or presented as the end of a file.
- **Layout:** every chunk but the last holds exactly 1 MiB of ciphertext plus a 16-byte tag; the last holds 1 byte to 1 MiB (or 0 bytes for an empty file). The reader knows a full-size chunk isn't the last one because more bytes follow it, so no lengths are stored.

A single GCM stream over a whole file would hand out plaintext before its tag
is checked; with chunks, each megabyte is verified before it leaves the API.
Truncating a file fails (the final chunk was authenticated as not-last),
reordering fails (the index), and swapping files fails (the file ID). The
version byte lets a later format read old files.

### Every upload is scanned, and the scanner is required

Uploads stream to ClamAV (`clamd`, `INSTREAM` over TCP) and to the object
store at the same time. The verdict decides the file's state: `clean`, or
`infected` (quarantined: kept, visible and deletable, never downloadable or
previewable). If the scanner can't be reached, the upload is refused with a
clear message rather than stored unscanned, because "scanned" is a promise
the product makes.

Scanning lowers the risk; it doesn't remove it. The site says so, and Drive
repeats it where a file is saved to a computer.

### Types from bytes, previews only for safe types

A file's type is sniffed from its first bytes, never taken from the client.
Only images, PDFs and plain text can be previewed, and previews are served
with `X-Content-Type-Options: nosniff` and a sandboxing
`Content-Security-Policy`, so a file never runs as a page on Brawzer's origin.
Everything else is download-only, as an attachment with a sanitised filename.

### Saving to a computer takes a ticket

A download needs a recent sign-in ("confirm it's you") and returns a
single-use ticket valid for 60 seconds; the content URL takes the ticket, not
the session cookie, so a copied link dies quickly and download managers never
hold the session.

## Consequences

- Encrypting in the API costs CPU per byte; it's the price of a store that can't read the files. Throughput is measured in the Phase 4 review.
- Range requests (seeking in a video) aren't supported in this format: a chunk must be decrypted whole. Previews are limited to whole-file types anyway.
- Key rotation: re-wrapping a file's key means a database update per file, not re-encrypting content, because the data key is wrapped by the key service.
- Locally and in CI, RustFS stands in for the production store, and ClamAV runs with its bundled signatures (no network); production must keep signatures updated.
