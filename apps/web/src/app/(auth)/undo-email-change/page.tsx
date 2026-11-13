import type { Metadata } from "next";
import { UndoEmailChangeForm } from "@/components/auth/undo-email-change-form";

export const metadata: Metadata = {
  title: "Undo an email change",
  description: "Restore your Brawzer account’s previous email address.",
  robots: { index: false, follow: false },
};

export default function UndoEmailChangePage() {
  return (
    <div className="w-full max-w-sm">
      <UndoEmailChangeForm />
    </div>
  );
}
