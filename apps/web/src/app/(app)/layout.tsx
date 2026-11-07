import { Logo } from "@brawzer/ui/brand";
import Link from "next/link";
import { SignOutButton } from "@/components/app/sign-out-button";

/** The signed-in area. The full app shell (navigation, workspace) arrives in milestone 1.5. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <Link href="/app" aria-label="Brawzer, your account" className="inline-flex rounded-md">
            <Logo size={18} />
          </Link>
          <SignOutButton />
        </div>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
    </div>
  );
}
