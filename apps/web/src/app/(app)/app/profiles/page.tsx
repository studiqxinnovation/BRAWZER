import { profileListSchema, proxyListSchema } from "@brawzer/contracts";
import { DevState } from "@brawzer/ui/components/dev-state";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
import { ProfilesManager } from "@/components/profiles/profiles-manager";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = { title: "Profiles", robots: { index: false, follow: false } };

async function Profiles() {
  const [result, proxies] = await Promise.all([
    serverGet("/profiles", profileListSchema),
    serverGet("/proxies", proxyListSchema),
  ]);
  if (result.kind === "signed-out" || proxies.kind === "signed-out") signInAgain("/app/profiles");
  if (result.kind === "unavailable" || proxies.kind === "unavailable") return <Unavailable />;
  return (
    <ProfilesManager
      profiles={result.data.profiles}
      limit={result.data.limit}
      proxies={proxies.data.proxies.map(({ id, name }) => ({ id, name }))}
    />
  );
}

export default function ProfilesPage() {
  return (
    <PageContainer>
      <PageHeader title="Profiles">
        <p>
          Separate browsers for work, personal life, research and anything else. Each keeps its own
          cookies, history and sign-ins, encrypted, between sessions.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
          <Profiles />
        </Suspense>
        <DevState
          title="Proxies and extensions aren’t used by profiles yet"
          milestone="Phases 4 and 5"
          requires={[
            "Browsing through each profile’s proxy (Phase 5)",
            "Extensions installed into a profile (Phase 4)",
          ]}
        >
          Today, a profile opens in the cloud browser with its own cookies, history, sign-ins and
          site data, saved encrypted between sessions (or starting clean every time, if you prefer).
        </DevState>
      </div>
    </PageContainer>
  );
}
