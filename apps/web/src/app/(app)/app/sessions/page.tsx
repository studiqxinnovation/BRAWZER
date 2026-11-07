import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/app-shell/page";
import { DeviceSessions, DeviceSessionsSkeleton } from "@/components/sessions/device-sessions";

export const metadata: Metadata = { title: "Sessions", robots: { index: false, follow: false } };

export default function SessionsPage() {
  return (
    <PageContainer>
      <PageHeader title="Sessions">
        <p>
          Every device that’s signed in to your account. Forgot to sign out somewhere? Sign that
          device out here: its session ends immediately.
        </p>
      </PageHeader>
      <Suspense fallback={<DeviceSessionsSkeleton />}>
        <DeviceSessions />
      </Suspense>
    </PageContainer>
  );
}
