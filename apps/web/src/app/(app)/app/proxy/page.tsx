import { proxyListSchema } from "@brawzer/contracts";
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
          Give each profile its own network route: websites see the proxy’s address, not Brawzer’s.
          Passwords are encrypted on Brawzer’s servers, used only by the session’s egress, and never
          sent back to this computer.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
          <Proxies />
        </Suspense>
      </div>
    </PageContainer>
  );
}
