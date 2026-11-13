"use client";

import {
  type BrowserEngine,
  type BrowserSession,
  engineDetails,
  type Profile,
} from "@brawzer/contracts";
import { cn } from "@brawzer/ui/lib/cn";
import { type MouseEvent, useRef } from "react";
import { AppIconArt } from "@/components/browser/engine-logo";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import "@/components/browser/launcher.css";

const SPARKS = ["#3b82f6", "#a78bfa", "#34d399", "#fbbf24"] as const;
const stillness = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A ring that spreads from a tile as it's pressed. */
function ripple(tile: HTMLElement) {
  if (stillness()) return;
  const ring = document.createElement("span");
  ring.className = "hm-ripple";
  ring.setAttribute("aria-hidden", "true");
  tile.append(ring);
  setTimeout(() => {
    ring.remove();
  }, 560);
}

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
  const { opening, launch } = useLaunchBrowser();
  const lastSpark = useRef(0);
  const full = sessions.length >= limit;

  /** A few sparks where the pointer comes in: the dock noticing it. */
  function sparkle(event: MouseEvent<HTMLButtonElement>) {
    const now = Date.now();
    if (stillness() || now - lastSpark.current < 300) return;
    lastSpark.current = now;
    const tile = event.currentTarget.parentElement;
    if (!tile) return;
    const box = tile.getBoundingClientRect();
    for (let index = 0; index < 5; index += 1) {
      const spark = document.createElement("span");
      const angle = Math.random() * Math.PI * 2;
      const distance = 20 + Math.random() * 30;
      const size = 3 + Math.random() * 4;
      spark.className = "hm-spark";
      spark.setAttribute("aria-hidden", "true");
      spark.style.left = `${String(event.clientX - box.left)}px`;
      spark.style.top = `${String(event.clientY - box.top)}px`;
      spark.style.width = `${String(size)}px`;
      spark.style.height = `${String(size)}px`;
      spark.style.background = SPARKS[index % SPARKS.length] ?? SPARKS[0];
      spark.style.setProperty("--hm-x", `${String(Math.cos(angle) * distance)}px`);
      spark.style.setProperty("--hm-y", `${String(Math.sin(angle) * distance - 30)}px`);
      spark.style.animationDelay = `${String(index * 60)}ms`;
      tile.append(spark);
      setTimeout(
        () => {
          spark.remove();
        },
        800 + index * 60,
      );
    }
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
            className="bl-app hm-app hm-tile"
            data-launching={opening === engine || undefined}
            data-disabled={disabled || undefined}
          >
            <button
              type="button"
              className="bl-app-button"
              aria-label={running ? `Go back to ${details.short}` : `Open ${details.short}`}
              disabled={disabled}
              onMouseEnter={sparkle}
              onClick={(event) => {
                const tile = event.currentTarget.parentElement;
                if (tile) ripple(tile);
                void launch(engine, { profiles, sessions });
              }}
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
