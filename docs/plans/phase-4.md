# Phase 4 plan: Brawzer Drive

- **Status:** Built 2026-11-07 (milestones 4.1–4.5; see the [review](../reviews/phase-4.md)). Accepted under the standing instruction to build every phase; decisions taken as recommended (table at the end).
- **Date:** 2026-11-07
- **Builds on:** Phase 2 ([review](../reviews/phase-2.md)); Phase 3 is unfinished (no cloud browser yet, see [its plan](phase-3.md)).

## Goal

Files that stay with the account, never with the computer: stored encrypted
in Brawzer's cloud, scanned for malware, organised in folders, previewed
without downloading, and saved to a computer only as a deliberate, confirmed
act. Everything the cloud browser will need later (a place to put downloads,
a file picker for uploads to websites) exists and is tested before the browser
does.

## What Phase 4 delivers

- **Upload from your own device.** Until the cloud browser exists, this is how files reach Drive, and it stays useful afterwards: carry a document to a shared computer without a USB stick, then open it in the cloud browser.
- **Encryption at rest, per file.** Each file has its own key, wrapped by the key service (ADR 0008); the object store only ever sees ciphertext.
- **Malware scanning** of every upload with ClamAV. Infected files are quarantined: kept, visible and deletable, never downloadable.
- **Folders, rename, move, search, storage usage** with temporary limits until plans exist (Phase 6).
- **Previews** in the browser for safe types only (images, PDF, plain text), served so that a file can't run as a page.
- **Save to this computer** as a deliberate act: confirm it's you, a single-use 60-second download ticket, a warning on shared-computer sessions, and an entry in the security history.
- **Deletion** removes the object at once; deleting the account removes every file; the data download lists files (metadata only).

## Boundaries: what Phase 4 does not do

- **No downloads from the cloud browser, no uploads to websites from Drive, no printing to Drive.** They need the runtime (Phase 3). _Built on 2026-11-08 as milestone 3.7 ([plan](phase-3-files-and-profiles.md))._
- **No persistent browser profiles** (cookies and history kept between sessions). _Built on 2026-11-08 as milestone 3.8._
- **No sharing** of files with other people. Drive is private to the account.
- **No plans or paid storage.** Temporary limits apply: 100 MB per file, 2 GB and 2,000 files per account.

## Architecture

```
browser ──upload (multipart)──> API ──scan (clamd INSTREAM)──> ClamAV
                                 │ encrypt in 1 MiB AES-256-GCM chunks
                                 └──PutObject (multipart)──> S3-compatible bucket
browser <──preview / download (decrypted stream)── API <──GetObject──┘
```

1. **Storage.** One private bucket, objects at `drive/<userId>/<fileId>`. The API is the only client; credentials are server-side configuration. Locally and in CI, RustFS (an S3-compatible server) runs in Docker; production uses any S3-compatible store (AWS S3, Cloudflare R2), chosen with hosting.
2. **Encryption (ADR 0011).** A random 256-bit key per file, wrapped by the key provider and stored with the file record. Content is encrypted in 1 MiB chunks with AES-256-GCM; the chunk index, the total number of chunks and the file ID are authenticated, so chunks can't be dropped, reordered or swapped between files. Downloads verify each chunk before sending it.
3. **Scanning.** The upload streams to ClamAV and to the bucket at the same time. The verdict decides the file's state: `clean`, or `infected` (quarantined). If the scanner can't be reached, the upload is refused with a clear message rather than stored unscanned.
4. **Content types** are sniffed from the bytes, never taken from the client. Previews are allowed only for a short list of safe types and are served with `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`. Everything else is download-only.
5. **Downloads** need a recent sign-in. `POST /drive/files/:id/download-ticket` returns a single-use ticket valid for 60 seconds; `GET /drive/files/:id/content?ticket=…` streams the file. Tickets, not cookies, so a copied link dies quickly and download managers never see the session.
6. **Limits** are enforced while streaming (the upload stops at the per-file limit) and under an account lock (the account total), like profiles and proxies.

## Milestones

### 4.1 Foundations: storage, encryption, scanning

- ADR 0011 (encrypted objects and scanning).
- RustFS and ClamAV in `infra/compose`; configuration (`STORAGE_*`, `CLAMAV_*`) with production rules (https endpoint, everything set); health checks include both.
- Object store client (AWS SDK v3), chunked encryption streams, clamd client.
- **Tests:** unit (chunk format round trip, tampering, truncation, reordering, cross-file swap), integration (real RustFS and ClamAV, including the EICAR test file).

### 4.2 Files and folders

- Tables `drive_folders` and `drive_files`; security events `drive.*`.
- API: upload (streaming multipart), list, rename, move, delete, folders, search, usage; limits; quarantine; account deletion removes objects; data download lists files.
- **Tests:** integration for every route, limits under concurrency, quarantine, deletion.

### 4.3 Previews and saving to a computer

- Preview endpoint for safe types; download tickets behind "confirm it's you"; headers; security history entries.
- **Tests:** integration (safe and unsafe types, ticket single use and expiry, headers) and unit (filename and type handling).

### 4.4 The Drive page

- Files and folders, upload with progress, rename, move, delete with confirmation, search, storage meter, previews, "Save to this computer" with the shared-computer warning, quarantine notices, and a development state about the cloud browser.
- **Tests:** browser tests (upload, preview, save, delete) and accessibility checks.

### 4.5 Phase 4 review

Security review (upload handling, type confusion, encryption format, scanner bypass, ticket abuse, quotas), `docs/reviews/phase-4.md`.

## Decisions

| #   | Decision                             | Taken as                                                                                 |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | How files reach Drive before Phase 3 | Uploads from the person's own device, from the Drive page                                |
| 2   | Object store                         | Any S3-compatible store in production; RustFS locally and in CI                          |
| 3   | Encryption                           | Per-file keys wrapped by the key service; chunked AES-256-GCM (ADR 0011)                 |
| 4   | Scanner                              | ClamAV, required: an unreachable scanner refuses uploads                                 |
| 5   | Infected files                       | Quarantined (kept, visible, deletable, never downloadable), not silently dropped         |
| 6   | Temporary limits                     | 100 MB per file; 2 GB and 2,000 files per account                                        |
| 7   | Previews                             | Images, PDF and plain text only, sandboxed; everything else download-only                |
| 8   | Saving to a computer                 | Recent sign-in, single-use 60-second ticket, warning on shared-computer sessions, logged |
| 9   | Deletion                             | Immediate, consistent with account deletion                                              |

## Risks

- **No scanner catches everything.** The site already says so; Drive repeats it where files are saved to a computer.
- **S3 compatibility.** Tested against RustFS locally; the production store must be tested in staging before launch.
- **Large uploads.** Everything streams; nothing is buffered in full. Memory is bounded by the chunk size and the SDK's part size.
- **Format changes.** The chunk format carries a version byte, so a future change can read old files.
