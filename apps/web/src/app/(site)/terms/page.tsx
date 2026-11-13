import type { Metadata } from "next";
import { LegalDraft } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The rules for using Brawzer, written to be read.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDraft
      title="Terms of service"
      summary="The rules for using Brawzer, written to be read. They describe what Brawzer does today, not what it might do."
      updated="13 November 2026"
      sections={[
        {
          title: "The agreement",
          body: (
            <p>
              These terms are between you and Studiqx [legal name and registered address to be
              confirmed], which operates Brawzer. By creating an account you agree to them and to
              the <a href="/privacy">privacy notice</a>. If you use Brawzer for an organisation, you
              confirm you may bind it.
            </p>
          ),
        },
        {
          title: "What Brawzer is",
          body: (
            <p>
              Brawzer runs web browsers on its own servers and shows you the page. The computer in
              front of you sees pictures of pages, never the pages themselves, and keeps nothing
              when you leave. Brawzer Drive stores your files, encrypted. Brawzer also offers a
              desktop of apps that work on those files. Brawzer is in development: features may be
              added, changed or withdrawn, and the free plan is the only plan until paid plans are
              offered.
            </p>
          ),
        },
        {
          title: "Who may use it",
          body: (
            <ul>
              <li>You must be 18 or older.</li>
              <li>
                You may use Brawzer on any computer you are allowed to use, for any lawful purpose.
              </li>
              <li>One person per account. Teams are the way to share.</li>
            </ul>
          ),
        },
        {
          title: "Your account",
          body: (
            <ul>
              <li>
                Keep your sign-in methods safe. A passkey or an authenticator app protects an
                account far better than a password alone; Brawzer will recommend one.
              </li>
              <li>
                Tell Brawzer at once if you think someone else has used your account. You can see
                and end every signed-in device from the Sessions page.
              </li>
              <li>
                If you lose every way of signing in, Brawzer’s staff can run a recovery with
                identity checks and a 48-hour waiting period, which anyone with access to your email
                can cancel. Brawzer may refuse a recovery it cannot verify.
              </li>
            </ul>
          ),
        },
        {
          title: "Acceptable use",
          body: (
            <>
              <p>Brawzer is a browser, and the law applies to what you do with it. You must not:</p>
              <ul>
                <li>
                  Break the law, or store, share or reach content it is illegal for you to have,
                  including material that sexually exploits children.
                </li>
                <li>
                  Attack, probe or overload other systems, or send spam, through Brawzer’s network,
                  its servers or a proxy you have saved.
                </li>
                <li>Use a proxy, a website account or a file you do not have the right to use.</li>
                <li>
                  Try to get around plan limits, the isolation between sessions, or Brawzer’s
                  security controls, or to reach another person’s account or data.
                </li>
                <li>Harass, threaten or defraud people, or impersonate Brawzer or anyone else.</li>
                <li>
                  Resell Brawzer or run it as a service for others without a written agreement.
                </li>
              </ul>
              <p>
                Brawzer may end a session, suspend an account, or remove content to stop a breach,
                and will say why unless the law prevents it. Brawzer answers lawful requests from
                authorities and tells you when it is allowed to.
              </p>
            </>
          ),
        },
        {
          title: "Your content",
          body: (
            <p>
              Your profiles, files and anything you create stay yours. You give Brawzer only the
              permission it needs to store, encrypt, scan, show and move them for you, and to keep
              backups. Brawzer’s staff do not open your files or profiles; the privacy notice says
              what they can see. You are responsible for having the rights to what you store and for
              your use of the websites you visit, which have their own terms.
            </p>
          ),
        },
        {
          title: "Plans and payment",
          body: (
            <ul>
              <li>
                The free plan has limits on profiles, Drive space, proxies, team members and
                browsing time, shown on the Account page.
              </li>
              <li>
                When paid plans are offered, they are billed by Stripe for a monthly or yearly
                period in advance, renew until you cancel, and can be cancelled at any time from the
                Account page for the end of the current period. Prices are shown before you pay and
                Brawzer gives at least 30 days’ notice by email before a price rises.
              </li>
              <li>
                Refunds are given where the law requires them, and otherwise at Brawzer’s
                discretion, for example when the service was unavailable for a long time.
              </li>
              <li>
                If a payment fails, Brawzer writes to you and keeps the paid plan for a short while;
                the account then returns to the free plan and keeps its data within the free limits.
              </li>
            </ul>
          ),
        },
        {
          title: "Availability and changes",
          body: (
            <ul>
              <li>
                Brawzer is provided as it is, while in development, without a promised level of
                availability. The Status page shows what is running.
              </li>
              <li>
                A cloud browser session ends by itself after 15 minutes with nobody watching, and
                after its maximum length. Profiles that keep their data are saved when a session
                ends; a session that ends because of a failure may lose that session’s changes.
              </li>
              <li>
                Brawzer may change or withdraw features. If a feature that holds your data is
                withdrawn, or Brawzer closes, you get at least 30 days’ notice by email and a way to
                download your data first.
              </li>
              <li>
                These terms may change. Material changes are emailed at least 14 days before they
                take effect; if you keep using Brawzer after that, they apply.
              </li>
            </ul>
          ),
        },
        {
          title: "Ending your account",
          body: (
            <ul>
              <li>
                You can delete your account from the Account page at any time. Deletion is immediate
                and cannot be undone; encrypted backups age out within 30 days. Download your data
                first if you want to keep it.
              </li>
              <li>
                Brawzer may suspend or close an account that breaks these terms, immediately for a
                serious breach and otherwise with notice, and may close an account that never
                confirmed its email after 30 days.
              </li>
            </ul>
          ),
        },
        {
          title: "Liability",
          body: (
            <p>
              [To be settled with counsel.] The intended position: Brawzer is responsible for what
              the law does not let it exclude, such as harm caused deliberately or by gross
              negligence. Beyond that, Brawzer is not responsible for indirect losses, for the
              content of websites you visit, or for data lost because a session ended unexpectedly,
              and its total responsibility to you is limited to what you paid Brawzer in the twelve
              months before the claim.
            </p>
          ),
        },
        {
          title: "Governing law",
          body: (
            <p>
              [To be settled with counsel: the law and courts of the operator’s country, with the
              consumer protections of your own country where they apply.]
            </p>
          ),
        },
        {
          title: "Contact",
          body: (
            <p>
              <a href="mailto:support@brawzer.com">support@brawzer.com</a>
            </p>
          ),
        },
      ]}
    />
  );
}
