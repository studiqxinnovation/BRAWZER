"use client";

import { Dialog, DialogContent, DialogTitle } from "@brawzer/ui/components/dialog";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchProfiles } from "@/lib/api/profiles";
import { fetchProxies } from "@/lib/api/proxies";
import {
  defaultDesktopPrefs,
  readDesktopPrefs,
  subscribeToDesktopPrefs,
  updateDesktopPrefs,
} from "@/lib/desktop-prefs";
import type { GlyphName } from "@/components/desktop/glyphs";
import { GlyphSvg } from "@/components/glyph-tile";
import { readDesktopStyle, subscribeToDesktop } from "@/lib/desktop";
import { playSound } from "@/lib/sounds";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";

function Tile({
  on,
  icon,
  label,
  sub,
  onClick,
  pressed,
}: {
  on?: boolean;
  icon: GlyphName;
  label: string;
  sub?: string;
  onClick: () => void;
  /** Set for switches: announced as on or off. */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className="dt-cc-t"
      data-on={on ? true : undefined}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className="dt-cc-dot" aria-hidden="true">
        <GlyphSvg glyph={icon} className="size-[15px]" />
      </span>
      <span>
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="dt-cc-s">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={100}
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
    </label>
  );
}

/**
 * Control Centre, as the prototype has it: Network, Do Not Disturb, Dark
 * mode and Sounds; brightness and volume; then Screenshot, Lock, Usage and
 * Leave no trace. Each does what it says, here or with the account.
 */
export function ControlCentre({
  open,
  onOpenChange,
  onNetwork,
  onScreenshot,
  onLock,
  onUsage,
  onLeaveNoTrace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNetwork: () => void;
  onScreenshot: () => void;
  onLock: () => void;
  onUsage: () => void;
  onLeaveNoTrace: () => void;
}) {
  const prefs = useSyncExternalStore(
    subscribeToDesktopPrefs,
    readDesktopPrefs,
    defaultDesktopPrefs,
  );
  const dark = useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );
  const style = useSyncExternalStore(subscribeToDesktop, readDesktopStyle, () => "mac" as const);
  const [route, setRoute] = useState<string | null>(null);

  // How the account's first profile reaches the web: directly, or through its proxy.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([fetchProfiles(), fetchProxies()]).then(([profiles, proxies]) => {
      if (cancelled) return;
      const first = profiles.ok ? profiles.data.profiles[0] : undefined;
      const proxy =
        first?.proxyId && proxies.ok
          ? proxies.data.proxies.find((candidate) => candidate.id === first.proxyId)
          : undefined;
      setRoute(proxy ? proxy.name : "Direct");
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const then = (run: () => void) => () => {
    onOpenChange(false);
    run();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={style === "windows" ? "dt-cc dt-cc-windows" : "dt-cc dt-cc-mac"}>
        <DialogTitle className="sr-only">Control Centre</DialogTitle>
        <Tile
          on
          icon="wifi"
          label="Network"
          sub={`Cloud · ${route ?? "…"}`}
          onClick={then(onNetwork)}
        />
        <Tile
          on={prefs.dnd}
          pressed={prefs.dnd}
          icon="moon"
          label="Do Not Disturb"
          sub={prefs.dnd ? "On" : "Off"}
          onClick={() => {
            updateDesktopPrefs({ dnd: !prefs.dnd });
          }}
        />
        <Tile
          on={dark}
          pressed={dark}
          icon="moon"
          label="Dark mode"
          sub={dark ? "On" : "Off"}
          onClick={() => {
            setThemePreference(dark ? "light" : "dark");
          }}
        />
        <Tile
          on={prefs.sounds}
          pressed={prefs.sounds}
          icon="speaker"
          label="Sounds"
          sub={prefs.sounds ? "On" : "Off"}
          onClick={() => {
            updateDesktopPrefs({ sounds: !prefs.sounds });
            if (!prefs.sounds)
              setTimeout(() => {
                playSound("pop");
              }, 0);
          }}
        />
        <Slider
          label="Display brightness"
          value={prefs.brightness}
          min={15}
          onChange={(value) => {
            updateDesktopPrefs({ brightness: Math.max(15, value) });
          }}
        />
        <Slider
          label="Sound volume"
          value={prefs.volume}
          onChange={(value) => {
            updateDesktopPrefs({ volume: value });
          }}
        />
        <Tile icon="camera" label="Screenshot" onClick={then(onScreenshot)} />
        <Tile icon="lock" label="Lock" onClick={then(onLock)} />
        <Tile icon="chart" label="Usage" sub="Time per app" onClick={then(onUsage)} />
        <Tile
          icon="broom"
          label="Leave no trace"
          sub="Close everything"
          onClick={then(onLeaveNoTrace)}
        />
      </DialogContent>
    </Dialog>
  );
}
