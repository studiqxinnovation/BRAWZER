"use client";

import { engineDetails } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Camera } from "lucide-react";
import { useEffect, useState } from "react";
import { EngineLogo } from "@/components/browser/engine-logo";
import { useDesktop } from "@/components/desktop/desktop-context";
import { fetchBrowserOverview } from "@/lib/api/browser";
import type { BrowserSession } from "@brawzer/contracts";
import { useAppWindow } from "./app-window";

/**
 * Screenshot: a picture of a cloud browser's page, as drawn on this
 * computer, saved to Drive as a PNG. The cloud browser never takes one.
 */
export default function ScreenshotApp() {
  const desktop = useDesktop();
  const window = useAppWindow();
  const [sessions, setSessions] = useState<readonly BrowserSession[] | null>(null);
  useEffect(() => {
    void fetchBrowserOverview().then((result) => {
      setSessions(result.ok ? result.data.sessions : []);
    });
  }, []);

  return (
    <div className="ap-body">
      <div className="ap-main">
        <p className="ap-note">
          Saves the page a browser is showing to Drive, as a PNG. Photos shows it afterwards.
        </p>
        {sessions?.length === 0 ? (
          <div className="ap-empty">
            <Camera aria-hidden="true" className="size-8" />
            <p>Open a browser first; its page is what gets saved.</p>
          </div>
        ) : (
          <ul className="ap-store-list">
            {sessions?.map((session) => (
              <li key={session.id} className="ap-store-item">
                <EngineLogo engine={session.engine} size="md" />
                <span className="ap-list-main">
                  <b>{engineDetails[session.engine].short}</b>
                  <span>Its page, as it is now</span>
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    // Its window has to be open to draw the page: bring it forward, then take it.
                    desktop?.openSession(session);
                    setTimeout(() => {
                      desktop?.screenshot(session.id);
                    }, 600);
                  }}
                >
                  <Camera aria-hidden="true" />
                  Take screenshot
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.openApp("photos");
            }}
          >
            Open Photos
          </Button>
        </div>
      </div>
    </div>
  );
}
