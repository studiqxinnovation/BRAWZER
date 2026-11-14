"use client";

import {
  type BrowserEngine,
  type BrowserSession,
  engineDetails,
  type Profile,
  type WebApp,
} from "@brawzer/contracts";
import { useToast } from "@brawzer/ui/components/toast";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchBrowserOverview, startBrowserSession } from "@/lib/api/browser";
import { engineScale } from "@/lib/browser/input";
import { fetchProfiles } from "@/lib/api/profiles";
import { profileForWebApp } from "./launch";
import { type BrowserOpen, useDesktop } from "@/components/desktop/desktop-context";
import { desktopActive } from "@/lib/desktop";
import { readDesktopPrefs } from "@/lib/desktop-prefs";
import { examAllows } from "@/lib/exam";
import { leaveSignedInArea } from "@/lib/session-channel";
import { defaultProfile, makeProfileFor } from "./launch";

/**
 * Opening a browser in one step, as a desktop's dock does: back to it if
 * it's open already, else with its first free profile (one named after it is
 * made the first time), then on to the session. What's open and the
 * profiles are read fresh unless the caller has them.
 */
/** What "Start Browsing" opens: the browser chosen in Launch settings, else Bee Browser. */
export function startEngine(engines: readonly BrowserEngine[]): BrowserEngine {
  const chosen = readDesktopPrefs().defaultEngine;
  if (chosen && engines.includes(chosen)) return chosen;
  return engines.includes("bee") ? "bee" : (engines[0] ?? "bee");
}

/**
 * Launches under way, by profile, engine or web app. Starting a browser takes
 * a few seconds, and a second click on its icon in that time (a double-click,
 * as on any desktop) used to run a second launch that found the session still
 * starting and opened its window too early. The second click now does nothing:
 * the first one opens the window when the browser is running.
 */
const launching = new Set<string>();

export function useLaunchBrowser(
  options: {
    /**
     * How to show the session once it's running. The desktop itself passes its
     * window opener: it renders the desktop context, so it can't read it.
     */
    show?: (session: BrowserSession, open?: BrowserOpen) => void;
  } = {},
) {
  const router = useRouter();
  const toast = useToast();
  const desktop = useDesktop();
  const [opening, setOpening] = useState<BrowserEngine | null>(null);

  /** On the desktop, a window of its own; elsewhere, the Browser page. */
  function show(session: BrowserSession, open?: BrowserOpen) {
    if (options.show) {
      options.show(session, open);
      setOpening(null);
      return;
    }
    if (desktop && desktopActive()) {
      desktop.openSession(session, open);
      setOpening(null);
      return;
    }
    router.push(`/app/browser?session=${session.id}` as Route);
  }

  function failed(status: number, title: string, description: string) {
    setOpening(null);
    if (status === 401) leaveSignedInArea("expired");
    else toast.add({ type: "error", title, description });
  }

  /**
   * Opens the browser, or goes back to it if it's open. `open`: a site or the
   * browser's own page to show there (on the desktop); `profileId`: this
   * profile rather than the browser's first free one.
   */
  async function launch(
    engine: BrowserEngine,
    known?: { profiles: readonly Profile[]; sessions: readonly BrowserSession[] },
    options: { open?: BrowserOpen; profileId?: string } = {},
  ) {
    const key = options.profileId ?? engine;
    if (launching.has(key)) return;
    launching.add(key);
    try {
      await launchOnce(engine, known, options);
    } finally {
      launching.delete(key);
    }
  }

  async function launchOnce(
    engine: BrowserEngine,
    known?: { profiles: readonly Profile[]; sessions: readonly BrowserSession[] },
    options: { open?: BrowserOpen; profileId?: string } = {},
  ) {
    const short = engineDetails[engine].short;
    if (!examAllows(`browser:${engine}`)) {
      toast.add({
        type: "info",
        title: `${short} is off during Exam Mode`,
        description: "Only the apps and browsers you chose open until its time is up.",
      });
      return;
    }
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
    const running = sessions.find((session) =>
      options.profileId ? session.profileId === options.profileId : session.engine === engine,
    );
    if (running) {
      show(running, options.open);
      return;
    }
    let profile = options.profileId
      ? profiles.find((candidate) => candidate.id === options.profileId)
      : defaultProfile(engine, profiles, new Set(sessions.map((s) => s.profileId)));
    if (!profile) {
      const created = await makeProfileFor(engine, profiles);
      if (!created.ok) {
        failed(created.status, "The profile wasn’t made", created.error.message);
        return;
      }
      profile = created.data;
    }
    const started = await startBrowserSession({
      profileId: profile.id,
      scale: engineScale(window.devicePixelRatio),
    });
    if (!started.ok) {
      failed(started.status, `${short} couldn’t open`, started.error.message);
      return;
    }
    show(started.data, options.open);
  }

  /**
   * Opens a web app as an app: in a browser profile of its own, named after
   * it, that keeps its sign-in, drawn as a window with no tabs or address
   * bar. Back to it if it's open.
   */
  async function launchWebApp(engine: BrowserEngine, app: WebApp) {
    const key = `app:${app.id}`;
    if (launching.has(key)) return;
    launching.add(key);
    try {
      await launchWebAppOnce(engine, app);
    } finally {
      launching.delete(key);
    }
  }

  async function launchWebAppOnce(engine: BrowserEngine, app: WebApp) {
    setOpening(engine);
    const [overview, list] = await Promise.all([fetchBrowserOverview(), fetchProfiles()]);
    if (!overview.ok) {
      failed(overview.status, `${app.name} couldn’t open`, overview.error.message);
      return;
    }
    if (!list.ok) {
      failed(list.status, `${app.name} couldn’t open`, list.error.message);
      return;
    }
    // A site that only lets one browser in by name gets that browser, when the computer has it.
    const chosen = app.engine && overview.data.engines.includes(app.engine) ? app.engine : engine;
    const profile = await profileForWebApp(chosen, app, list.data.profiles);
    if (!profile.ok) {
      failed(profile.status, `${app.name} couldn’t open`, profile.error.message);
      return;
    }
    const profiles = list.data.profiles.some((candidate) => candidate.id === profile.data.id)
      ? list.data.profiles
      : [...list.data.profiles, profile.data];
    await launch(
      chosen,
      { profiles, sessions: overview.data.sessions },
      { open: { url: app.url, app: app.id }, profileId: profile.data.id },
    );
  }

  return { opening, launch, launchWebApp };
}
