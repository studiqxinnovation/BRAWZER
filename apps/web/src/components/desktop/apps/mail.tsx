"use client";

import { Button } from "@brawzer/ui/components/button";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { Tile } from "./registry";

const PROVIDERS = [
  { name: "Gmail", url: "https://mail.google.com/", about: "Google’s email." },
  {
    name: "Outlook",
    url: "https://outlook.live.com/mail/",
    about: "Microsoft’s email, Hotmail and Live.",
  },
  { name: "Yahoo Mail", url: "https://mail.yahoo.com/", about: "Yahoo’s email." },
  { name: "iCloud Mail", url: "https://www.icloud.com/mail/", about: "Apple’s email." },
  { name: "Proton Mail", url: "https://mail.proton.me/", about: "Encrypted email." },
] as const;

/**
 * Mail: your email in a cloud browser window. Brawzer runs no mail service
 * and keeps no messages; your provider's site does the rest.
 */
export default function MailApp() {
  const { launch } = useLaunchBrowser();
  return (
    <div className="ap-body">
      <div className="ap-main">
        <div className="ap-mail-head">
          <Tile glyph="mail" colour="blue" size={48} />
          <div>
            <h2 className="ap-section-title">Your email, in the cloud</h2>
            <p className="ap-note">
              It opens in a cloud browser window, so nothing you read or download stays on this
              computer.
            </p>
          </div>
        </div>
        <ul className="ap-store-list">
          {PROVIDERS.map((provider) => (
            <li key={provider.url} className="ap-store-item">
              <span className="ap-list-main">
                <b>{provider.name}</b>
                <span>
                  {provider.about} {new URL(provider.url).hostname}
                </span>
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void launch("bee", undefined, { open: { url: provider.url } })}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
