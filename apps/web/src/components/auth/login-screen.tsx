"use client";

import { Mark } from "@brawzer/ui/brand";
import { type ReactNode, useSyncExternalStore } from "react";
import "@/components/site/landing/landing.css";
import "./login-screen.css";

const everyMinute = (changed: () => void) => {
  const timer = setInterval(changed, 15_000);
  return () => {
    clearInterval(timer);
  };
};
const minuteNow = () => Math.floor(Date.now() / 60_000);

/** The time and date, large, as the prototype's log-in screen shows them. */
function Clock() {
  const minute = useSyncExternalStore(everyMinute, minuteNow, () => 0);
  if (minute === 0) return <div className="lg-clock" aria-hidden="true" />;
  const now = new Date(minute * 60_000);
  return (
    <div className="lg-clock">
      <time dateTime={now.toISOString()} className="lg-time">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </time>
      <div className="lg-date">
        {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </div>
  );
}

/**
 * The sign-in page as the prototype's log-in screen: the wallpaper behind a
 * blur, the time and date, Brawzer's mark where the prototype puts the
 * person's initial, then the form.
 */
export function LoginScreen({ children, notice }: { children: ReactNode; notice?: ReactNode }) {
  return (
    <div className="lg-screen" data-theme="dark">
      {/* The same sky as the home page: Brawzer's black, the aurora, the stars, the floor. */}
      <div aria-hidden="true" className="lp-aurora">
        <div className="lp-blob lp-blob-blue" />
        <div className="lp-blob lp-blob-violet" />
        <div className="lp-blob lp-blob-honey" />
        <div className="lp-blob lp-blob-teal" />
      </div>
      <div aria-hidden="true" className="lp-stars" />
      <div aria-hidden="true" className="lp-stars lp-stars-far" />
      <div aria-hidden="true" className="lp-floor" />
      <Clock />
      <div className="lg-me">
        <span className="lg-av" aria-hidden="true">
          <Mark size={44} />
        </span>
        <p className="lg-welcome" aria-live="polite" />
        {notice}
        {children}
      </div>
      <p className="lg-foot">Your computer in the cloud. Nothing is saved on this device.</p>
    </div>
  );
}
