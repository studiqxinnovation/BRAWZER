import { browserOverviewSchema, profileListSchema, proxyListSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Unavailable } from "@/components/app-shell/page";
import { BrowserWorkspace } from "@/components/browser/workspace";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = {
  title: "Browser window",
  robots: { index: false, follow: false },
};

async function Workspace() {
  const [overview, profiles, proxies] = await Promise.all([
    serverGet("/browser", browserOverviewSchema),
    serverGet("/profiles", profileListSchema),
    serverGet("/proxies", proxyListSchema),
  ]);
  if (
    overview.kind === "signed-out" ||
    profiles.kind === "signed-out" ||
    proxies.kind === "signed-out"
  ) {
    signInAgain("/app/browser/window");
  }
  if (
    overview.kind === "unavailable" ||
    profiles.kind === "unavailable" ||
    proxies.kind === "unavailable"
  ) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
        <Unavailable />
      </div>
    );
  }
  return (
    <BrowserWorkspace
      mode="window"
      initial={overview.data}
      profiles={profiles.data.profiles}
      proxies={proxies.data.proxies.map(({ id, name, protocol }) => ({ id, name, protocol }))}
    />
  );
}

/** The whole window is the browser: its tabs, address bar, page and status bar. */
export default function BrowserWindowPage() {
  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <Suspense fallback={<Skeleton className="m-5 h-64 rounded-xl" />}>
        <Workspace />
      </Suspense>
    </div>
  );
}
