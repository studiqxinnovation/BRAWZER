import { profileListSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
import { ExtensionsManager } from "@/components/extensions/extensions-manager";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = { title: "Extensions", robots: { index: false, follow: false } };

async function Extensions() {
  const list = await serverGet("/profiles", profileListSchema);
  if (list.kind === "signed-out") signInAgain("/app/extensions");
  if (list.kind === "unavailable") return <Unavailable />;
  return <ExtensionsManager profiles={list.data.profiles} />;
}

export default function ExtensionsPage() {
  return (
    <PageContainer>
      <PageHeader title="Extensions">
        <p>
          Open-source extensions Brawzer has reviewed, each pinned to a release and installed into a
          profile’s sessions when they start. They run in the cloud browser, never on the computer
          you’re using, and nothing installs from a store.
        </p>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
        <Extensions />
      </Suspense>
    </PageContainer>
  );
}
