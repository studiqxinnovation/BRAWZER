import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/app-shell/page";
import { CloudSessions, EndAllSessionsButton } from "@/components/sessions/cloud-sessions";
import { DeviceSessions, DeviceSessionsSkeleton } from "@/components/sessions/device-sessions";
import { SessionHistory } from "@/components/sessions/session-history";

export const metadata: Metadata = { title: "Sessions", robots: { index: false, follow: false } };

export default function SessionsPage() {
  return (
    <PageContainer>
      <PageHeader title="Sessions" action={<EndAllSessionsButton />}>
        <p>
          Each cloud browser runs in its own isolated container and is wiped when it ends. Below
          them, every device signed in to your account.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-[14px]">
        <CloudSessions />
        <Suspense fallback={<DeviceSessionsSkeleton />}>
          <SessionHistory />
        </Suspense>
        <Suspense fallback={<DeviceSessionsSkeleton />}>
          <DeviceSessions />
        </Suspense>
      </div>
    </PageContainer>
  );
}
