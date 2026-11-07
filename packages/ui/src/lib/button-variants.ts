import { cva, type VariantProps } from "class-variance-authority";

/**
 * Button styles, kept in a plain module so server components can style links
 * as buttons (`<Link className={buttonVariants(...)}>`) without importing the
 * client-only Button component.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,box-shadow,scale] duration-(--bw-duration-fast) ease-standard",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "active:not-data-disabled:scale-[0.98]",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent shadow-xs hover:not-data-disabled:bg-accent-hover",
        secondary:
          "border border-line-strong bg-surface text-ink shadow-xs hover:not-data-disabled:bg-canvas-subtle",
        ghost: "text-ink hover:not-data-disabled:bg-hover active:not-data-disabled:bg-pressed",
        danger: "bg-danger-fill text-on-accent shadow-xs hover:not-data-disabled:brightness-[0.94]",
      },
      size: {
        sm: "h-8 px-3 text-footnote [&_svg]:size-3.5",
        md: "h-9 px-3.5 text-callout [&_svg]:size-4",
        lg: "h-11 px-5 text-body [&_svg]:size-[1.125rem]",
        icon: "size-9 [&_svg]:size-[1.125rem]",
        "icon-sm": "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
