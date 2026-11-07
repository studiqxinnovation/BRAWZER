import type { Metadata } from "next";
import { CreateAccountForm } from "@/components/auth/create-account-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a Brawzer account for your cloud browser, profiles and Drive.",
  robots: { index: false, follow: false },
};

export default function CreateAccountPage() {
  return (
    <div className="w-full max-w-sm">
      <CreateAccountForm />
    </div>
  );
}
