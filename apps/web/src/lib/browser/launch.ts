import { type BrowserEngine, engineDetails, type Profile, profileColors } from "@brawzer/contracts";
import { createProfile } from "@/lib/api/profiles";

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
