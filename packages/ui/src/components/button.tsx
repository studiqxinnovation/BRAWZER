"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { cloneElement, type ComponentProps, isValidElement, type ReactNode } from "react";
import { type ButtonVariantProps, buttonVariants } from "../lib/button-variants";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";
import { Spinner } from "./spinner";

export { buttonVariants };

export interface ButtonProps
  extends WithClassName<ComponentProps<typeof BaseButton>>, ButtonVariantProps {
  /**
   * Shows a spinner, announces the busy state and ignores activation, while
   * keeping the button focusable so keyboard users don't lose their place.
   */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled = false,
  focusableWhenDisabled,
  children,
  ...props
}: ButtonProps) {
  const { render, ...rest } = props;
  if (
    isValidElement<{ className?: string; children?: ReactNode }>(render) &&
    render.type !== "button"
  ) {
    // A link that looks like a button stays a link: Base UI's button would
    // announce it as a button (role="button"), and links aren't disabled.
    return cloneElement(render, {
      ...(rest as Record<string, unknown>),
      className: cn(buttonVariants({ variant, size }), className, render.props.className),
      children: (
        <span className="inline-flex items-center justify-center gap-[inherit]">{children}</span>
      ),
    });
  }
  return (
    <BaseButton
      {...props}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      focusableWhenDisabled={loading || focusableWhenDisabled}
      aria-busy={loading || undefined}
    >
      {/* Transparent, not hidden, while loading: the label stays the button's accessible name. */}
      <span
        className={cn(
          "inline-flex items-center justify-center gap-[inherit]",
          loading && "opacity-0",
        )}
      >
        {children}
      </span>
      {loading && <Spinner className="absolute inset-0 m-auto" />}
    </BaseButton>
  );
}
