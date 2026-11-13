import { connection } from "next/server";
import { isStaffRole, securityOverviewSchema } from "@brawzer/contracts";
import { Logo } from "@brawzer/ui/brand";
import Link from "next/link";
import { Suspense } from "react";
import { AccountPanel, AccountPanelSkeleton } from "@/components/app-shell/account-panel";
import { CommandPalette } from "@/components/app-shell/command-palette";
import { DesktopShell } from "@/components/desktop/desktop";
import { LockedPage, LockScreen } from "@/components/desktop/lock-screen";
import { MenuBar } from "@/components/app-shell/menu-bar";
import "@/components/app-shell/desktop.css";
import { ConfirmIdentityProvider } from "@/components/app-shell/confirm-identity";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { AppNav } from "@/components/app-shell/nav";
import { SessionKeeperLoader } from "@/components/app-shell/session-keeper-loader";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { SkipLink } from "@/components/site/site-chrome";
import { serverGet } from "@/lib/server-api";
import { getSession } from "@/lib/session";

/**
 * Rendered for every request, not prerendered, so each response carries its
 * own CSP nonce (see src/proxy.ts and src/lib/csp.ts).
 */
export const instant = false;

/** The signed-in app: sidebar on wide screens, a top bar with a drawer on small ones. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const session = await getSession();
  const lock =
    session.kind === "ok"
      ? {
          email: session.data.account.email,
          persistent: session.data.session.persistent,
          idleTimeoutMinutes: session.data.session.idleTimeoutMinutes,
        }
      : null;
  // Loaded while locked: nothing of the app, only the lock screen (the API answers nothing else).
  if (session.kind === "ok" && session.data.session.locked && lock) {
    return (
      <>
        <LockedPage {...lock} />
        <Suspense fallback={null}>
          <SessionKeeperLoader />
        </Suspense>
      </>
    );
  }
  const admin = Promise.resolve(session.kind === "ok" && isStaffRole(session.data.account.role));
  // Shield's count of things to do, beside it in the navigation; nothing if it can't be read.
  const counts = {
    "/app/shield": serverGet("/security/overview", securityOverviewSchema).then((result) =>
      result.kind === "ok" ? result.data.recommendations.length : 0,
    ),
  };
  return (
    <>
      <SkipLink />
      <DesktopShell
        email={lock?.email ?? ""}
        admin={session.kind === "ok" && isStaffRole(session.data.account.role)}
        menuBar={<MenuBar />}
        overlays={
          <>
            <Suspense fallback={null}>
              <SessionKeeperLoader />
            </Suspense>
            <CommandPalette />
            {lock && <LockScreen {...lock} />}
          </>
        }
      >
        <aside className="ad-sidebar hidden border-r border-line lg:flex lg:min-h-0 lg:flex-col">
          <div className="px-5 pt-5 pb-6">
            <Link href="/app" aria-label="Brawzer home" className="inline-flex rounded-md">
              <Logo size={18} />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            <AppNav label="Main" admin={admin} counts={counts} />
          </div>
          <div className="flex flex-col gap-1 border-t border-line p-3">
            <Suspense fallback={<AccountPanelSkeleton />}>
              <AccountPanel />
            </Suspense>
            <SignOutButton className="justify-start px-2.5" />
          </div>
        </aside>

        <div
          data-app-scroll=""
          className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
        >
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 lg:hidden">
            <MobileNav
              admin={admin}
              counts={counts}
              account={
                <Suspense fallback={<AccountPanelSkeleton />}>
                  <AccountPanel />
                </Suspense>
              }
            />
            <Link href="/app" aria-label="Brawzer home" className="inline-flex rounded-md">
              <Logo size={18} />
            </Link>
            <SignOutButton className="ml-auto" compact />
          </header>
          <main id="main-content" className="flex-1 lg:flex lg:min-h-0 lg:flex-col">
            <ConfirmIdentityProvider>{children}</ConfirmIdentityProvider>
          </main>
        </div>
      </DesktopShell>
    </>
  );
}
