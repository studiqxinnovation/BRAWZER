"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  CircleUserRound,
  Info,
  Layers,
  ListFilter,
  Lock,
  LogOut,
  MonitorSmartphone,
  Monitor,
  Palette,
  ShieldCheck,
  Users,
  Globe,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { AccentControl, ThemeControl } from "@/components/appearance-controls";
import { useDesktop } from "@/components/desktop/desktop-context";
import { WallpaperPicker } from "@/components/desktop/wallpaper";
import {
  type DesktopStyle,
  readDesktopStyle,
  setDesktopOn,
  setDesktopStyle,
  subscribeToDesktop,
} from "@/lib/desktop";
import { lockNow } from "@/lib/lock";
import { signOut } from "@/lib/session-channel";

type Section = "appearance" | "desktop" | "account" | "about";

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <Palette aria-hidden="true" /> },
  { id: "desktop", label: "Desktop", icon: <Monitor aria-hidden="true" /> },
  { id: "account", label: "Account and security", icon: <CircleUserRound aria-hidden="true" /> },
  { id: "about", label: "About Brawzer", icon: <Info aria-hidden="true" /> },
];

const PAGES: { href: Route; label: string; icon: ReactNode }[] = [
  { href: "/app/account", label: "Account", icon: <CircleUserRound aria-hidden="true" /> },
  { href: "/app/shield", label: "Shield", icon: <ShieldCheck aria-hidden="true" /> },
  {
    href: "/app/sessions",
    label: "Signed-in devices",
    icon: <MonitorSmartphone aria-hidden="true" />,
  },
  { href: "/app/profiles", label: "Profiles", icon: <Layers aria-hidden="true" /> },
  { href: "/app/proxy", label: "Proxy", icon: <Globe aria-hidden="true" /> },
  { href: "/app/site-rules", label: "Site rules", icon: <ListFilter aria-hidden="true" /> },
  { href: "/app/team", label: "Team", icon: <Users aria-hidden="true" /> },
];

/** Settings: how Brawzer looks here, and the way to the account's own pages. */
export default function SettingsApp() {
  const router = useRouter();
  const desktop = useDesktop();
  const [section, setSection] = useState<Section>("appearance");
  const style = useSyncExternalStore<DesktopStyle>(
    subscribeToDesktop,
    readDesktopStyle,
    () => "mac",
  );

  function openPage(href: Route) {
    router.push(href);
    desktop?.showDashboard();
  }

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
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="ap-main">
        {section === "appearance" && (
          <section aria-labelledby="settings-appearance">
            <h2 id="settings-appearance" className="ap-section-title">
              Appearance
            </h2>
            <div className="ap-setting">
              <h3>Theme</h3>
              <div>
                <ThemeControl />
              </div>
            </div>
            <div className="ap-setting">
              <h3>Accent colour</h3>
              <div>
                <AccentControl />
              </div>
            </div>
            <p className="text-footnote text-ink-secondary">
              Kept for this tab only, so a shared computer keeps nothing.
            </p>
          </section>
        )}
        {section === "desktop" && (
          <section aria-labelledby="settings-desktop">
            <h2 id="settings-desktop" className="ap-section-title">
              Desktop
            </h2>
            <div className="ap-setting">
              <h3>Style</h3>
              <div className="ap-choice-row" role="radiogroup" aria-label="Desktop style">
                {(["mac", "windows"] as const).map((option) => (
                  <Button
                    key={option}
                    role="radio"
                    aria-checked={style === option}
                    variant={style === option ? "primary" : "secondary"}
                    onClick={() => {
                      setDesktopStyle(option);
                    }}
                  >
                    {option === "mac" ? "Mac: menu bar and dock" : "Windows: taskbar and Start"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="ap-setting">
              <h3>Wallpaper</h3>
              <WallpaperPicker />
            </div>
            <div className="ap-setting">
              <h3>Classic layout</h3>
              <p>The app as pages, without windows, as it is on phones.</p>
              <div>
                <Button
                  onClick={() => {
                    setDesktopOn(false);
                  }}
                >
                  Use the classic layout
                </Button>
              </div>
            </div>
          </section>
        )}
        {section === "account" && (
          <section aria-labelledby="settings-account">
            <h2 id="settings-account" className="ap-section-title">
              Account and security
            </h2>
            <div className="ap-setting">
              <p>These open in Brawzer’s own window.</p>
              <div className="ap-links">
                {PAGES.map((page) => (
                  <button
                    key={page.href}
                    type="button"
                    className="ap-link"
                    onClick={() => {
                      openPage(page.href);
                    }}
                  >
                    {page.icon}
                    {page.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ap-setting">
              <h3>This computer</h3>
              <p>
                Locking keeps your browsers waiting until you confirm it’s you. Signing out ends
                them and clears what Brawzer kept in this browser.
              </p>
              <div className="ap-choice-row">
                <Button onClick={() => void lockNow()}>
                  <Lock aria-hidden="true" />
                  Lock screen
                </Button>
                <Button variant="danger" onClick={() => void signOut("user")}>
                  <LogOut aria-hidden="true" />
                  Sign out
                </Button>
              </div>
            </div>
          </section>
        )}
        {section === "about" && (
          <section aria-labelledby="settings-about">
            <h2 id="settings-about" className="ap-section-title">
              About Brawzer
            </h2>
            <div className="ap-setting">
              <p>
                Brawzer runs your browsers in its cloud, each in a container of its own. This
                computer receives only the pictures of the pages and sends your clicks and typing.
                What you save goes to Drive, encrypted; the apps keep their records with your
                account, encrypted, not on this computer.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
