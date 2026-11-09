import type { Metadata } from "next";
import { LegalDraft } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Privacy (draft)",
  description: "Draft privacy notice for Brawzer, pending legal review.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDraft
      title="Privacy"
      summary="How Brawzer is designed to handle personal information, in plain language."
      sections={[
        {
          title: "What Brawzer collects",
          body: (
            <ul>
              <li>
                Account details: your email address and sign-in credentials (passwords are stored
                only as secure hashes).
              </li>
              <li>
                Security events: when and from which device you sign in, and when sessions end,
                including the IP address involved.
              </li>
              <li>
                Account emails (confirmation links, password resets and security notices) are sent
                through an email delivery provider. [Provider to be confirmed]
              </li>
              <li>
                Your content: the browsing data of your profiles and the files in your Drive, stored
                only to provide the service to you.
              </li>
              <li>
                Billing details, handled by a payment provider once paid plans exist. [Provider to
                be confirmed]
              </li>
              <li>
                Reports you send about a page: what you write, and the page’s address and a picture
                of it only if you include them. Brawzer’s administrators read them to fix what went
                wrong. A picture is deleted when the report is closed, or after 30 days; a closed
                report after 90 days.
              </li>
            </ul>
          ),
        },
        {
          title: "What Brawzer does not do",
          body: (
            <ul>
              <li>Sell personal information.</li>
              <li>Show advertising, or use your browsing for advertising.</li>
              <li>Load third-party trackers or analytics on Brawzer’s pages.</li>
            </ul>
          ),
        },
        {
          title: "Cookies",
          body: (
            <p>
              Brawzer’s own website uses one essential cookie to keep you signed in. It sets no
              tracking or advertising cookies. Websites you visit inside your cloud browser set
              their own cookies, which stay in your profile in the cloud.
            </p>
          ),
        },
        {
          title: "Where data is stored and for how long",
          body: (
            <p>
              Data is stored with infrastructure providers in [regions to be confirmed]. Account
              data is kept while your account exists. Security events are kept for [period to be
              confirmed] so you can review recent activity.
            </p>
          ),
        },
        {
          title: "Your choices",
          body: (
            <ul>
              <li>Download your Drive files and profile data.</li>
              <li>Delete individual profiles, files or your whole account.</li>
              <li>Review and end your sessions at any time.</li>
            </ul>
          ),
        },
        {
          title: "Contact",
          body: <p>[Contact details to be added before launch]</p>,
        },
      ]}
    />
  );
}
