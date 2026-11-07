"use client";

import { cn } from "@brawzer/ui/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { type AppNavItem, appNav } from "@/content/app";

function isActive(item: AppNavItem, pathname: string): boolean {
  return item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
}

/** The signed-in navigation, shared by the sidebar and the phone menu. */
export function AppNav({ label, onNavigate }: { label: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const idPrefix = useId();

  return (
    <nav aria-label={label} className="flex flex-col gap-4">
      {appNav.map((group, index) => {
        const headingId = `${idPrefix}-group-${String(index)}`;
        return (
          <div key={group.label ?? headingId}>
            {group.label && (
              <p
                id={headingId}
                className="px-2.5 pb-1.5 text-caption font-medium text-ink-tertiary"
              >
                {group.label}
              </p>
            )}
            <ul
              aria-labelledby={group.label ? headingId : undefined}
              className="flex flex-col gap-0.5"
            >
              {group.items.map((item) => {
                const active = isActive(item, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-callout transition-colors duration-(--bw-duration-fast) ease-standard",
                        "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                        "pointer-coarse:h-11",
                        active
                          ? "bg-hover font-medium text-ink"
                          : "text-ink-secondary hover:bg-hover hover:text-ink",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-accent-ink" : "text-ink-tertiary",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.status === "planned" && (
                        // Tertiary ink lacks contrast on the selected item's highlight.
                        <span
                          className={cn(
                            "text-caption",
                            active ? "text-ink-secondary" : "text-ink-tertiary",
                          )}
                        >
                          Planned
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
