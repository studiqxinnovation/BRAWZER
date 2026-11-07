import { connection } from "next/server";
import { Logo } from "@brawzer/ui/brand";
import Link from "next/link";
import { Suspense } from "react";
import { AccountPanel, AccountPanelSkeleton } from "@/components/app-shell/account-panel";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { AppNav } from "@/components/app-shell/nav";
import { SessionKeeperLoader } from "@/components/app-shell/session-keeper-loader";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { SkipLink } from "@/components/site/site-chrome";

/**
 * Rendered for every request, not prerendered, so each response carries its
 * own CSP nonce (see src/proxy.ts and src/lib/csp.ts).
 */
export const instant = false;

/** The signed-in app: sidebar on wide screens, a top bar with a drawer on small ones. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <SkipLink />

      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-5 pt-5 pb-6">
          <Link href="/app" aria-label="Brawzer home" className="inline-flex rounded-md">
            <Logo size={18} />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <AppNav label="Main" />
        </div>
        <div className="flex flex-col gap-1 border-t border-line p-3">
          <Suspense fallback={<AccountPanelSkeleton />}>
            <AccountPanel />
          </Suspense>
          <SignOutButton className="justify-start px-2.5" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 lg:hidden">
          <MobileNav
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
        <main id="main-content" className="flex-1">
          {children}
        </main>
      </div>

      <Suspense fallback={null}>
        <SessionKeeperLoader />
      </Suspense>
    </div>
  );
}
