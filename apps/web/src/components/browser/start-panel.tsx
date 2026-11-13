"use client";

import type { BrowserOverview, Profile } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { DevState } from "@brawzer/ui/components/dev-state";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { Play } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { Panel } from "@/components/app-shell/page";

/** Before a session exists: choose a profile and start, with what to expect stated plainly. */
export function StartPanel({
  profiles,
  overview,
  starting,
  error,
  onStart,
}: {
  profiles: readonly Profile[];
  overview: BrowserOverview;
  starting: boolean;
  error: string | null;
  onStart: (profileId: string | null) => void;
}) {
  const [profileId, setProfileId] = useState<string>(profiles[0]?.id ?? "");
  const unavailable = overview.runtime === "unavailable";

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onStart(profileId || null);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <h1 className="text-title-1 text-balance text-ink">Browser</h1>
        <p className="mt-2 max-w-xl text-body text-pretty text-ink-secondary">
          A real Chromium that runs in Brawzer’s cloud and appears here. Only the page’s pixels
          reach this computer; it never runs the websites you visit and keeps none of their data.
        </p>
      </div>

      <Panel className="p-6">
        <form method="post" onSubmit={submit} className="flex flex-col gap-5">
          <Select
            label="Profile"
            options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
            value={profileId}
            onValueChange={setProfileId}
            disabled={profiles.length === 0 || starting}
          />
          <p className="text-footnote text-ink-tertiary">
            The session ends when you end it, when you sign out, after {overview.limits.idleMinutes}{" "}
            minutes without anyone watching, or after {overview.limits.maxHours} hours. Nothing is
            kept between sessions yet.
          </p>
          {unavailable && (
            <FormMessage tone="danger" title="The cloud browser isn’t available right now">
              The service that starts browsers can’t be reached. Try again in a moment.
            </FormMessage>
          )}
          {error && (
            <FormMessage tone="danger" title="The browser couldn’t start">
              {error}
            </FormMessage>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={starting}
              disabled={unavailable}
            >
              <Play aria-hidden="true" />
              Start browsing
            </Button>
          </div>
        </form>
      </Panel>

      <DevState
        title="Some things aren’t in the cloud browser yet"
        milestone="Phases 3b to 5"
        requires={[
          "Sound, and Firefox (WebRTC streaming, Phase 3b)",
          "Downloads saved to Drive and uploads picked from it",
          "Cookies and history kept between sessions (persistent profiles)",
          "Browsing through your saved proxies (Phase 5)",
        ]}
      >
        Today: one Chromium per session, your tabs and address bar drawn by Brawzer, pages streamed
        as pixels, private addresses blocked, and downloads, uploads, printing, camera, microphone
        and location refused.
      </DevState>
    </div>
  );
}
