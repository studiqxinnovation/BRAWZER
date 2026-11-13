"use client";

import { cn } from "@brawzer/ui/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useId } from "react";
import { adminNav, type AppNavGroup, type AppNavItem, appNav } from "@/content/app";

function isActive(item: AppNavItem, pathname: string): boolean {
  return item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
}

/** The signed-in navigation, shared by the sidebar and the phone menu. */
export function AppNav({
  label,
  admin,
  onNavigate,
}: {
  label: string;
  /** Whether to add the administration group; a promise keeps the shell from waiting on it. */
  admin?: Promise<boolean> | undefined;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const idPrefix = useId();

  return (
    <nav aria-label={label} className="flex flex-col gap-4">
      {appNav.map((group, index) => (
        <NavGroup
          key={group.label ?? `group-${String(index)}`}
          group={group}
          headingId={`${idPrefix}-group-${String(index)}`}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}
      {admin && (
        <Suspense fallback={null}>
          <AdminGroup
            admin={admin}
            headingId={`${idPrefix}-group-admin`}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </Suspense>
      )}
    </nav>
  );
}

/** Rendered once the session is known, without holding the rest of the shell back. */
function AdminGroup({
  admin,
  ...rest
}: {
  admin: Promise<boolean>;
  headingId: string;
  pathname: string;
  onNavigate?: (() => void) | undefined;
}) {
  if (!use(admin)) return null;
  return <NavGroup group={adminNav} {...rest} />;
}

function NavGroup({
  group,
  headingId,
  pathname,
  onNavigate,
}: {
  group: AppNavGroup;
  headingId: string;
  pathname: string;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <div>
      {group.label && (
        <p id={headingId} className="px-2.5 pb-1.5 text-caption font-medium text-ink-tertiary">
          {group.label}
        </p>
      )}
      <ul aria-labelledby={group.label ? headingId : undefined} className="flex flex-col gap-0.5">
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
}
