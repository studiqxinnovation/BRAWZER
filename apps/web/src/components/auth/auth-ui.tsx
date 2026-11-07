"use client";

import { Checkbox } from "@brawzer/ui/components/checkbox";
import { cn } from "@brawzer/ui/lib/cn";
import Link from "next/link";
import { type ComponentProps, type ReactNode, type RefObject, useId } from "react";

export const textLinkClassName =
  "rounded-sm font-medium text-accent-ink underline-offset-4 hover:underline";

export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cn(textLinkClassName, className)} {...props} />;
}

/**
 * The page heading of an auth step. When the step changes (form → "check
 * your email"), focus moves here so screen readers announce the new state.
 */
export function AuthHeading({
  title,
  children,
  headingRef,
}: {
  title: string;
  children?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-title-2 text-balance text-ink outline-none"
      >
        {title}
      </h1>
      {children && (
        <div className="mt-2 text-callout text-pretty text-ink-secondary">{children}</div>
      )}
    </div>
  );
}

/** "Keep me signed in": off by default, because Brawzer is built for computers people don't own. */
export function KeepSignedIn({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex cursor-pointer items-start gap-3 self-start">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-describedby={descriptionId}
        />
        <span className="text-callout font-medium text-ink">Keep me signed in on this device</span>
      </label>
      {/* Indented to line up with the label text (checkbox width + gap). */}
      <p id={descriptionId} className="pl-7 text-footnote text-ink-secondary pointer-coarse:pl-8">
        Only on your own computer. Otherwise you’re signed out when the browser closes, or after 30
        minutes without activity.
      </p>
    </div>
  );
}

/** Development only: where to read emails that Brawzer sends locally. */
export function DevMailboxHint() {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <p className="rounded-md border border-dashed border-line-strong px-3 py-2 text-footnote text-ink-secondary">
      Development: emails go to the local Mailpit inbox at{" "}
      <a
        href="http://localhost:8125"
        target="_blank"
        rel="noreferrer"
        className={textLinkClassName}
      >
        localhost:8125
      </a>
      , not to real addresses.
    </p>
  );
}

/** Moves focus to the first field marked invalid, after React has rendered the errors. */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}
