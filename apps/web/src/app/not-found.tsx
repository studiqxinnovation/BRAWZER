import { Logo } from "@brawzer/ui/brand";
import Link from "next/link";
import { NotFoundMark } from "@/components/app-shell/not-found-mark";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-24">
      <NotFoundMark />
      <Link href="/" className="self-start rounded-md" aria-label="Brawzer home">
        <Logo size={22} />
      </Link>
      <p className="mt-16 font-mono text-footnote text-ink-tertiary">404</p>
      <h1 className="mt-2 text-title-1">This page doesn’t exist.</h1>
      <p className="mt-3 text-body text-ink-secondary">
        The link may be out of date, or the address may have a typo.
      </p>
      <Link
        href="/"
        className="mt-8 self-start rounded-sm text-callout font-medium text-accent-ink underline-offset-4 hover:underline"
      >
        Go to the home page
      </Link>
    </main>
  );
}
