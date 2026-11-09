# ADR 0020: History, bookmarks and open tabs as Brawzer's records

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR 0008](0008-secrets-and-step-up.md), [ADR 0013](0013-profile-data-and-drive-hand-off.md)

## Context

A profile's browsing data travels as an encrypted archive of the engine's
own data directory (ADR 0013). The engine's history and bookmarks are in
there, but nothing can read them: no history page, no search across
sessions, no deleting one page, and no way to pick up a session's tabs on
the next computer. History is also the most personal data Brawzer would
hold, so how it is kept matters more than what it enables.

## Decision

### Per profile, encrypted with the profile's own key

Each profile gets a history key on first use: 32 random bytes sealed by the
key service (ADR 0008), bound to the account and profile, re-wrapped by the
maintenance job like every sealed value. Two subkeys are derived from it:
one encrypts entries with AES-256-GCM, each bound to its row, the other
makes a keyed digest of an address. History (`profile_history`) has one
row per address, found by that digest, so a visit updates its row without
the address ever being stored in the clear. Bookmarks (`profile_bookmarks`)
are kept the same way. Searching decrypts the profile's rows in memory, at
most 5000 of them, on the person's own request. Unwrapped keys stay in
the API's memory for 10 minutes so a session's visits don't each ask the
key service.

### Recorded by the relay, only when the profile keeps its data

The stream relay already sees the agent's tab updates. It records a visit
when a tab has finished loading an `http` or `https` page without an error;
Brawzer's start page and every other scheme are never recorded. A temporary
session records nothing, and so does a profile that starts clean or whose
owner switched "Keep a searchable history" off. Pages not visited for 90
days are forgotten, as are a profile's oldest beyond 5000. Clearing a
profile's data clears its history and saved tabs too; bookmarks stay, as
in any browser.

### Nobody else reads it

The API gives history and bookmarks to the profile's owner only. They are
never in logs, metrics, the security history (which records that a history
was cleared, not what was in it) or the Admin page. The data download
includes them, decrypted, because they are the person's own.

### Open tabs, and continuing on another device

While a session that keeps its data runs, the relay keeps the profile's
open tabs current (at most 20, written at most every 2 seconds and on
close), encrypted with the same key. A session that never showed a page
doesn't replace what the last one left. The Browser page offers "Continue
where you left off" for a profile with saved tabs for 7 days; continuing
copies them into the new session, and the relay reopens them once, in their
order, when the agent first says hello (a locked row makes sure only one
stream takes them). "Continue on another device" ends the session on
purpose (end reason `handed_off`) and says so on the next device.

## Consequences

- Search is in memory per profile; at 5000 entries that's milliseconds,
  and a server-side index of plaintext addresses is never needed.
- A database copy without the key service holds no readable address,
  title or host.
- The engine's own history inside the archive still exists for the
  engine's sake (its address bar suggestions); Brawzer's records are what
  the person sees and controls.
