import type { Metadata } from "next";
import { UnsubscribeForm } from "@/components/auth/unsubscribe-form";

export const metadata: Metadata = {
  title: "Stop these emails",
  description: "Turn off one kind of optional email from Brawzer.",
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return (
    <div className="w-full max-w-sm">
      <UnsubscribeForm />
    </div>
  );
}
