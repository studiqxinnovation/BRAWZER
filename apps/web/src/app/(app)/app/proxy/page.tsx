import { profileListSchema, proxyListSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  Card,
  Grid,
  PageContainer,
  PageHeader,
  Pill,
  Unavailable,
} from "@/components/app-shell/page";
import { Latency } from "@/components/proxies/latency";
import { ProxiesManager } from "@/components/proxies/proxies-manager";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Proxy", robots: { index: false, follow: false } };

async function Proxies() {
  const [state, list, profiles] = await Promise.all([
    getSession(),
    serverGet("/proxies", proxyListSchema),
    serverGet("/profiles", profileListSchema),
  ]);
  if (state.kind === "signed-out" || list.kind === "signed-out") signInAgain("/app/proxy");
  if (state.kind === "unavailable" || list.kind === "unavailable") return <Unavailable />;
  const first = profiles.kind === "ok" ? (profiles.data.profiles[0] ?? null) : null;
  const route = first?.proxyId
    ? (list.data.proxies.find((proxy) => proxy.id === first.proxyId) ?? null)
    : null;
  const own = list.data.proxies.filter((proxy) => !proxy.team).length;
  return (
    <>
      <Grid cols={3}>
        <Card label="Route">
          <p className="ad-stat-big">{route ? route.name : "Direct"}</p>
          <p className="ad-stat-small">
            {first ? (
              <>
                For “{first.name}” ·{" "}
                {route ? (
                  route.lastTest?.ok ? (
                    <Pill tone="green">Working</Pill>
                  ) : route.lastTest ? (
                    <Pill tone="red">Failing</Pill>
                  ) : (
                    <Pill tone="grey">Not tested</Pill>
                  )
                ) : (
                  <Pill tone="green">Connected</Pill>
                )}
              </>
            ) : (
              "Websites see Brawzer’s cloud"
            )}
          </p>
        </Card>
        <Card label="Latency">
          <Latency />
          <p className="ad-stat-small">From this device to Brawzer’s cloud</p>
        </Card>
        <Card label="Proxies">
          <p className="ad-stat-big">
            {String(own)}{" "}
            <span className="text-callout font-medium text-ink-tertiary">
              of {String(list.data.limit)}
            </span>
          </p>
          <p className="ad-stat-small">Passwords stay encrypted on Brawzer’s servers</p>
        </Card>
      </Grid>
      <ProxiesManager
        proxies={list.data.proxies}
        limit={list.data.limit}
        team={list.data.team}
        renderedAt={list.receivedAt}
        sharedComputer={!state.data.session.persistent}
      />
    </>
  );
}

export default function ProxyPage() {
  return (
    <PageContainer>
      <PageHeader title="Proxy">
        <p>
          Choose where each profile connects to the internet from: websites see the proxy’s address,
          not Brawzer’s.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-[14px]">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
          <Proxies />
        </Suspense>
      </div>
    </PageContainer>
  );
}
