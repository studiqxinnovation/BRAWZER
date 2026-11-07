import type { Metadata } from "next";
import { ConfirmEmailChangeForm } from "@/components/auth/confirm-email-change-form";

export const metadata: Metadata = {
  title: "Confirm your new email",
  description: "Finish changing your Brawzer account’s email address.",
  robots: { index: false, follow: false },
};

export default function ConfirmEmailChangePage() {
  return (
    <div className="w-full max-w-sm">
      <ConfirmEmailChangeForm />
    </div>
  );
}
