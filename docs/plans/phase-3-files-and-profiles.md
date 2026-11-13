# Phase 3 plan, continued: files through Drive and profiles that keep their data

- **Status:** Accepted 2026-11-08 under the standing instruction to build every phase; decisions taken as recommended (table at the end).
- **Progress:** Built 2026-11-08: 3.7 (downloads, printed pages and file choosers through Drive), 3.8 (profiles keep their browsing data), 3.9 (review, appended to [the Phase 3 review](../reviews/phase-3.md)). Design in [ADR 0013](../adr/0013-profile-data-and-drive-hand-off.md).
- **Date:** 2026-11-08
- **Builds on:** Phase 3a ([plan](phase-3.md), [review](../reviews/phase-3.md)), Phase 4 ([plan](phase-4.md), [ADR 0011](../adr/0011-drive-encryption-and-scanning.md)).

## Goal

Close the two promises the Browser, Drive and Profiles pages were still
labelling as unbuilt. Files a page produces in the cloud browser go to Drive
and nowhere else; files a page asks for come from Drive and nowhere else; and
a profile is a browser of its own, with the cookies, history and sign-ins it
had last time, kept encrypted in Brawzer's cloud.

## What this delivers

- **Downloads go to Drive.** The engine saves a download into the container's scratch space and the agent hands it to the relay, which stores it as an upload (scanned by ClamAV, encrypted with its own key, ADR 0011) in a `Downloads` folder at the top level of Drive. The Browser page shows progress and the result (saved, quarantined, too large, failed) with a link to Drive. Drive marks the file as coming from the cloud browser.
- **Printing produces a PDF in Drive**, from Brawzer's toolbar or Alt+P, by the same path.
- **A page's file chooser is answered from Drive.** Brawzer shows its own picker (folders, search, several files when the page allows it); only clean files can be given. The relay streams the chosen files to the agent, which hands them to the page's input.
- **Profiles keep their browsing data.** When a session under a profile ends (on request, idle, maximum age or sign-out), the engine is closed cleanly and its profile directory archived, encrypted with the profile's own key (ADR 0011's format, the profile as the authenticated object) and stored in the object store. The next session under that profile restores it before the engine starts. Each profile can be set to start clean instead, and its data can be cleared at any time. Deleting a profile or the account deletes the data.
- **Temporary sessions** belong to no profile and keep nothing.

## Boundaries

- **No history or bookmarks of Brawzer's own.** The engine's history lives inside the profile data; Brawzer doesn't yet read or show it.
- **Profile data has a size limit** (256 MiB compressed). Over it, the previous data is kept and the new one dropped, with a warning in the API log. Caches are never kept (the HTTP cache lives outside the profile directory).
- **One container's worth of trust.** The archive is made and unpacked by `tar` inside the container; the API only encrypts, stores and decrypts it. The archive is authenticated end to end, so a tampered object fails to decrypt rather than unpack.
- **Transfers wait for a viewer.** A download that completes while nobody watches is handed over when the next viewer connects; if the session ends first, it is lost with the container.
- **No streaming upload back-pressure to the engine.** The relay buffers a download in memory while Drive scans and encrypts it, bounded by Drive's per-file limit (100 MB in development).

## Milestones

### 3.7 Files through Drive

- Protocol: `transfer` and `file-chooser` messages, `T` binary chunks; the relay's own form of the chooser answer.
- Agent: downloads allowed into scratch space (`Browser.setDownloadBehavior allowAndName`), per-file limit enforced in the engine, printed pages via `Page.printToPDF`, file choosers answered with `DOM.setFileInputFiles`; titles re-read while watched, because the engine doesn't report script-driven title changes.
- API: the relay stores transfers through `DriveService.upload` (source `browser`), ensures the `Downloads` folder, opens clean files for choosers; security history entries `browser.file_saved` and `browser.file_sent`.
- Web: toasts with a Drive link, the Drive picker, the print button and shortcut, the Drive page's badge; the development-state notices on the Browser and Drive pages updated.
- Tests: protocol round trips; integration tests through real containers for a download, a printed page, an over-limit download, and a chooser given a clean and a quarantined file; the browser journey covers the download, the PDF and the picker.

### 3.8 Profiles keep their data

- Agent: starts the engine on request (`POST /start`) after an optional restore (`PUT /profile`), and archives the profile on request (`POST /pack`) after closing the engine cleanly; caches, locks and crash dumps excluded.
- API: `ProfileDataService` (encrypt, store, open, clear, remove), the orchestrator's restore-start-pack sequence, `BrowserService` saving on every clean end, `keepData` on profiles, `DELETE /profiles/:id/data`, data in the profile list and the export, removed with the profile and the account; `profile.data_cleared` in the history.
- Web: the start panel's temporary-session choice and honest copy, the profile editor's "Keep browsing data between sessions" switch, "Clear data" with confirmation, data size and date in the list, the session-over message.
- Tests: an integration test that sets a cookie in one session and finds it in the next under the same profile, not in a temporary session, and not after clearing or turning keeping off; the profiles journey toggles the switch.

### 3.9 Review

Security review of the new paths (what crosses the container boundary and in which direction, scanning, size limits, who can read profile data), appended to the Phase 3 review.

## Decisions

| #   | Decision                               | Taken as                                                                                                                                                                        |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Where downloads land                   | A `Downloads` folder at the top level of the account's Drive, created on first use; the person can move files afterwards                                                        |
| 2   | Scanning of cloud browser downloads    | The same path as uploads: scanned and encrypted as they stream in; an infected download is quarantined, not dropped, so the person sees what the page tried to give them        |
| 3   | How files cross the container boundary | Over the existing agent connection as ordered chunks, in both directions; no credentials or network reach are added to the container                                            |
| 4   | What a profile keeps                   | Chromium's user data directory minus caches, locks and crash data; the HTTP cache is kept outside it. Bookmarks and history as Brawzer-owned records came in Phase 8 (ADR 0020) |
| 5   | Encryption of profile data             | ADR 0011's chunk format with the profile's object as the authenticated id, one random key per saved archive, wrapped by the key service and bound to the account and object     |
| 6   | Default for new and existing profiles  | Keep data (the product's promise); a switch per profile starts sessions clean, and a temporary session belongs to no profile                                                    |
| 7   | Oversized profile data                 | 256 MiB compressed at most; over it the previous archive is kept, the new one dropped and the failure logged, so a runaway site can't fill the store or lose what was there     |
| 8   | When data is saved                     | On every end except account deletion and runtime failure; the engine is closed cleanly first so its databases are consistent                                                    |
