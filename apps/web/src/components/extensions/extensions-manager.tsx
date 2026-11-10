"use client";

import { EXTENSION_CATALOGUE, engineDetails, type Profile } from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { Select } from "@brawzer/ui/components/select";
import { Switch } from "@brawzer/ui/components/switch";
import { useToast } from "@brawzer/ui/components/toast";
import { Puzzle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Panel } from "@/components/app-shell/page";
import { updateProfile } from "@/lib/api/profiles";
import { leaveSignedInArea } from "@/lib/session-channel";

/** The catalogue with a switch per profile: what the next session of that profile installs. */
export function ExtensionsManager({ profiles }: { profiles: readonly Profile[] }) {
  const router = useRouter();
  const toast = useToast();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [pending, setPending] = useState<string | null>(null);
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;

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
    <div className="flex flex-col gap-6">
      <Panel className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between">
        <Select
          label="Profile"
          options={profiles.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          value={profileId}
          onValueChange={setProfileId}
          className="sm:max-w-xs"
        />
        {profile && (
          <p className="text-footnote text-ink-secondary">
            {engineDetails[profile.engine].name} · changes apply when its next session starts.
          </p>
        )}
      </Panel>
      <ul aria-label="Extension catalogue" className="flex flex-col gap-3">
        {EXTENSION_CATALOGUE.map((entry) => {
          const build = profile ? entry[profile.engine] : null;
          const installed = profile?.extensions.includes(entry.slug) ?? false;
          return (
            <li key={entry.slug}>
              <Panel className="flex items-start gap-4 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-secondary">
                  <Puzzle aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-callout font-medium text-ink">
                    {entry.name}
                    {build && <Badge tone="neutral">{build.version}</Badge>}
                    <Badge tone="neutral">{entry.licence}</Badge>
                  </p>
                  <p className="mt-1 text-footnote text-ink-secondary">{entry.summary}</p>
                  <p className="mt-1 text-caption text-ink-tertiary">
                    Runs on{" "}
                    {[entry.bee && "Bee Browser", entry.firefox && "Firefox"]
                      .filter(Boolean)
                      .join(" and ")}
                    .{" "}
                    <a
                      href={entry.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-ink underline underline-offset-2"
                    >
                      Source
                    </a>
                  </p>
                  {profile && !build && (
                    <p className="mt-1 text-caption text-ink-tertiary">
                      Not available on {engineDetails[profile.engine].name}; a Firefox profile can
                      use it.
                    </p>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-footnote text-ink-secondary">
                  {/* Named in the server's markup: a wrapping label names it only once script runs. */}
                  <Switch
                    aria-label={`${entry.name} in ${profile?.name ?? "the profile"}`}
                    checked={installed}
                    disabled={!profile || !build || pending === entry.slug}
                    onCheckedChange={(on) => void toggle(entry.slug, on)}
                  />
                </label>
              </Panel>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
