"use client";

import { cn } from "@brawzer/ui/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryNav } from "@/content/site";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop navigation with the current page marked for assistive technology. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-0.5">
      {primaryNav.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-callout text-ink-secondary transition-colors duration-(--bw-duration-fast) hover:text-ink",
                active && "font-medium text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
