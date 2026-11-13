import type { Metadata } from "next";
import { RecoverLink } from "@/components/auth/recover-link";

export const metadata: Metadata = {
  title: "Confirm your recovery",
  description: "Confirm an account recovery request.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="w-full max-w-sm">
      <RecoverLink action="confirm" />
    </div>
  );
}
