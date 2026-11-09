"use client";

import type { BrowserOverview, Profile, SavedTabs } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { History, Play } from "lucide-react";
import { type SubmitEvent, useEffect, useState } from "react";
import { Panel } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { hostOf } from "@/lib/browser/input";

/** The Select value for a session that belongs to no profile. */
const TEMPORARY = "temporary";

/** Before a session exists: choose a profile and start, with what to expect stated plainly. */
export function StartPanel({
  profiles,
  proxies,
  overview,
  starting,
  error,
  onStart,
}: {
  profiles: readonly Profile[];
  proxies: readonly { id: string; name: string; protocol: string }[];
  overview: BrowserOverview;
  starting: boolean;
  error: string | null;
  onStart: (profileId: string | null, resume?: boolean) => void;
}) {
  const [choice, setChoice] = useState<string>(profiles[0]?.id ?? TEMPORARY);
  // What the page loaded with, then fresh: a session may have ended since (ADR 0020).
  const [savedTabs, setSavedTabs] = useState<readonly SavedTabs[]>(overview.savedTabs);
  useEffect(() => {
    let cancelled = false;
    void fetchBrowserOverview().then((result) => {
      if (!cancelled && result.ok) setSavedTabs(result.data.savedTabs);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const profile = profiles.find((candidate) => candidate.id === choice) ?? null;
  const saved = savedTabs.find((entry) => entry.profileId === profile?.id) ?? null;
  const proxy = proxies.find((candidate) => candidate.id === profile?.proxyId) ?? null;
  const unavailable = overview.runtime === "unavailable";

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onStart(profile?.id ?? null);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8 sm:py-12">
      <div>
        <h1 className="text-title-1 text-balance text-ink">Browser</h1>
        <p className="mt-2 max-w-xl text-body text-pretty text-ink-secondary">
          Bee Browser, Brawzer’s own browser built on Chromium, or Firefox, runs in Brawzer’s cloud
          and appears here. Only the page’s pixels reach this computer; it never runs the websites
          you visit and keeps none of their data.
        </p>
      </div>

      <Panel className="p-6">
        <form method="post" onSubmit={submit} className="flex flex-col gap-5">
          <Select
            label="Profile"
            options={[
              ...profiles.map((candidate) => ({ value: candidate.id, label: candidate.name })),
              { value: TEMPORARY, label: "Temporary session (nothing kept)" },
            ]}
            value={choice}
            onValueChange={setChoice}
            disabled={starting}
          />
          <p className="text-footnote text-ink-tertiary">
            {profile?.keepData
              ? `Cookies, history and site data are saved to “${profile.name}”, encrypted, when the session ends, and are back next time.`
              : profile
                ? `“${profile.name}” keeps nothing between sessions; the session starts clean and leaves nothing behind.`
                : "The session starts clean and leaves nothing behind."}{" "}
            {proxy
              ? ` Websites see “${proxy.name}”: every connection goes through that proxy, and its password never leaves Brawzer’s servers.`
              : " Websites see Brawzer’s cloud; the profile has no proxy."}{" "}
            It ends when you end it, when you sign out, after {overview.limits.idleMinutes} minutes
            without anyone watching, or after {overview.limits.maxHours} hours. Downloads and
            printed pages go to Drive, scanned and encrypted.
          </p>
          {saved && profile && (
            <section
              aria-labelledby="continue-heading"
              className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
            >
              <div className="flex items-start gap-3">
                <History aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-ink" />
                <div className="min-w-0">
                  <h2 id="continue-heading" className="text-callout font-medium text-ink">
                    Continue where you left off
                  </h2>
                  <p className="text-footnote text-ink-secondary">
                    {saved.handedOff ? "Handed off" : "Left open"} <LocalDate iso={saved.savedAt} />{" "}
                    in “{profile.name}”:{" "}
                    {saved.tabs.length === 1 ? "1 tab" : `${String(saved.tabs.length)} tabs`}
                  </p>
                </div>
              </div>
              <ul aria-label="Tabs to reopen" className="flex flex-col gap-0.5 pl-8">
                {saved.tabs.slice(0, 4).map((tab, index) => (
                  <li
                    key={`${String(index)}:${tab.url}`}
                    className="truncate text-footnote text-ink"
                  >
                    {tab.title || hostOf(tab.url)}{" "}
                    <span className="text-ink-tertiary">· {hostOf(tab.url)}</span>
                  </li>
                ))}
                {saved.tabs.length > 4 && (
                  <li className="text-footnote text-ink-tertiary">
                    and {String(saved.tabs.length - 4)} more
                  </li>
                )}
              </ul>
              <div className="pl-8">
                <Button
                  type="button"
                  variant="secondary"
                  loading={starting}
                  disabled={unavailable}
                  onClick={() => {
                    onStart(profile.id, true);
                  }}
                >
                  {saved.tabs.length === 1
                    ? "Continue with 1 tab"
                    : `Continue with ${String(saved.tabs.length)} tabs`}
                </Button>
              </div>
            </section>
          )}
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
    </div>
  );
}
