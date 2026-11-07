import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountOverview, AccountOverviewSkeleton } from "@/components/app/account-overview";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default function AppHomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <Suspense fallback={<AccountOverviewSkeleton />}>
        <AccountOverview />
      </Suspense>
    </div>
  );
}
