import { cn } from "@brawzer/ui/lib/cn";

/** A profile's coloured initial. Decorative: the name is always shown next to it. */
export function ProfileAvatar({
  initial,
  color,
  size = "md",
}: {
  initial: string;
  color: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "md" ? "size-9 text-callout" : "size-6 text-caption",
      )}
      style={{ backgroundColor: color }}
    >
      {initial}
    </span>
  );
}
