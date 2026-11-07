import { connection } from "next/server";
import { Logo } from "@brawzer/ui/brand";
import Link from "next/link";

/**
 * Rendered for every request, not prerendered, so each response carries its
 * own CSP nonce (see src/proxy.ts and src/lib/csp.ts).
 */
export const instant = false;

/** Sign-in and account pages: quiet, centred, no marketing navigation. */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-6 sm:px-8">
        <Link href="/" aria-label="Brawzer home" className="inline-flex rounded-md">
          <Logo size={19} />
        </Link>
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-start justify-center px-6 pt-8 pb-20 sm:items-center sm:pt-0"
      >
        {children}
      </main>
    </div>
  );
}
