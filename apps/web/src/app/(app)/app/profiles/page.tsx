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
          Separate browsers for work, personal life, research and anything else. Each will keep its
          own cookies, history, extensions and proxy.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
          <Profiles />
        </Suspense>
        <DevState
          title="Browsing in a profile isn’t available yet"
          milestone="Phase 3"
          requires={[
            "The cloud browser (Phase 3)",
            "Each profile’s own cookies, history and sign-ins, stored encrypted (Phase 4)",
            "Browsing through each profile’s proxy (Phase 5)",
          ]}
        >
          Today, profiles organise your account: names, colours, order and which proxy each will
          use. They open in the cloud browser when it arrives.
        </DevState>
      </div>
    </PageContainer>
  );
}
