import type { Metadata } from "next";
import { AuthHeading, TextLink } from "@/components/auth/auth-ui";
import { PhoneSignIn } from "@/components/auth/phone-sign-in";

export const metadata: Metadata = {
  title: "Sign in with your phone",
  description: "Sign in to Brawzer on a computer by scanning a code with your phone.",
  robots: { index: false, follow: false },
};

export default function PhoneSignInPage() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <AuthHeading title="Sign in with your phone">
        For a computer without Bluetooth. On your phone, signed in to Brawzer, scan this code and
        pick the number shown here. Nothing is typed on this computer.
      </AuthHeading>
      <PhoneSignIn />
      <p className="text-center text-footnote text-ink-secondary">
        <TextLink href="/sign-in">Use a passkey or password instead</TextLink>
      </p>
    </div>
  );
}
