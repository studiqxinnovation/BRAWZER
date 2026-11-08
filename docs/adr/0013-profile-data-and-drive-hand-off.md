# ADR 0013: Profile data between sessions, and files between the cloud browser and Drive

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0011](0011-drive-encryption-and-scanning.md) (encrypted objects), [ADR 0012](0012-cloud-browser-runtime-isolation.md) (runtime isolation)

## Context

Phase 3a destroyed the container with everything in it and refused downloads
and uploads. The product promises the opposite: profiles with their own
cookies and history, downloads that land in Drive, and websites fed from
Drive rather than from the computer in front of the person. Both need bytes
to cross the container boundary, which ADR 0012 kept closed on purpose.

## Decision

### One channel, both directions, no new reach

Files cross the boundary only over the agent's existing WebSocket to the
relay, as ordered binary chunks (`T` messages, 256 KiB each, authenticated by
the session secret like everything else on that connection). The container
gains no credentials, no object store access and no new network path. The
relay, which already runs inside the API with the session's identity, is
where Drive and the object store are touched.

- **Out of the container:** the engine writes a download (or a printed page) into the scratch tmpfs; when complete, the agent streams it to the relay, which stores it as an upload into the account's `Downloads` folder: scanned by ClamAV and encrypted with the file's own key as it arrives, like any Drive upload. Nothing is kept in the container afterwards. The page is told the result (saved, quarantined, too large, failed).
- **Into the container:** when a page opens a file chooser, the agent tells the page, Brawzer shows its Drive picker, and the relay streams the chosen files (clean ones only, resolved under the account) to the agent, which writes them to the scratch tmpfs and gives their paths to the input. The page's own file chooser never opens, so nothing on the local computer is reachable.

### Profile data as an encrypted archive

A profile's browsing data is Chromium's user data directory, less what should
never survive a session (HTTP cache, which lives outside the directory; code
and GPU caches; locks; crash reports). When a session under a profile ends
cleanly, the agent closes the engine (so its databases are flushed), packs
the directory with `tar` and streams it to the API; the API encrypts it with
ADR 0011's chunk format, with a fresh random key per archive, wrapped by the
key service and bound to the account and the object, and stores it in the
object store under `profiles/<account>/<object>`. The next session under that
profile receives the decrypted archive before the engine starts and unpacks
it in place. The API sees the archive pass through; it never inspects it.

Limits: 256 MiB compressed per profile; over it, the previous archive stays
and the new one is dropped with a logged warning. A profile can be set to
keep nothing (every session starts clean), and its data can be cleared on
request; deleting the profile or the account removes the object.

Chromium's own cookie encryption uses the basic password store inside the
container, so the archive opens in any container; the confidentiality comes
from Brawzer's encryption, not Chromium's.

## Consequences

- The relay holds a download in memory while Drive takes it, bounded by Drive's per-file limit. Fine for one API instance in development; a production relay would stream through a bounded queue.
- A download that completes while nobody is watching waits in the container for the next viewer and is lost if the session ends first. Acceptable for now; a later version can hand over without a viewer.
- Chromium doesn't report script-driven title changes in its new headless mode, so the agent re-reads the active tab's title while someone watches. Cheap, and it also made the chooser observable in tests.
- The archive is untrusted by `tar` only in the sense that it is Brawzer's own, authenticated ciphertext; `tar` runs as the unprivileged container user inside the scratch tmpfs with `--no-same-owner`.
- Profile data takes space in the object store that plans (Phase 6) will have to count.
