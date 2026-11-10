"use client";

import { type BrowserEngine, engineDetails, type Profile } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { ExternalLink, KeyRound, UserRound } from "lucide-react";
import Link from "next/link";
import { EngineLogo } from "./engine-logo";

/** Password managers with a website of their own, opened in the cloud browser like any page. */
const WEB_VAULTS = [
  {
    name: "Google Password Manager",
    url: "https://passwords.google.com/",
    about: "Passwords saved in Chrome or on Android, once you sign in to Google.",
  },
  { name: "Bitwarden", url: "https://vault.bitwarden.com/", about: "Your Bitwarden vault." },
  { name: "1Password", url: "https://my.1password.com/", about: "Your 1Password account." },
  { name: "Proton Pass", url: "https://pass.proton.me/", about: "Your Proton Pass vault." },
] as const;

/**
 * Where a person's saved passwords are (ADR 0021): the browser's own
 * password manager and account, for a profile with its browser account on,
 * and the password managers that have a website. Each opens in a new tab of
 * the cloud browser; nothing reaches this computer.
 */
export function PasswordsDialog({
  open,
  onOpenChange,
  engine,
  profile,
  onBrowserPage,
  onOpenUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engine: BrowserEngine;
  /** The session's profile; null for a temporary session. */
  profile: Profile | null;
  onBrowserPage: (page: "passwords" | "account") => void;
  onOpenUrl: (url: string) => void;
}) {
  const name = engineDetails[engine].name;
  const accountOn = profile?.browserAccount === true && profile.keepData;
  const account = engineDetails[engine].account;

  function choose(action: () => void) {
    action();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto">
        <DialogTitle>Saved passwords</DialogTitle>
        <DialogDescription>
          Open where your passwords are saved, in a new tab of this cloud browser. They stay in
          Brawzer’s cloud; nothing is saved on this computer.
        </DialogDescription>

        <section aria-labelledby="engine-passwords" className="mt-5 flex flex-col gap-3">
          <h3
            id="engine-passwords"
            className="flex items-center gap-2 text-callout font-semibold text-ink"
          >
            <EngineLogo engine={engine} size="sm" /> {name}
          </h3>
          {accountOn ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  choose(() => {
                    onBrowserPage("passwords");
                  });
                }}
              >
                <KeyRound aria-hidden="true" />
                Open {name}’s saved passwords
              </Button>
              {account && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    choose(() => {
                      onBrowserPage("account");
                    });
                  }}
                >
                  <UserRound aria-hidden="true" />
                  Sign in to your {account} account
                </Button>
              )}
            </div>
          ) : (
            <p className="text-footnote text-pretty text-ink-secondary">
              {profile
                ? `${name}’s own password manager${account ? ` and ${account} account` : ""} are off for “${profile.name}”. Turn on “Browser account and saved passwords” for it on the `
                : `A temporary session keeps no passwords. Open a profile with “Browser account and saved passwords” on, set on the `}
              <Link href="/app/profiles" className="text-accent-ink underline">
                Profiles page
              </Link>
              .
            </p>
          )}
          {accountOn && account && (
            <p className="text-footnote text-pretty text-ink-secondary">
              Signing in brings in the passwords you saved with your {account} account, and {name}{" "}
              fills them in on the sites they’re for. Your account’s provider may ask you to confirm
              a new sign-in.
            </p>
          )}
        </section>

        <section aria-labelledby="web-vaults" className="mt-6 flex flex-col gap-2">
          <h3 id="web-vaults" className="text-callout font-semibold text-ink">
            Password managers on the web
          </h3>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {WEB_VAULTS.map((vault) => (
              <li key={vault.name}>
                <button
                  type="button"
                  onClick={() => {
                    choose(() => {
                      onOpenUrl(vault.url);
                    });
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-callout text-ink">{vault.name}</span>
                    <span className="block text-footnote text-ink-secondary">{vault.about}</span>
                  </span>
                  <ExternalLink aria-hidden="true" className="size-4 text-ink-tertiary" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <DialogFooter className="mt-6">
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
