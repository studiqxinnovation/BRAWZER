import type { Metadata } from "next";
import { RecoverForm } from "@/components/auth/recover-form";

export const metadata: Metadata = {
  title: "Recover your account",
  description: "Get back into Brawzer after losing your passkey, authenticator and recovery codes.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="w-full max-w-sm">
      <RecoverForm />
    </div>
  );
}
