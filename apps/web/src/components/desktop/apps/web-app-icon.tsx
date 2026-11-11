import { cn } from "@brawzer/ui/lib/cn";
import type { WebApp } from "./web-apps";

/** A web app's tile: its initial on its colour (not the site's logo). */
export function WebAppIcon({
  app,
  size = 44,
  className,
}: {
  app: WebApp;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("ap-icon ap-web-icon", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: app.colour,
        fontSize: Math.round(size * 0.46),
      }}
    >
      {app.name.charAt(0)}
    </span>
  );
}
