import { Logo } from "@brawzer/ui/brand";
import { StatusDot } from "@brawzer/ui/components/status-dot";
import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import { cn } from "@brawzer/ui/lib/cn";
import Link from "next/link";
import { ThemeControl } from "@/components/appearance-controls";
import { accountLinks, footerNav, site } from "@/content/site";
import { Container } from "./layout-primitives";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-callout font-medium text-ink shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Skip to content
    </a>
  );
}

/** Honest pre-launch notice. Disappears when `site.releaseStage` becomes "launched". */
export function PrelaunchBanner() {
  if (site.releaseStage !== "in-development") return null;
  return (
    <div className="border-b border-line bg-canvas-subtle">
      <Container className="flex items-center justify-center gap-2.5 py-2 text-center text-footnote text-ink-secondary">
        <StatusDot tone="warning" className="hidden sm:inline-flex" />
        <p>
          <span className="font-medium text-ink">In development.</span> The Brawzer cloud browser
          isn’t available yet. This site describes how it’s being built.
        </p>
      </Container>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <Container className="flex h-14 items-center gap-6">
        <Link href="/" aria-label="Brawzer home" className="rounded-md">
          <Logo size={18} />
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href={accountLinks.signIn}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "hidden sm:inline-flex",
            )}
          >
            Sign in
          </Link>
          <Link
            href={accountLinks.createAccount}
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            Get started
          </Link>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas-subtle">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <Logo size={18} />
          <p className="mt-3 max-w-xs text-footnote text-ink-secondary">
            Browse anywhere. Leave nothing behind.
          </p>
        </div>
        {footerNav.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <h2 className="text-footnote font-semibold text-ink">{group.title}</h2>
            <ul className="mt-3 space-y-2.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="rounded-sm text-footnote text-ink-secondary transition-colors hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="flex flex-col-reverse items-start gap-4 border-t border-line py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-ink-tertiary">
          Brawzer ·{" "}
          {site.releaseStage === "in-development" ? "In development" : "All rights reserved"}
        </p>
        <ThemeControl />
      </Container>
    </footer>
  );
}
