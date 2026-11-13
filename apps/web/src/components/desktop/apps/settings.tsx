"use client";

import type { DriveUsage } from "@brawzer/contracts";
import { Mark } from "@brawzer/ui/brand";
import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AccentControl } from "@/components/appearance-controls";
import { useDesktop } from "@/components/desktop/desktop-context";
import { WallpaperPicker } from "@/components/desktop/wallpaper";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { emptyTrash, fetchDriveOverview, fetchTrash, uploadDriveFile } from "@/lib/api/drive";
import { Face } from "../face";
import { driveFolder } from "./drive-save";
import {
  type DesktopStyle,
  readDesktopStyle,
  setDesktopOn,
  subscribeToDesktop,
} from "@/lib/desktop";
import {
  chooseDesktopStyle,
  defaultDesktopPrefs,
  IDLE_CHOICES,
  readDesktopPrefs,
  setPinned,
  subscribeToDesktopPrefs,
  updateDesktopPrefs,
} from "@/lib/desktop-prefs";
import { lockNow } from "@/lib/lock";
import { resolveTheme, setThemePreference, subscribeToAppearance } from "@/lib/theme";
import { useAppWindow } from "./app-window";
import { SETTINGS_SECTIONS, type SettingsSection } from "./settings-sections";
import { type AppId, AppIcon, apps, dockSystemApps, launchpadOrder, Tile } from "./registry";

const SECTIONS = SETTINGS_SECTIONS;
type Section = SettingsSection;
const isSection = (value: string | undefined): value is Section =>
  SECTIONS.some((section) => section.id === value);

const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : bytes >= 1024
        ? `${(bytes / 1024).toFixed(0)} KB`
        : `${String(bytes)} B`;

/** One setting: its name and what it does on the left, its control on the right. */
function Row({ label, sub, children }: { label: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="ap-st-row">
      <div>
        <div className="ap-st-t">{label}</div>
        {sub && <div className="ap-st-sub">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/** The prototype's segmented control, as radio buttons. */
function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="ap-segment" role="radiogroup" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => {
            onChange(option);
          }}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

const useDark = () =>
  useSyncExternalStore(
    subscribeToAppearance,
    () => resolveTheme() === "dark",
    () => false,
  );

/**
 * Settings, as the prototype's: Appearance, Desktop and dock, Browsers,
 * Privacy and security, Storage and About, each a page of cards. Every
 * control does what it says, here or with the account.
 */
export default function SettingsApp() {
  const router = useRouter();
  const toast = useToast();
  const desktop = useDesktop();
  // Opened at a section when asked ("About Brawzer" opens About).
  const { params } = useAppWindow();
  const [section, setSection] = useState<Section>(() =>
    isSection(params.section) ? params.section : "appearance",
  );
  const style = useSyncExternalStore<DesktopStyle>(
    subscribeToDesktop,
    readDesktopStyle,
    () => "mac",
  );
  const dark = useDark();
  const prefs = useSyncExternalStore(
    subscribeToDesktopPrefs,
    readDesktopPrefs,
    defaultDesktopPrefs,
  );
  const [usage, setUsage] = useState<DriveUsage | null>(null);
  const [trash, setTrash] = useState<{ count: number; bytes: number } | null>(null);
  const [browsers, setBrowsers] = useState<{ open: number; limit: number } | null>(null);
  const [version, setVersion] = useState(0);
  const email = desktop?.email ?? "";
  const facePicker = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);

  /** The person's picture goes to Drive's Pictures folder, scanned and encrypted like any file. */
  async function pickFace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.add({ type: "info", title: "Too large", description: "A picture can be up to 10 MB." });
      return;
    }
    setPicking(true);
    try {
      const folder = await driveFolder("Pictures");
      if (!folder.ok) {
        toast.add({
          type: "error",
          title: "Couldn’t open Drive",
          description: folder.error.message,
        });
        return;
      }
      const result = await uploadDriveFile(file, folder.data, () => undefined).result;
      if (!result.ok) {
        toast.add({
          type: "error",
          title: "Couldn’t upload it",
          description: result.error.message,
        });
        return;
      }
      if (result.data.status !== "clean") {
        toast.add({
          type: "error",
          title: "That picture was quarantined",
          description: "It matched known malware.",
        });
        return;
      }
      updateDesktopPrefs({ avatar: `photo:${result.data.id}` });
      toast.add({ type: "success", title: "That’s you now" });
    } finally {
      setPicking(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (section === "storage") {
      void Promise.all([fetchDriveOverview(), fetchTrash()]).then(([overview, trashed]) => {
        if (cancelled) return;
        if (overview.ok) setUsage(overview.data.usage);
        if (trashed.ok) {
          setTrash({
            count: trashed.data.files.length,
            bytes: trashed.data.files.reduce((total, file) => total + file.size, 0),
          });
        }
      });
    }
    if (section === "browsers") {
      void fetchBrowserOverview().then((result) => {
        if (!cancelled && result.ok) {
          setBrowsers({
            open: result.data.sessions.length,
            limit: result.data.limits.liveSessions,
          });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [section, version]);

  function openPage(href: Route) {
    router.push(href);
    desktop?.showDashboard();
  }

  const styleSegment = (
    <Segment
      label="Desktop style"
      value={style}
      options={[
        ["mac", "Mac"],
        ["windows", "Windows"],
      ]}
      onChange={chooseDesktopStyle}
    />
  );
  const heading = SECTIONS.find((item) => item.id === section)?.label ?? "";
  const pinnable = launchpadOrder.filter(
    (app): app is AppId => !dockSystemApps.includes(app) && app !== "trash",
  );

  return (
    <div className="ap-split">
      <nav className="ap-side" aria-label="Settings">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="ap-side-item"
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => {
              setSection(item.id);
            }}
          >
            <Tile glyph={item.glyph} colour={item.colour} size={22} />
            {item.label}
          </button>
        ))}
      </nav>
      <section className="ap-st-main" aria-labelledby="settings-heading">
        <h2 id="settings-heading" className="ap-st-h">
          {heading}
        </h2>

        {section === "appearance" && (
          <>
            <div className="ap-st-card">
              <Row label="Theme" sub="Light or dark windows and panels">
                <Segment
                  label="Theme"
                  value={dark ? "dark" : "light"}
                  options={[
                    ["dark", "Dark"],
                    ["light", "Light"],
                  ]}
                  onChange={setThemePreference}
                />
              </Row>
              <Row label="Desktop style" sub="Mac dock or Windows taskbar">
                {styleSegment}
              </Row>
              <Row label="Accent colour" sub="Buttons, links and what’s selected">
                <AccentControl />
              </Row>
            </div>
            <div className="ap-st-card">
              <div className="ap-st-t ap-st-cap">Wallpaper</div>
              <WallpaperPicker />
            </div>
          </>
        )}

        {section === "desktop" && (
          <>
            <div className="ap-st-card">
              <Row label="Desktop style">{styleSegment}</Row>
              <Row label="Show desktop" sub="Hide the dashboard and minimise every window">
                <Button size="sm" onClick={desktop?.showDesktop}>
                  Show desktop
                </Button>
              </Row>
              <Row label="All apps" sub="See every app at once">
                <Button size="sm" onClick={desktop?.openLauncher}>
                  Open
                </Button>
              </Row>
              <Row label="Classic layout" sub="The app as pages, without windows, as on phones">
                <Button
                  size="sm"
                  onClick={() => {
                    setDesktopOn(false);
                  }}
                >
                  Use it
                </Button>
              </Row>
            </div>
            <div className="ap-st-card">
              <div className="ap-st-t ap-st-cap">When nobody is using it</div>
              <div className="ap-st-sub">
                Counted from the last click, key or touch in any Brawzer tab. The lock is the
                server’s: a locked screen needs your password.
              </div>
              {(
                [
                  ["dimAfter", "Dim the screen after"],
                  ["saverAfter", "Start the screen saver after"],
                  ["lockAfter", "Lock the screen after"],
                ] as const
              ).map(([key, label]) => (
                <Row key={key} label={label}>
                  <select
                    className="ap-st-select"
                    aria-label={label}
                    value={prefs[key]}
                    onChange={(event) => {
                      updateDesktopPrefs({ [key]: Number(event.target.value) });
                    }}
                  >
                    {IDLE_CHOICES.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes === 0
                          ? "Never"
                          : minutes === 1
                            ? "1 minute"
                            : minutes >= 60
                              ? `${String(minutes / 60)} hour`
                              : `${String(minutes)} minutes`}
                      </option>
                    ))}
                  </select>
                </Row>
              ))}
              <Row label="Screen saver" sub="Your wallpaper photographs, with the clock">
                <Button size="sm" onClick={desktop?.startScreenSaver}>
                  Start now
                </Button>
              </Row>
            </div>
            <div className="ap-st-card">
              <div className="ap-st-t ap-st-cap">
                Apps in the {style === "windows" ? "taskbar" : "Dock"}
              </div>
              <div className="ap-st-sub">
                Browsers and system apps always stay. Choose the rest; it’s kept with your account.
              </div>
              <div className="ap-st-pins">
                {pinnable.map((app) => (
                  <label key={app} className="ap-st-pin">
                    <AppIcon app={app} size={22} />
                    <span>{apps[app].name}</span>
                    <input
                      type="checkbox"
                      checked={prefs.pinned.includes(app)}
                      onChange={(event) => {
                        setPinned(app, event.target.checked);
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {section === "browsers" && (
          <div className="ap-st-card">
            <Row
              label="Browsers at once"
              sub="Each runs in Brawzer’s cloud, in a container of its own"
            >
              <span className="ap-st-pill">
                {browsers ? `${String(browsers.open)} of ${String(browsers.limit)} running` : "…"}
              </span>
            </Row>
            <Row label="Profiles" sub="Cookies, history and sign-ins, kept apart">
              <Button
                size="sm"
                onClick={() => {
                  openPage("/app/profiles");
                }}
              >
                Open
              </Button>
            </Row>
            <Row label="Proxy" sub="Where a profile’s browsing connects from">
              <Button
                size="sm"
                onClick={() => {
                  openPage("/app/proxy");
                }}
              >
                Open
              </Button>
            </Row>
            <Row label="Extensions" sub="Reviewed add-ons for each profile’s browser">
              <Button
                size="sm"
                onClick={() => {
                  desktop?.openApp("web-store");
                }}
              >
                Web Store
              </Button>
            </Row>
          </div>
        )}

        {section === "security" && (
          <>
            <div className="ap-st-card">
              <Row
                label="Lock now"
                sub="Shortcut: Ctrl+Shift+L. Your browsers wait until it’s you."
              >
                <Button size="sm" variant="primary" onClick={() => void lockNow()}>
                  Lock
                </Button>
              </Row>
              <Row label="Shield" sub="Protection status and your security history">
                <Button
                  size="sm"
                  onClick={() => {
                    openPage("/app/shield");
                  }}
                >
                  Open
                </Button>
              </Row>
              <Row label="Signed-in devices" sub="See them, and sign any out">
                <Button
                  size="sm"
                  onClick={() => {
                    openPage("/app/sessions");
                  }}
                >
                  Open
                </Button>
              </Row>
              <Row label="Account" sub="Password, passkeys and two-factor">
                <Button
                  size="sm"
                  onClick={() => {
                    openPage("/app/account");
                  }}
                >
                  Open
                </Button>
              </Row>
            </div>
            <div className="ap-st-card" data-danger="true">
              <Row
                label="Wipe this computer"
                sub="Closes every app, ends all sessions and removes everything Brawzer left on this device. Your Drive stays safe."
              >
                <Button size="sm" variant="danger" onClick={desktop?.wipe}>
                  Wipe now
                </Button>
              </Row>
            </div>
          </>
        )}

        {section === "storage" && (
          <>
            <div className="ap-st-card ap-st-storage">
              <div className="ap-st-big">
                <b>{usage ? size(usage.usedBytes) : "…"}</b>
                <span>of {usage ? size(usage.limitBytes) : "…"}</span>
              </div>
              <span className="ap-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${String(usage ? Math.min(100, (usage.usedBytes / usage.limitBytes) * 100) : 0)}%`,
                  }}
                />
              </span>
              <div className="ap-st-sub">
                {usage ? `${String(usage.fileCount)} files in Drive` : "…"}
                {trash ? ` · ${String(trash.count)} in Trash (${size(trash.bytes)})` : ""}
              </div>
            </div>
            <div className="ap-st-card">
              <Row label="Open Files" sub="See everything in your Drive">
                <Button
                  size="sm"
                  onClick={() => {
                    desktop?.openApp("files");
                  }}
                >
                  Open
                </Button>
              </Row>
              <Row label="Empty Trash" sub="Delete everything in Trash for good">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!trash || trash.count === 0}
                  onClick={() =>
                    void emptyTrash().then((result) => {
                      toast.add(
                        result.ok
                          ? { type: "success", title: "Trash emptied" }
                          : {
                              type: "error",
                              title: "Couldn’t empty Trash",
                              description: result.error.message,
                            },
                      );
                      setVersion((value) => value + 1);
                    })
                  }
                >
                  Empty
                </Button>
              </Row>
            </div>
          </>
        )}

        {section === "about" && (
          <>
            <div className="ap-st-card">
              <div className="ap-st-t ap-st-cap">You</div>
              <Row
                label={email}
                sub="Your picture shows on the lock screen and in Start; it lives in Drive, never on this computer"
              >
                <span className="flex items-center gap-2">
                  <Face email={email} className="ap-st-face" size={36} />
                  <Button size="sm" disabled={picking} onClick={() => facePicker.current?.click()}>
                    {picking ? "Uploading…" : "Choose a picture…"}
                  </Button>
                  {prefs.avatar && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        updateDesktopPrefs({ avatar: null });
                      }}
                    >
                      Use my initial
                    </Button>
                  )}
                  <input
                    ref={facePicker}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
                    hidden
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={(event) => void pickFace(event)}
                  />
                </span>
              </Row>
            </div>
            <div className="ap-st-card ap-st-about">
              <span
                className="dt-brand"
                aria-hidden="true"
                style={{ width: 64, height: 64, borderRadius: 15 }}
              >
                <Mark size={32} />
              </span>
              <b>Brawzer</b>
              <span className="ap-st-sub">Your computer in the cloud</span>
            </div>
            <div className="ap-st-card">
              <Row label="Apps" sub={`${String(launchpadOrder.length)} apps, and the browsers`} />
              <Row
                label="How it works"
                sub="Your browsers and apps run in Brawzer’s cloud. Only pictures of the pages reach this device; what you save goes to Drive, encrypted, and the apps keep their records with your account."
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
