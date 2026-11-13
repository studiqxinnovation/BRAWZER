import type { Metadata } from "next";
import { RecoverLink } from "@/components/auth/recover-link";

export const metadata: Metadata = {
  title: "Cancel the recovery",
  description: "Cancel an account recovery request you did not make.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="w-full max-w-sm">
      <RecoverLink action="cancel" />
    </div>
  );
}
