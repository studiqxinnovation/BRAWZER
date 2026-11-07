"use client";

import { Input as BaseInput } from "@base-ui/react/input";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, useState } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";
import { inputClassName } from "./field";

export interface PasswordInputProps extends Omit<
  WithClassName<ComponentProps<typeof BaseInput>>,
  "type" | "autoComplete"
> {
  /** "current-password" to sign in; "new-password" when choosing one, so password managers can help. */
  autoComplete: "current-password" | "new-password";
}

/**
 * A password field with a show/hide toggle and a Caps Lock warning. The
 * password is hidden by default: on a shared computer, someone may be
 * looking over your shoulder. Use inside a <Field> with a <FieldLabel>.
 */
export function PasswordInput({
  className,
  autoComplete,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    // getModifierState is missing on some synthetic events (autofill).
    if (typeof event.getModifierState === "function") {
      setCapsLock(event.getModifierState("CapsLock"));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <BaseInput
          {...props}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(inputClassName, "pr-10 pointer-coarse:pr-12", className)}
          onKeyDown={(event) => {
            trackCapsLock(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            trackCapsLock(event);
            onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
        />
        <button
          type="button"
          aria-label="Show password"
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current);
          }}
          className={cn(
            "absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center rounded-r-md text-ink-secondary",
            "transition-colors duration-(--bw-duration-fast) ease-standard hover:text-ink",
            "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
            "pointer-coarse:w-11",
          )}
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      <p
        role="status"
        className={cn(
          capsLock ? "flex items-center gap-1.5 text-footnote text-warning" : "sr-only",
        )}
      >
        {capsLock && (
          <>
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            Caps Lock is on
          </>
        )}
      </p>
    </div>
  );
}
