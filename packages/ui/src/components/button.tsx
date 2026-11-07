"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentProps } from "react";
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
  return (
    <BaseButton
      {...props}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      focusableWhenDisabled={loading || focusableWhenDisabled}
      aria-busy={loading || undefined}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center gap-[inherit]",
          loading && "invisible",
        )}
      >
        {children}
      </span>
      {loading && <Spinner className="absolute inset-0 m-auto" />}
    </BaseButton>
  );
}
