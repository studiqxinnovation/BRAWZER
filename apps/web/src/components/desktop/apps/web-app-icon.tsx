"use client";

import { cn } from "@brawzer/ui/lib/cn";
import { useEffect, useRef, useState } from "react";
import type { WebApp } from "./web-apps";

/** Where the API serves a web app's own icon, fetched from its site. */
/** Bumped when the API picks icons differently, so a browser's day-long cache of the old ones lets go. */
const ICON_VERSION = "2";

export const webAppIconUrl = (id: string) =>
  `/api/v1/web-apps/${encodeURIComponent(id)}/icon?v=${ICON_VERSION}`;

/*
 * Icons load a few at a time, and only once a tile is on screen. A browser
 * gives one origin a handful of connections; thirty tiles asking at once
 * would hold them all and keep the desktop's own saves waiting behind them.
 */
const AT_ONCE = 3;
let loading = 0;
const waiting: (() => void)[] = [];
function nextSlot() {
  while (loading < AT_ONCE && waiting.length > 0) {
    loading += 1;
    waiting.shift()?.();
  }
}
function release() {
  loading = Math.max(0, loading - 1);
  nextSlot();
}

/**
 * A web app's tile: the site's own icon, as a phone's home screen shows it,
 * fetched by Brawzer's API (never by this device). Until it arrives, or when
 * the site offers none, the name's initial on the app's colour.
 */
export function WebAppIcon({
  app,
  size = 44,
  className,
}: {
  app: WebApp;
  size?: number;
  className?: string;
}) {
  const tile = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [shown, setShown] = useState<"initial" | "icon">("initial");
  // Whether this tile holds one of the loading slots right now.
  const holding = useRef(false);

  useEffect(() => {
    const start = () => {
      holding.current = true;
      setSrc(webAppIconUrl(app.id));
    };
    const queue = () => {
      waiting.push(start);
      nextSlot();
    };
    let observer: IntersectionObserver | null = null;
    if (tile.current && "IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        observer = null;
        queue();
      });
      observer.observe(tile.current);
    } else {
      queue();
    }
    return () => {
      observer?.disconnect();
      const at = waiting.indexOf(start);
      if (at >= 0) waiting.splice(at, 1);
      // Gone before its icon arrived: the slot goes to the next tile.
      if (holding.current) {
        holding.current = false;
        release();
      }
    };
  }, [app.id]);

  const arrived = () => {
    if (holding.current) {
      holding.current = false;
      release();
    }
  };

  return (
    <span
      ref={tile}
      aria-hidden="true"
      className={cn("ap-icon ap-web-icon", className)}
      data-icon={shown}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: app.colour,
        fontSize: Math.round(size * 0.46),
      }}
    >
      {app.name.charAt(0)}
      {src ? (
        // A same-origin image from the API; next/image has nothing to add.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          draggable={false}
          className="ap-web-icon-img"
          onLoad={() => {
            setShown("icon");
            arrived();
          }}
          onError={arrived}
        />
      ) : null}
    </span>
  );
}
