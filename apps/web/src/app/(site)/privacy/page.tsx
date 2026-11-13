import type { Metadata } from "next";
import { LegalDraft } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Brawzer collects, where it is kept, for how long, and what you can do about it.",
  alternates: { canonical: "/privacy" },
};

/**
 * Every statement here is checked against what the code does (retention
 * periods in apps/api/src/maintenance/retention.ts and the contracts; the
 * providers in infra/hostman). Change the code, change this page.
 */
export default function PrivacyPage() {
  return (
    <LegalDraft
      title="Privacy"
      summary="What Brawzer collects, where it is kept, for how long, and what you can do about it. Written to be read."
      updated="13 November 2026"
      sections={[
        {
          title: "Who is responsible",
          body: (
            <p>
              Brawzer is operated by Studiqx [legal name and registered address to be confirmed].
              Questions about this notice, and requests about your information, go to{" "}
              <a href="mailto:support@brawzer.com">support@brawzer.com</a>.
            </p>
          ),
        },
        {
          title: "What Brawzer collects, and why",
          body: (
            <ul>
              <li>
                <strong>Your account:</strong> your name, your email address and your sign-in
                methods. Passwords are stored only as salted hashes; passkeys as their public keys;
                authenticator-app secrets encrypted. Brawzer needs these to let you in and to write
                to you about your account.
              </li>
              <li>
                <strong>Sign-in and security history:</strong> when you sign in, from which device
                and address (IP address and browser description), when you change something that
                matters (email, password, passkeys, two-factor, a profile’s proxy) and when sessions
                begin and end. This is what the Shield page shows you, and what lets Brawzer warn
                you about a sign-in from a new device. Kept for one year, then deleted. A record of
                a device you signed in from is kept for 90 days so Brawzer recognises it.
              </li>
              <li>
                <strong>Your cloud browser sessions:</strong> when each one started and ended, which
                browser it ran and on which of Brawzer’s servers. Not what you looked at: pages load
                inside a container on Brawzer’s servers that is destroyed when the session ends, and
                nothing from them is kept unless you chose a profile that keeps its data. Session
                records are deleted 30 days after the session ends.
              </li>
              <li>
                <strong>Profiles that keep their data:</strong> the browsing data of a profile
                (cookies, site storage, saved passwords if you switched the browser account on,
                extensions) is packed at the end of each session and stored encrypted with a key
                that exists only for that profile. Its history, bookmarks and open tabs are
                encrypted the same way. You can switch history off, forget a page or clear it; pages
                not visited for 90 days are forgotten, and each profile keeps at most 5,000. If you
                sign the browser itself in to a Google, Microsoft or Mozilla account, that company
                syncs your passwords and bookmarks under its own privacy terms, as it would on your
                own computer.
              </li>
              <li>
                <strong>Your Drive:</strong> the files you upload or save from a cloud browser. Each
                file is encrypted on Brawzer’s servers before it is stored and scanned for malware
                when it arrives; a file that fails the scan is quarantined and you are told. Files
                you delete go to Trash for 30 days, then are gone.
              </li>
              <li>
                <strong>Proxies you save:</strong> the address and, if you give them, the
                credentials of a proxy a profile browses through. Credentials are encrypted at rest
                and handed only to the container running that profile’s session.
              </li>
              <li>
                <strong>Teams:</strong> if you create or join a team, its members see each other’s
                names and email addresses, and the owner’s plan sets the team’s limits.
              </li>
              <li>
                <strong>Support and reports:</strong> what you write to Brawzer from the Help app,
                and the address and picture of a page you report, only if you include them.
                Brawzer’s staff read these to help you or fix what went wrong. A report’s picture is
                deleted when the report is closed, or after 30 days; a closed report after 90 days.
              </li>
              <li>
                <strong>Account recovery:</strong> if you lose every way of signing in, Brawzer’s
                staff may ask you to name a recent invoice, the last digits of the card on file, or
                to show an identity document. Brawzer records that each check happened, not the
                document.
              </li>
              <li>
                <strong>Billing:</strong> when paid plans are offered, Stripe takes your payment
                details. Brawzer never sees your card number; it keeps your invoices and the last
                digits of the card, for your receipts and for recovery.
              </li>
              <li>
                <strong>The assistant:</strong> when the assistant inside Brawzer is switched on by
                the operator, the text you type to it, and notes you ask it to study, are sent to
                Anthropic to produce the answer. It cannot see your screen, your Drive or the pages
                in your cloud browsers. It is not switched on today.
              </li>
            </ul>
          ),
        },
        {
          title: "What Brawzer does not do",
          body: (
            <ul>
              <li>
                Sell or rent personal information, or share it with anyone for their marketing.
              </li>
              <li>Show advertising, or use what you browse for advertising.</li>
              <li>Load third-party trackers or analytics on Brawzer’s own pages.</li>
              <li>
                Read your files, your profiles or your pages. They are stored encrypted; staff see
                account details in the console, every reveal of a personal detail is written to an
                audit log, and no tool shows staff what a session is browsing.
              </li>
            </ul>
          ),
        },
        {
          title: "Who else handles your information",
          body: (
            <ul>
              <li>
                <strong>Hostman</strong> (hosting): Brawzer’s servers and object storage are in New
                York, United States.
              </li>
              <li>
                <strong>Resend</strong> (email delivery): every email Brawzer sends you goes through
                Resend, from a server in the European Union. If an email bounces or you mark one as
                spam, Resend tells Brawzer and Brawzer stops writing to that address until you
                change it.
              </li>
              <li>
                <strong>Stripe</strong> (payments), once paid plans exist.
              </li>
              <li>
                <strong>Anthropic</strong> (the assistant), only when the operator switches it on.
              </li>
              <li>
                The websites you visit inside a cloud browser, and any browser-vendor account you
                sign the browser into. Those are your relationships with them; Brawzer’s servers
                fetch the pages for you and keep nothing of them.
              </li>
            </ul>
          ),
        },
        {
          title: "Cookies and this device",
          body: (
            <p>
              Brawzer’s website sets one essential cookie that keeps you signed in on this device,
              and no tracking or advertising cookies. Preferences such as your theme and desktop
              layout are kept in the browser’s own storage on the device and are cleared by “Leave
              no trace”. Websites you visit inside your cloud browser set their cookies in the
              cloud, in your profile, never on the device in front of you.
            </p>
          ),
        },
        {
          title: "How long things are kept",
          body: (
            <ul>
              <li>Account details: while your account exists.</li>
              <li>Sign-in and security history: one year. Known devices: 90 days.</li>
              <li>Session records: 30 days after the session ends.</li>
              <li>Profile history: 90 days from the last visit. Open tabs handed off: 7 days.</li>
              <li>Drive Trash: 30 days. Used email links: 7 days.</li>
              <li>An account that never confirmed its email: deleted after 30 days.</li>
              <li>
                Backups: Brawzer keeps encrypted backups of its database for 30 days, so something
                you delete can remain in a backup for up to 30 days before it is gone everywhere.
              </li>
            </ul>
          ),
        },
        {
          title: "Your choices and rights",
          body: (
            <ul>
              <li>
                <strong>See everything:</strong> “Download your data” on the Account page gives you
                every record Brawzer holds about you, except secrets, as a file.
              </li>
              <li>
                <strong>Change or delete:</strong> change your name, email, password and sign-in
                methods yourself; delete profiles, files, teams or your whole account. Deleting the
                account is immediate and cannot be undone; backups age out within 30 days.
              </li>
              <li>
                <strong>Control email:</strong> optional emails can be switched off on the Account
                page or with the unsubscribe link in each one. Security and billing emails are
                always sent while you have an account.
              </li>
              <li>
                <strong>Sessions and devices:</strong> see and end every signed-in device and every
                cloud browser from the Sessions page.
              </li>
              <li>
                Where the law of the place you live gives you further rights, such as to object to
                processing or to complain to a data protection authority, you can exercise them
                through the tools above or by writing to support@brawzer.com. Brawzer answers within
                30 days.
              </li>
            </ul>
          ),
        },
        {
          title: "Children",
          body: (
            <p>
              Brawzer is for people aged 18 and over. If you learn that someone younger has an
              account, write to support@brawzer.com and it will be removed.
            </p>
          ),
        },
        {
          title: "Changes to this notice",
          body: (
            <p>
              When this notice changes in a way that matters, Brawzer emails every account at least
              14 days before the change takes effect. The date at the top is the date of the current
              version.
            </p>
          ),
        },
      ]}
    />
  );
}
