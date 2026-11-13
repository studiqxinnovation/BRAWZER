import {
  browserOverviewSchema,
  profileListSchema,
  proxyListSchema,
  webAppById,
} from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { Unavailable } from "@/components/app-shell/page";
import { BrowserWorkspace } from "@/components/browser/workspace";
import { isWebUrl } from "@/lib/web-url";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = {
  title: "Browser window",
  robots: { index: false, follow: false },
};

async function Workspace({ searchParams }: Pick<PageProps<"/app/browser/window">, "searchParams">) {
  const params = await searchParams;
  const select = {
    session:
      typeof params.session === "string" && z.uuid().safeParse(params.session).success
        ? params.session
        : null,
    launcher: params.new === "1",
  };
  // Framed by the desktop as one of its windows, perhaps to open a site or the browser's own page.
  const embedded = params.embedded === "1";
  const openUrl =
    typeof params.open === "string" && isWebUrl(params.open) ? params.open : undefined;
  const openPage =
    params.page === "passwords" || params.page === "account" ? params.page : undefined;
  // A web app's window: drawn as an app, with no tabs or address bar.
  const webApp = typeof params.app === "string" ? webAppById(params.app) : undefined;
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
      key={select.launcher ? "launcher" : (select.session ?? "newest")}
      select={select}
      mode="window"
      embedded={embedded}
      app={webApp}
      openOnStart={openUrl || openPage ? { url: openUrl, page: openPage } : undefined}
      initial={overview.data}
      profiles={profiles.data.profiles}
      proxies={proxies.data.proxies.map(({ id, name, protocol }) => ({ id, name, protocol }))}
    />
  );
}

/** The whole window is the browser: its tabs, address bar, page and status bar. */
export default function BrowserWindowPage({ searchParams }: PageProps<"/app/browser/window">) {
  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <Suspense fallback={<Skeleton className="m-5 h-64 rounded-xl" />}>
        <Workspace searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
