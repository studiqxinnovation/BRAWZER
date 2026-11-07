import type { Metadata } from "next";
import { LegalDraft } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Terms (draft)",
  description: "Draft terms of service for Brawzer, pending legal review.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDraft
      title="Terms of service"
      summary="The draft rules for using Brawzer, written to be read."
      sections={[
        {
          title: "Using Brawzer",
          body: (
            <p>
              Brawzer gives you a browser that runs in the cloud. You may use it for lawful
              purposes, on any computer you are allowed to use.
            </p>
          ),
        },
        {
          title: "Your account",
          body: (
            <p>
              Keep your sign-in methods safe and tell us if you think someone else has accessed your
              account. You can review and end your sessions at any time.
            </p>
          ),
        },
        {
          title: "Acceptable use",
          body: (
            <ul>
              <li>No illegal activity or content.</li>
              <li>No attacks on other systems, including through Brawzer’s network or proxies.</li>
              <li>No attempts to get around plan limits, isolation or security controls.</li>
              <li>No sending spam or automated abuse.</li>
            </ul>
          ),
        },
        {
          title: "Your content",
          body: (
            <p>
              Your profiles and files remain yours. Brawzer stores and processes them only to
              provide the service to you.
            </p>
          ),
        },
        {
          title: "Availability and changes",
          body: (
            <p>
              Brawzer is in development and may change. [Service levels, notice periods and
              liability terms to be confirmed with legal counsel.]
            </p>
          ),
        },
        {
          title: "Ending your account",
          body: (
            <p>
              You can close your account at any time. [Data export window and suspension terms to be
              confirmed.]
            </p>
          ),
        },
      ]}
    />
  );
}
