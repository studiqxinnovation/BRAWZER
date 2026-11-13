# Phase 4 review

- **Date:** 2026-11-07
- **Scope:** milestones 4.1 to 4.4 on the `phase-4` branch ([plan](../plans/phase-4.md), [ADR 0011](../adr/0011-drive-encryption-and-scanning.md)).
  Persistent browser profiles and extensions, listed under Phase 4 in the original roadmap, depend on the cloud browser (Phase 3) and were not part of this phase.

## What exists

| Area                 | Real today                                                                                                                                                                                        | Not built yet                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Storage              | An S3-compatible object store (RustFS locally and in CI) holding only ciphertext: one random key per file, wrapped by the key service; chunked AES-256-GCM with every chunk authenticated         | A production store, chosen with hosting (Phase 7)                                            |
| Scanning             | ClamAV scans every upload as it streams; infected files are quarantined; an unreachable scanner refuses uploads                                                                                   | Signature updates in production (`freshclam`)                                                |
| Uploads              | From the person's own device: streamed, never buffered in full; content types sniffed from the bytes; duplicate names numbered; per-file, per-account and file-count limits under an account lock | Downloads and printed pages from the cloud browser; uploads to websites from Drive (Phase 3) |
| Organising           | Folders (nested, renamed, moved without cycles, deleted with everything inside), rename and move for files, search by name, storage meter                                                         | Sharing with other people (not planned)                                                      |
| Previews             | Images, PDFs and plain text, in the page, with headers that stop the content acting as a page                                                                                                     | Office documents, audio and video                                                            |
| Saving to a computer | A deliberate step: an explanation, a shared-computer warning, "confirm it's you", a single-use 60-second ticket, an entry in the security history                                                 | —                                                                                            |
| Account              | The data download lists Drive's paths, sizes, types and states; deleting the account removes every object                                                                                         | —                                                                                            |

The Drive page carries a development-state notice saying that downloads from
the cloud browser don't land there yet. Nothing appears to work that doesn't.

## How it was verified

| Check                                       | Result                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (six packages)                   | 328 passing, including the encrypted chunk format (round trip, tampering, truncation, reordering, cross-file swap), content sniffing, filename handling, download tickets, Drive's page helpers and the enum match between database and contracts                                                                                                                                           |
| API integration tests against real services | 123 passing in 13 suites: the Drive suite covers uploads (plaintext never reaches the store), type detection, numbered names, the EICAR test file, the per-file and per-account limits, folders and cycles, cascading deletion with object removal, search, previews and their headers, tickets (confirm it's you, single use, wrong file, garbage), the data download and account deletion |
| Browser tests (Chromium, desktop and phone) | 151 passing, 5 skipped by design. Drive's journey: folder, uploads, image and text previews, search, saving with the shared-computer warning and "confirm it's you" (the downloaded bytes match; the link works once), rename, move, folder deletion, quarantine, the oversize check and an unknown folder                                                                                  |
| Accessibility                               | WCAG 2.2 AA checks (axe) on the Drive page, its dialogs and the quarantine state, at both sizes                                                                                                                                                                                                                                                                                             |
| Production build                            | Builds cleanly                                                                                                                                                                                                                                                                                                                                                                              |
| Lint, formatting, type checks               | Clean                                                                                                                                                                                                                                                                                                                                                                                       |
| Dependency audit                            | No new advisories from the runtime dependencies added for Drive (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@fastify/multipart`, `file-type`); the three moderate ones from Phase 1 remain accepted until 2026-11-13                                                                                                                                                                    |

## Security review

Each new surface was threat-modelled, its code reviewed, and every control
below has a test.

### Threat model additions

| Surface          | Threat                                                                                 | Controls                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Object store     | A leaked bucket or credentials; a tampered object                                      | Ciphertext only; per-file keys wrapped by the key service and bound to the account and object; per-chunk authentication of index, file ID and end-of-file, verified before any byte is sent                                                                  |
| Uploads          | Malware stored and handed back; an unscanned file; memory exhaustion; a full Drive     | Scanned as it streams, quarantine on a hit, refusal when the scanner is down; nothing buffered beyond a chunk; limits enforced while streaming and again under an account lock, with the object removed on failure                                           |
| Content types    | An HTML or SVG file served from Brawzer's origin; a type lie in the file name          | Types sniffed from bytes (HTML and SVG become plain text); previews only for an allow-list; `nosniff`, `no-referrer`, `no-store` and a sandboxing CSP on every inline response                                                                               |
| File names       | Path traversal, header injection, direction-override tricks                            | One path segment; control and bidi characters removed; `Content-Disposition` with an ASCII fallback and RFC 8187 encoding; sanitised on upload, validated on rename                                                                                          |
| Saving           | A download link copied or left in a download manager; an unattended signed-in computer | Recent sign-in required; single-use 60-second tickets, stored hashed; the content URL takes the ticket, not the cookie; a ticket for one file can't fetch another and is burned by the attempt; recorded in the security history with a shared-computer flag |
| Folders          | Moving a folder into itself; another account's IDs                                     | Cycle check with a recursive query; every query scoped to the account, so foreign IDs are "not found"                                                                                                                                                        |
| Search           | LIKE wildcards or long patterns                                                        | Wildcards escaped; 100-character limit                                                                                                                                                                                                                       |
| Account deletion | Orphaned objects                                                                       | Keys listed from the store before deletion and removed after                                                                                                                                                                                                 |

### Findings

| #   | Finding                                                                                              | Severity        | Resolution                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A torn-down upload branch could surface as an uncaught stream error and crash the process            | High            | **Fixed.** Every branch's errors are routed through the pipeline's promises; the integration test for an oversized upload covers it |
| 2   | The UTF-8 check for "looks like text" accepted a short invalid sequence by trimming the sample's end | Low             | **Fixed.** Streaming decode: an unfinished character is held back, a malformed one is rejected                                      |
| 3   | A preview with a frame couldn't be closed with Escape while the frame had focus                      | Low (usability) | **Fixed.** Every preview has a Close button                                                                                         |
| 4   | PDF previews can't carry the `sandbox` directive (Chromium's viewer won't render)                    | Low             | **Accepted.** The viewer can't reach the embedding page; `nosniff` and a separate URL still apply                                   |
| 5   | ClamAV's default stream limit (25 MB) is below Drive's per-file limit                                | Medium          | **Fixed.** `StreamMaxLength` raised in both compose files and documented for production                                             |

### Remaining risks

- **No scanner catches everything.** Said on the site and where files are saved.
- **Orphaned objects** when the store fails after a record is deleted: logged, not retried; ciphertext without a key. A reconciliation job belongs to Phase 7.
- **Throughput.** Encryption and scanning happen in the API process. Fine for the temporary limits; measured again before plans raise them.
- **Range requests aren't supported** by the chunk format, so previews are whole-file only (no seeking in audio or video, which aren't previewable anyway).
- Carried over: public pages allow inline scripts; rate limits are per instance during a Redis outage; proxy tests run inside the API until Phase 5.

## Decisions needed from you

- **The production object store** (S3, R2 or another): chosen with hosting.
- **Limits once plans exist** (Phase 6): the temporary 100 MB / 2 GB / 2,000 files are placeholders.
