import { connection } from "next/server";
import { Suspense } from "react";
import { ConfirmIdentityProvider } from "@/components/app-shell/confirm-identity";
import { SessionKeeperLoader } from "@/components/app-shell/session-keeper-loader";

/** Rendered per request, like the app: each response carries its own CSP nonce. */
export const instant = false;

/**
 * The pop-out window (Phase 8, idea 6): the signed-in session's rules (idle
 * sign-out, confirm-it's-you) without the app's navigation, so the browser's
 * own chrome is all there is.
 */
export default async function WindowLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <div className="h-dvh">
      <main id="main-content" className="h-full">
        <ConfirmIdentityProvider>{children}</ConfirmIdentityProvider>
      </main>
      <Suspense fallback={null}>
        <SessionKeeperLoader />
      </Suspense>
    </div>
  );
}
