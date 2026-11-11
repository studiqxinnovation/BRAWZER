"use client";

import { type BrowserEngine, engineDetails, type Profile } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { ExternalLink, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EngineLogo } from "@/components/browser/engine-logo";
import { useDesktop } from "@/components/desktop/desktop-context";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { fetchProfiles } from "@/lib/api/profiles";
import { useLaunchBrowser } from "@/lib/browser/use-launch";

/** Password managers with a website of their own, opened in a cloud browser like any page. */
const WEB_VAULTS = [
  {
    name: "Google Password Manager",
    url: "https://passwords.google.com/",
    about: "Passwords saved in Chrome or on Android.",
  },
  { name: "Bitwarden", url: "https://vault.bitwarden.com/", about: "Your Bitwarden vault." },
  { name: "1Password", url: "https://my.1password.com/", about: "Your 1Password account." },
  { name: "Proton Pass", url: "https://pass.proton.me/", about: "Your Proton Pass vault." },
] as const;

/**
 * Passwords: where your saved passwords are (ADR 0021). Brawzer keeps none of
 * them: they're in a browser's own account, for a profile that keeps its
 * data with its browser account on, or in a password manager's website.
 */
export default function PasswordsApp() {
  const desktop = useDesktop();
  const router = useRouter();
  const { launch } = useLaunchBrowser();
  const [profiles, setProfiles] = useState<readonly Profile[]>([]);
  const [engines, setEngines] = useState<readonly BrowserEngine[]>([]);
  useEffect(() => {
    void Promise.all([fetchProfiles(), fetchBrowserOverview()]).then(([list, overview]) => {
      if (list.ok) setProfiles(list.data.profiles);
      if (overview.ok) setEngines(overview.data.engines);
    });
  }, []);
  const withAccounts = profiles.filter(
    (profile) => engines.includes(profile.engine) && engineDetails[profile.engine].account !== null,
  );
  const vaultEngine: BrowserEngine = engines.includes("bee") ? "bee" : (engines[0] ?? "bee");

  return (
    <div className="ap-body">
      <div className="ap-main">
        <p className="ap-note">
          Brawzer doesn’t keep your passwords. They’re in your browser’s own account, or in your
          password manager’s website, and each opens in a cloud browser window: nothing reaches this
          computer.
        </p>
        <section aria-labelledby="passwords-browsers" className="ap-group">
          <h2 id="passwords-browsers" className="ap-group-title">
            In your browsers’ accounts
          </h2>
          {withAccounts.length === 0 ? (
            <p className="ap-note">No profile uses a browser with its own account yet.</p>
          ) : (
            <ul className="ap-store-list">
              {withAccounts.map((profile) => {
                const on = profile.browserAccount && profile.keepData;
                const details = engineDetails[profile.engine];
                return (
                  <li key={profile.id} className="ap-store-item">
                    <EngineLogo engine={profile.engine} size="md" />
                    <span className="ap-list-main">
                      <b>
                        {profile.name} · {details.short}
                      </b>
                      <span>
                        {on
                          ? `Signs in to ${details.account ?? ""}; its passwords open in ${details.short}.`
                          : "Its browser account is off. Turn it on in the profile’s settings."}
                      </span>
                    </span>
                    {on ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void launch(profile.engine, undefined, {
                            profileId: profile.id,
                            open: { page: "passwords" },
                          })
                        }
                      >
                        <KeyRound aria-hidden="true" />
                        Open passwords
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          router.push("/app/profiles");
                          desktop?.showDashboard();
                        }}
                      >
                        Profile settings
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="passwords-vaults" className="ap-group">
          <h2 id="passwords-vaults" className="ap-group-title">
            Password managers on the web
          </h2>
          <ul className="ap-store-list">
            {WEB_VAULTS.map((vault) => (
              <li key={vault.url} className="ap-store-item">
                <span
                  className="ap-icon"
                  data-tone="indigo"
                  style={{ width: 44, height: 44, borderRadius: 11 }}
                  aria-hidden="true"
                >
                  <KeyRound style={{ width: 22, height: 22 }} />
                </span>
                <span className="ap-list-main">
                  <b>{vault.name}</b>
                  <span>{vault.about}</span>
                </span>
                <Button
                  size="sm"
                  onClick={() => void launch(vaultEngine, undefined, { open: { url: vault.url } })}
                >
                  <ExternalLink aria-hidden="true" />
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
