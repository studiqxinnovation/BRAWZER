"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { CircleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";

/** Groups a label, control, description and error; wires up their ARIA relationships. */
export function Field({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseField.Root>>) {
  return <BaseField.Root className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

/**
 * Inside a Field, pass neither `htmlFor` here nor `id` to the control: the
 * Field links them, in the server's markup too. An explicit pair only meets
 * once the page's script has run, leaving the label unlinked until then.
 */
export function FieldLabel({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseField.Label>>) {
  return (
    <BaseField.Label className={cn("text-callout font-medium text-ink", className)} {...props} />
  );
}

export function FieldDescription({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseField.Description>>) {
  return (
    <BaseField.Description
      className={cn("text-footnote text-ink-secondary", className)}
      {...props}
    />
  );
}

export interface FieldErrorProps extends WithClassName<
  Omit<ComponentProps<typeof BaseField.Error>, "children">
> {
  /** Written for the person filling in the form: say what to do, not what went wrong. */
  children: string;
}

export function FieldError({ className, children, ...props }: FieldErrorProps) {
  return (
    <BaseField.Error
      className={cn("flex items-start gap-1.5 text-footnote text-danger", className)}
      {...props}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </BaseField.Error>
  );
}

export const inputClassName = cn(
  "h-9 w-full min-w-0 rounded-md border border-line-control bg-surface px-3 text-callout text-ink shadow-xs",
  "transition-[border-color,box-shadow] duration-(--bw-duration-fast) ease-standard outline-none",
  "placeholder:text-ink-tertiary",
  "focus:border-accent focus:shadow-[0_0_0_3px_var(--bw-accent-soft)]",
  "data-invalid:border-danger data-invalid:focus:shadow-[0_0_0_3px_var(--bw-danger-soft)]",
  "data-disabled:cursor-not-allowed data-disabled:opacity-60",
  // Touch screens: a 44 px target, and 16 px text so iOS doesn't zoom on focus.
  "pointer-coarse:h-11 pointer-coarse:text-[1rem]",
);

export function Input({ className, ...props }: WithClassName<ComponentProps<typeof BaseInput>>) {
  return <BaseInput className={cn(inputClassName, className)} {...props} />;
}
