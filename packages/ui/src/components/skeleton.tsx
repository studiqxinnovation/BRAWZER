import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/** Placeholder shape while content loads. Decorative: announce loading elsewhere. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-bw-breathe rounded-md bg-hover", className)}
      {...props}
    />
  );
}
