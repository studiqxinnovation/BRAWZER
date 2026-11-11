"use client";

import { type BrowserSession, engineDetails } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { useEffect, useState } from "react";
import { EngineLogo } from "@/components/browser/engine-logo";
import { useDesktop } from "@/components/desktop/desktop-context";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { useAppWindow } from "./app-window";
import { Tile } from "./registry";

/**
 * Screenshot, as the prototype lays it out: three ways to take one, then
 * where they go. What Brawzer can picture is a cloud browser's page, as
 * drawn on this computer; it's saved to Drive as a PNG and Photos shows it.
 */
export default function ScreenshotApp() {
  const desktop = useDesktop();
  const window = useAppWindow();
  const [sessions, setSessions] = useState<readonly BrowserSession[] | null>(null);
  const [counting, setCounting] = useState<number | null>(null);
  useEffect(() => {
    void fetchBrowserOverview().then((result) => {
      setSessions(result.ok ? result.data.sessions : []);
    });
  }, []);

  const take = (session: BrowserSession) => {
    // Its window has to be open to draw the page: bring it forward, then take it.
    desktop?.openSession(session);
    setTimeout(() => {
      desktop?.screenshot(session.id);
    }, 600);
  };
  const front = sessions?.[0];
  const later = () => {
    if (!front) return;
    setCounting(3);
    let left = 3;
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setCounting(left);
        return;
      }
      clearInterval(timer);
      setCounting(null);
      take(front);
    }, 1000);
  };

  return (
    <div className="ap-body">
      <div className="ap-ss-body">
        <div className="ap-ss-modes">
          <button
            type="button"
            className="ap-ss-mode"
            disabled={!front}
            onClick={() => front && take(front)}
          >
            <Tile glyph="globe" colour="purple" size={34} />
            <b>Browser page</b>
            <span>The page in front</span>
          </button>
          <button
            type="button"
            className="ap-ss-mode"
            disabled={!front || counting !== null}
            onClick={later}
          >
            <Tile glyph="clock" colour="orange" size={34} />
            <b>{counting === null ? "In 3 seconds" : `In ${String(counting)}…`}</b>
            <span>Time to set things up</span>
          </button>
          <button
            type="button"
            className="ap-ss-mode"
            onClick={() => {
              window.openApp("photos");
            }}
          >
            <Tile glyph="image" colour="blue" size={34} />
            <b>Open Photos</b>
            <span>See the ones you took</span>
          </button>
        </div>
        <div className="ap-ss-drop">
          {sessions?.length === 0 ? (
            <p>Open a browser first; its page is what gets saved.</p>
          ) : (
            <ul className="ap-ss-list" aria-label="Open browsers">
              {sessions?.map((session) => (
                <li key={session.id}>
                  <EngineLogo engine={session.engine} size="md" />
                  <span className="flex-1">{engineDetails[session.engine].short}</span>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      take(session);
                    }}
                  >
                    Take screenshot
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="ap-hint">Screenshots are saved to Drive, as PNGs.</p>
        </div>
      </div>
    </div>
  );
}
