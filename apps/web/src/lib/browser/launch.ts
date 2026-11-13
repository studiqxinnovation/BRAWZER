import {
  type BrowserEngine,
  engineDetails,
  type Profile,
  profileColors,
  type WebApp,
} from "@brawzer/contracts";
import type { ApiResult } from "@/lib/api/client";
import { createProfile, updateProfile } from "@/lib/api/profiles";

/** What clicking a browser's icon opens: its first profile not open now, or a new one. */
export function defaultProfile(
  engine: BrowserEngine,
  profiles: readonly Profile[],
  busy: ReadonlySet<string | null>,
): Profile | null {
  return profiles.find((profile) => profile.engine === engine && !busy.has(profile.id)) ?? null;
}

/**
 * Makes a profile of its own for a browser: named after it ("Chrome", then
 * "Chrome 2"), in a colour no other profile uses yet.
 */
export function makeProfileFor(engine: BrowserEngine, profiles: readonly Profile[]) {
  const short = engineDetails[engine].short;
  const taken = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  let name: string = short;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${short} ${String(n)}`;
  const used = new Set(profiles.map((profile) => profile.color));
  const color = profileColors.find((candidate) => !used.has(candidate)) ?? "indigo";
  return createProfile({ name, color, engine });
}

/**
 * The profile a web app runs in: one named after it on this engine, made
 * the first time and set to keep its data, so the app stays signed in
 * between visits (in Brawzer's cloud, never on this computer). Names are
 * one per account, so when the plain name is taken by a profile on another
 * browser, this one carries the browser's name ("WhatsApp (Chrome)").
 */
export async function profileForWebApp(
  engine: BrowserEngine,
  app: WebApp,
  profiles: readonly Profile[],
): Promise<ApiResult<Profile>> {
  const short = engineDetails[engine].short;
  const wanted = [app.name, `${app.name} (${short})`].map((name) => name.toLowerCase());
  const existing = profiles.find(
    (profile) => profile.engine === engine && wanted.includes(profile.name.toLowerCase()),
  );
  if (existing) return { ok: true, status: 200, data: existing };
  const taken = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  let name = app.name;
  if (taken.has(name.toLowerCase())) name = `${app.name} (${short})`;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1)
    name = `${app.name} (${short}) ${String(n)}`;
  const used = new Set(profiles.map((profile) => profile.color));
  const color = profileColors.find((candidate) => !used.has(candidate)) ?? "indigo";
  const created = await createProfile({ name, color, engine });
  if (!created.ok) return created;
  const kept = await updateProfile(created.data.id, { keepData: true });
  return kept.ok ? kept : created;
}
