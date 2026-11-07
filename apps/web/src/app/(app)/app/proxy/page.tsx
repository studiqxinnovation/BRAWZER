import { proxyListSchema } from "@brawzer/contracts";
import { DevState } from "@brawzer/ui/components/dev-state";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
import { ProxiesManager } from "@/components/proxies/proxies-manager";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Proxy", robots: { index: false, follow: false } };

async function Proxies() {
  const [state, list] = await Promise.all([getSession(), serverGet("/proxies", proxyListSchema)]);
  if (state.kind === "signed-out" || list.kind === "signed-out") signInAgain("/app/proxy");
  if (state.kind === "unavailable" || list.kind === "unavailable") return <Unavailable />;
  return (
    <ProxiesManager
      proxies={list.data.proxies}
      limit={list.data.limit}
      renderedAt={list.receivedAt}
      sharedComputer={!state.data.session.persistent}
    />
  );
}

export default function ProxyPage() {
  return (
    <PageContainer>
      <PageHeader title="Proxy">
        <p>
          Give each profile its own network route. Passwords are encrypted on Brawzer’s servers and
          never sent back to this computer.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
          <Proxies />
        </Suspense>
        <DevState
          title="Browsing doesn’t go through proxies yet"
          milestone="Phase 5"
          requires={[
            "The cloud browser (Phase 3)",
            "An isolated egress service that sends each profile’s traffic through its proxy, with DNS and WebRTC leak protection (Phase 5)",
          ]}
        >
          Today you can save proxies, test them from Brawzer’s servers and choose one for each
          profile. Websites will see the proxy’s address once browsing uses it.
        </DevState>
      </div>
    </PageContainer>
  );
}
