"use client";

import {
  type BrowserEngine,
  type BrowserSession,
  engineDetails,
  type Profile,
} from "@brawzer/contracts";
import { useToast } from "@brawzer/ui/components/toast";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchBrowserOverview, startBrowserSession } from "@/lib/api/browser";
import { fetchProfiles } from "@/lib/api/profiles";
import { leaveSignedInArea } from "@/lib/session-channel";
import { defaultProfile, makeProfileFor } from "./launch";

/**
 * Opening a browser in one step, as a desktop's dock does: back to it if
 * it's open already, else with its first free profile (one named after it is
 * made the first time), then on to the session. What's open and the
 * profiles are read fresh unless the caller has them.
 */
export function useLaunchBrowser() {
  const router = useRouter();
  const toast = useToast();
  const [opening, setOpening] = useState<BrowserEngine | null>(null);

  function failed(status: number, title: string, description: string) {
    setOpening(null);
    if (status === 401) leaveSignedInArea("expired");
    else toast.add({ type: "error", title, description });
  }

  async function launch(
    engine: BrowserEngine,
    known?: { profiles: readonly Profile[]; sessions: readonly BrowserSession[] },
  ) {
    const short = engineDetails[engine].short;
    setOpening(engine);
    let profiles = known?.profiles;
    let sessions = known?.sessions;
    if (!profiles || !sessions) {
      const [overview, list] = await Promise.all([fetchBrowserOverview(), fetchProfiles()]);
      if (!overview.ok) {
        failed(overview.status, `${short} couldn’t open`, overview.error.message);
        return;
      }
      if (!list.ok) {
        failed(list.status, `${short} couldn’t open`, list.error.message);
        return;
      }
      profiles = list.data.profiles;
      sessions = overview.data.sessions;
    }
    const running = sessions.find((session) => session.engine === engine);
    if (running) {
      router.push(`/app/browser?session=${running.id}` as Route);
      return;
    }
    let profile = defaultProfile(engine, profiles, new Set(sessions.map((s) => s.profileId)));
    if (!profile) {
      const created = await makeProfileFor(engine, profiles);
      if (!created.ok) {
        failed(created.status, "The profile wasn’t made", created.error.message);
        return;
      }
      profile = created.data;
    }
    const started = await startBrowserSession({ profileId: profile.id });
    if (!started.ok) {
      failed(started.status, `${short} couldn’t open`, started.error.message);
      return;
    }
    router.push(`/app/browser?session=${started.data.id}` as Route);
  }

  return { opening, launch };
}
