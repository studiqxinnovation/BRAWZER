import type { Metadata } from "next";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Finish creating your Brawzer account.",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <div className="w-full max-w-sm">
      <VerifyEmailForm />
    </div>
  );
}
