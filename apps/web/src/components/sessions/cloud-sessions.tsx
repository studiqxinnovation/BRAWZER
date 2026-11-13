"use client";

import { type BrowserSession, engineDetails } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Card, Pill } from "@/components/app-shell/page";
import { EngineLogo } from "@/components/browser/engine-logo";
import { endBrowserSession, fetchBrowserOverview } from "@/lib/api/browser";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { subscribeToClock } from "@/lib/clock";

const two = (value: number) => String(value).padStart(2, "0");
const elapsed = (since: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours > 0 ? `${two(hours)}:` : ""}${two(minutes)}:${two(seconds % 60)}`;
};
const everySecond = (changed: () => void) => {
  const timer = setInterval(changed, 1000);
  return () => {
    clearInterval(timer);
  };
};

/**
 * The cloud browsers running now, as the prototype's Sessions shows them:
 * each with how long it has run and an End button, or "No session running"
 * with a way to start one. Each runs in its own container and is wiped
 * when it ends.
 */
export function CloudSessions() {
  const toast = useToast();
  const router = useRouter();
  const { launch, opening } = useLaunchBrowser();
  const [sessions, setSessions] = useState<readonly BrowserSession[] | null>(null);
  const [limit, setLimit] = useState(3);
  const [ending, setEnding] = useState<string | null>(null);
  const now = useSyncExternalStore(
    everySecond,
    () => Date.now(),
    () => 0,
  );
  // Subscribed to the clock so the elapsed time ticks; the clock itself just signals.
  useSyncExternalStore(
    subscribeToClock,
    () => 0,
    () => 0,
  );

  const load = () =>
    fetchBrowserOverview().then((result) => {
      if (result.ok) {
        setSessions(result.data.sessions);
        setLimit(result.data.limits.liveSessions);
      } else {
        setSessions([]);
      }
    });
  useEffect(() => {
    void load();
  }, []);

  async function end(session: BrowserSession) {
    setEnding(session.id);
    const result = await endBrowserSession(session.id);
    setEnding(null);
    if (result.ok || result.status === 404) {
      toast.add({ type: "success", title: `${engineDetails[session.engine].short} ended` });
      await load();
      router.refresh();
    } else {
      toast.add({ type: "error", title: "Couldn’t end it", description: result.error.message });
    }
  }

  if (sessions === null) return <Card className="min-h-20" aria-busy="true" />;
  if (sessions.length === 0) {
    return (
      <Card className="ad-sess-none">
        <div className="ad-li-main">
          <p className="ad-li-title">No session running</p>
          <p className="ad-li-sub">Launch a browser to start an isolated session.</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          loading={opening !== null}
          onClick={() => void launch("bee")}
        >
          Start Bee Browser
        </Button>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-[10px]">
      {sessions.map((session) => (
        <Card key={session.id} className="ad-sess-live">
          <EngineLogo engine={session.engine} size="md" />
          <div className="ad-li-main">
            <p className="ad-li-title">
              {engineDetails[session.engine].short} <span className="ad-live">Running</span>
            </p>
            <p className="ad-li-sub">
              Started{" "}
              {new Date(session.startedAt ?? session.createdAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · in its own container · {String(sessions.length)} of {String(limit)} running
            </p>
          </div>
          <div className="text-right">
            <p className="ad-stat-big tabular-nums">
              {now ? elapsed(session.startedAt ?? session.createdAt, now) : "…"}
            </p>
            <p className="ad-li-sub">elapsed</p>
          </div>
          <Button
            variant="danger"
            size="sm"
            loading={ending === session.id}
            onClick={() => void end(session)}
          >
            End
          </Button>
        </Card>
      ))}
      {sessions.length > 0 && (
        <p className="text-right">
          <Pill tone="grey">Each ends after {String(limit)} idle minutes</Pill>
        </p>
      )}
    </div>
  );
}

/** The page head's "End all sessions": every cloud browser running now. */
export function EndAllSessionsButton() {
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="danger"
      size="sm"
      loading={pending}
      onClick={() => {
        setPending(true);
        void fetchBrowserOverview().then(async (overview) => {
          const sessions = overview.ok ? overview.data.sessions : [];
          const results = await Promise.all(
            sessions.map((session) => endBrowserSession(session.id)),
          );
          setPending(false);
          const ended = results.filter((result) => result.ok || result.status === 404).length;
          toast.add({
            type: "success",
            title:
              ended === 0
                ? "No sessions were running"
                : `Ended ${String(ended)} session${ended === 1 ? "" : "s"}`,
          });
          router.refresh();
        });
      }}
    >
      End all sessions
    </Button>
  );
}
