"use client";

import { buttonVariants } from "@brawzer/ui/components/button";
import { Spinner } from "@brawzer/ui/components/spinner";
import Link from "next/link";
import type { ReactNode, RefObject } from "react";
import { AuthHeading } from "./auth-ui";

/** Shown for the moment between page load and reading the link in the browser. */
export function CheckingLink({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title={title} />
      <Spinner label="Checking your link" className="text-ink-secondary" />
    </div>
  );
}

/** The page was opened without a usable token, or the token was rejected. */
export function UnusableLink({
  title,
  headingRef,
  children,
  primary,
  secondary,
}: {
  title: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
  primary: { href: "/sign-in" | "/forgot-password" | "/create-account"; label: string };
  secondary?: { href: "/sign-in" | "/forgot-password" | "/create-account"; label: string };
}) {
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title={title} headingRef={headingRef}>
        {children}
      </AuthHeading>
      <div className="flex flex-wrap gap-3">
        <Link href={primary.href} className={buttonVariants({ variant: "primary" })}>
          {primary.label}
        </Link>
        {secondary && (
          <Link href={secondary.href} className={buttonVariants({ variant: "secondary" })}>
            {secondary.label}
          </Link>
        )}
      </div>
    </div>
  );
}
