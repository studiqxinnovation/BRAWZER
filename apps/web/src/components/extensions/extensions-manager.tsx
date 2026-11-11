"use client";

import { EXTENSION_CATALOGUE, engineDetails, type Profile } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Select } from "@brawzer/ui/components/select";
import { Switch } from "@brawzer/ui/components/switch";
import { useToast } from "@brawzer/ui/components/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/app-shell/page";
import { Tile } from "@/components/desktop/apps/registry";
import { useDesktop } from "@/components/desktop/desktop-context";
import type { GlyphName, TileColour } from "@/components/desktop/glyphs";
import { updateProfile } from "@/lib/api/profiles";
import { leaveSignedInArea } from "@/lib/session-channel";

/** Each extension's tile, as the prototype colours them. */
const TILES: readonly (readonly [GlyphName, TileColour])[] = [
  ["block", "red"],
  ["moon", "indigo"],
  ["shield", "orange"],
  ["key", "blue"],
  ["translate", "teal"],
  ["pen", "green"],
];

/**
 * Extensions, as the prototype's: a card for each, with a switch that
 * installs it into the chosen profile's browser from its next session.
 */
export function ExtensionsManager({ profiles }: { profiles: readonly Profile[] }) {
  const router = useRouter();
  const toast = useToast();
  const desktop = useDesktop();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [pending, setPending] = useState<string | null>(null);
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
  const enabled = profile?.extensions.length ?? 0;

  async function toggle(slug: string, on: boolean) {
    if (!profile) return;
    const next = on
      ? [...profile.extensions.filter((entry) => entry !== slug), slug]
      : profile.extensions.filter((entry) => entry !== slug);
    setPending(slug);
    const result = await updateProfile(profile.id, { extensions: next });
    setPending(null);
    if (result.ok) {
      toast.add({
        type: "success",
        title: on
          ? `Installs into “${profile.name}” from its next session`
          : `Removed from “${profile.name}”`,
      });
      router.refresh();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({ type: "error", title: "Couldn’t save that", description: result.error.message });
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Profile"
            options={profiles.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            value={profileId}
            onValueChange={setProfileId}
            className="w-56"
          />
          {profile && (
            <p className="pb-2 text-footnote text-ink-secondary">
              {String(enabled)} of {String(EXTENSION_CATALOGUE.length)} enabled ·{" "}
              {engineDetails[profile.engine].name} · changes apply when its next session starts
            </p>
          )}
        </div>
        {desktop && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              desktop.openApp("web-store");
            }}
          >
            Get extensions
          </Button>
        )}
      </div>
      <ul aria-label="Extension catalogue" className="ad-grid" data-cols={3}>
        {EXTENSION_CATALOGUE.map((entry, index) => {
          // Chrome runs the same builds as Bee: both are Chromium.
          const build = profile ? entry[profile.engine === "firefox" ? "firefox" : "bee"] : null;
          const installed = profile?.extensions.includes(entry.slug) ?? false;
          const [glyph, colour] = TILES[index % TILES.length] ?? ["block", "gray"];
          return (
            <li key={entry.slug} className="flex">
              <Card className="ad-ext w-full">
                <div className="ad-ext-head">
                  <Tile glyph={glyph} colour={colour} size={38} />
                  <div className="ad-li-main">
                    <p className="ad-li-title">{entry.name}</p>
                    <p className="ad-li-sub">
                      {installed ? "Enabled" : "Disabled"}
                      {build ? ` · ${build.version}` : ""} · {entry.licence}
                    </p>
                  </div>
                </div>
                <p className="ad-ext-desc">
                  {entry.summary}{" "}
                  <a
                    href={entry.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-ink underline underline-offset-2"
                  >
                    Source
                  </a>
                  {profile && !build && (
                    <>
                      {" "}
                      Not available on {engineDetails[profile.engine].name}; a Firefox profile can
                      use it.
                    </>
                  )}
                </p>
                <div className="ad-ext-foot">
                  <span>
                    {[entry.bee && "Bee Browser and Chrome", entry.firefox && "Firefox"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Switch
                    aria-label={`${entry.name} in ${profile?.name ?? "the profile"}`}
                    checked={installed}
                    disabled={!profile || !build || pending === entry.slug}
                    onCheckedChange={(on) => void toggle(entry.slug, on)}
                  />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
