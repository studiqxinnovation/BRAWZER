"use client";

import {
  type BrowserEngine,
  type BrowserSession,
  engineDetails,
  type Profile,
} from "@brawzer/contracts";
import { useToast } from "@brawzer/ui/components/toast";
import { cn } from "@brawzer/ui/lib/cn";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppIconArt } from "@/components/browser/engine-logo";
import { startBrowserSession } from "@/lib/api/browser";
import { defaultProfile, makeProfileFor } from "@/lib/browser/launch";
import { leaveSignedInArea } from "@/lib/session-channel";
import "@/components/browser/launcher.css";

/**
 * Home's row of browsers, as a dock: one click opens a browser with its
 * first free profile (as the Browser page's icons do), or goes back to it if
 * it's open already.
 */
export function HomeBrowsers({
  engines,
  profiles,
  sessions,
  limit,
  available,
}: {
  engines: readonly BrowserEngine[];
  profiles: readonly Profile[];
  sessions: readonly BrowserSession[];
  limit: number;
  available: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [opening, setOpening] = useState<BrowserEngine | null>(null);
  const busy = new Set(sessions.map((session) => session.profileId));
  const full = sessions.length >= limit;

  async function open(engine: BrowserEngine) {
    const running = sessions.find((session) => session.engine === engine);
    if (running) {
      router.push(`/app/browser?session=${running.id}` as Route);
      return;
    }
    setOpening(engine);
    let profile = defaultProfile(engine, profiles, busy);
    if (!profile) {
      const created = await makeProfileFor(engine, profiles);
      if (!created.ok) {
        setOpening(null);
        if (created.status === 401) leaveSignedInArea("expired");
        else
          toast.add({
            type: "error",
            title: "The profile wasn’t made",
            description: created.error.message,
          });
        return;
      }
      profile = created.data;
    }
    const started = await startBrowserSession({ profileId: profile.id });
    if (!started.ok) {
      setOpening(null);
      if (started.status === 401) leaveSignedInArea("expired");
      else
        toast.add({
          type: "error",
          title: `${engineDetails[engine].short} couldn’t open`,
          description: started.error.message,
        });
      return;
    }
    router.push(`/app/browser?session=${started.data.id}` as Route);
  }

  return (
    <ul aria-label="Your browsers" className="hm-dock" data-opening={opening ?? undefined}>
      {engines.map((engine) => {
        const details = engineDetails[engine];
        const running = sessions.some((session) => session.engine === engine);
        const disabled = !available || opening !== null || (full && !running);
        const status =
          opening === engine
            ? "Opening…"
            : running
              ? "Open now"
              : !available
                ? "Unavailable"
                : full
                  ? "End one first"
                  : "Ready";
        return (
          <li
            key={engine}
            className="bl-app hm-app"
            data-launching={opening === engine || undefined}
          >
            <button
              type="button"
              className="bl-app-button"
              aria-label={running ? `Go back to ${details.short}` : `Open ${details.short}`}
              disabled={disabled}
              onClick={() => void open(engine)}
            >
              <AppIconArt engine={engine} />
              <span className="bl-label">{details.short}</span>
            </button>
            <span
              className={cn(
                "hm-status",
                running ? "hm-status-open" : status === "Ready" ? "hm-status-ready" : "",
              )}
            >
              {status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
