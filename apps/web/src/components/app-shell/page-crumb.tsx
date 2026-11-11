"use client";

import { usePathname } from "next/navigation";
import { appNav } from "@/content/app";

/**
 * The menu a page is in ("Browse", "Protect", "Account"), above its title on
 * the desktop, as the prototype's page heads have it. The classic layout's
 * sidebar already shows it, so it's hidden there.
 */
export function PageCrumb() {
  const pathname = usePathname();
  const group = appNav.find((candidate) =>
    candidate.items.some((item) =>
      item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href),
    ),
  )?.label;
  if (!group) return null;
  return (
    <p className="ad-crumb" aria-hidden="true">
      {group}
    </p>
  );
}
