"use client";

/** The time of day, for the desktop's clocks: changes are checked every 15 seconds. */
export function subscribeToClock(changed: () => void): () => void {
  const timer = setInterval(changed, 15_000);
  return () => {
    clearInterval(timer);
  };
}

/** "9:41 AM", as the menu bar shows it. */
export const menuBarClock = () =>
  new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "9:41|10 Nov 2026", as the taskbar shows it. */
export const taskbarClock = () => {
  const now = new Date();
  return `${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}|${now.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
};

/** "09:41 AM|Tuesday 10 November", as the lock screen shows it. */
export const lockClock = () => {
  const now = new Date();
  return `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}|${now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}`;
};
