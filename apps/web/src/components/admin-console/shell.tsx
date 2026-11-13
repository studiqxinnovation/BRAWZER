"use client";

import {
  adminPages,
  canSee,
  homeOf,
  type StaffRole,
  staffRoleDescriptions,
  staffRoleNames,
} from "@brawzer/contracts";
import { Logo } from "@brawzer/ui/brand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import {
  Bell,
  Building2,
  ChartColumn,
  Gauge,
  KeyRound,
  List,
  Search,
  Settings2,
  Users,
  X,
  BookOpen,
  Inbox,
  Megaphone,
  TriangleAlert,
  LifeBuoy,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { fetchCustomers, fetchOrganisations } from "@/lib/api/console";
import { Avatar } from "./ui";

export interface Staff {
  id: string;
  email: string;
  role: StaffRole;
}

const StaffContext = createContext<Staff | null>(null);

/** The signed-in member of staff, for every console page. */
export function useStaff(): Staff {
  const staff = useContext(StaffContext);
  if (!staff) throw new Error("useStaff needs the console shell");
  return staff;
}

const ICONS: Record<string, typeof Gauge> = {
  overview: Gauge,
  growth: ChartColumn,
  team: KeyRound,
  settings: Settings2,
  customers: Users,
  orgs: Building2,
  audit: List,
  inbox: Inbox,
  replies: BookOpen,
  carestats: ChartColumn,
  recovery: LifeBuoy,
  announce: Megaphone,
  incidents: TriangleAlert,
};

/** Which page a path is on, for the title and the sidebar. */
function pageKeyOf(pathname: string): string {
  const rest = pathname.replace(/^\/admin\/?/, "");
  const first = rest.split("/")[0] ?? "";
  if (first === "") return "overview";
  return adminPages.find((page) => page.path === first)?.key ?? first;
}

const EXTRA_TITLES: Record<string, string> = { customer: "Customer", org: "Organisation" };

export interface Alert {
  text: string;
  detail: string;
  page: string;
}

const AlertsContext = createContext<{ alerts: Alert[]; setAlerts: (alerts: Alert[]) => void }>({
  alerts: [],
  setAlerts: () => undefined,
});

/** Pages hand the bell what needs attention. */
export const useAlerts = () => useContext(AlertsContext);

/** The console's shell: the prototype's sidebar, top bar, search and alerts. */
export function AdminShell({ staff, children }: { staff: Staff; children: ReactNode }) {
  const pathname = usePathname();
  const key = pageKeyOf(pathname);
  const current = adminPages.find((page) => page.key === key);
  const title =
    current?.title ??
    (pathname.startsWith("/admin/customers/")
      ? EXTRA_TITLES.customer
      : pathname.startsWith("/admin/orgs/")
        ? EXTRA_TITLES.org
        : "Admin");
  const sidebarKey = pathname.startsWith("/admin/customers/")
    ? "customers"
    : pathname.startsWith("/admin/orgs/")
      ? "orgs"
      : key;
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const groups = useMemo(() => {
    const seen = new Map<string, typeof adminPages>();
    for (const page of adminPages) {
      if (!canSee(staff.role, page.key)) continue;
      seen.set(page.group, [...(seen.get(page.group) ?? []), page]);
    }
    return [...seen.entries()];
  }, [staff.role]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const alertsContext = useMemo(() => ({ alerts, setAlerts }), [alerts]);

  return (
    <StaffContext.Provider value={staff}>
      <AlertsContext.Provider value={alertsContext}>
        <div className="adm" data-theme="light">
          <aside className="adm-aside">
            <div className="adm-brand">
              <Link href="/admin" aria-label="Brawzer admin home" className="inline-flex">
                <Logo size={22} />
              </Link>
              <span>Brawzer</span>
              <small>Admin</small>
            </div>
            <div className="adm-role" aria-label="Signed in as">
              <Avatar name={staff.email} size={30} />
              <div>
                <b title={staff.email}>{staff.email}</b>
                <span>
                  {staffRoleNames[staff.role]} · {staffRoleDescriptions[staff.role]}
                </span>
              </div>
            </div>
            <nav className="adm-nav" aria-label="Console">
              {groups.map(([group, pages]) => (
                <div key={group}>
                  <div className="adm-nav-h">{group}</div>
                  {pages.map((page) => {
                    const Icon = ICONS[page.key] ?? List;
                    return (
                      <Link
                        key={page.key}
                        href={`/admin/${page.path}` as never}
                        aria-current={page.key === sidebarKey ? "page" : undefined}
                      >
                        <Icon aria-hidden="true" />
                        {page.title}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="adm-side-foot">
              Every staff action goes to the audit log.
              <Link href="/app">Back to Brawzer</Link>
            </div>
          </aside>
          <main className="adm-main" id="main-content">
            <div className="adm-top">
              <h1>{title}</h1>
              <button
                type="button"
                className="adm-search"
                onClick={() => {
                  setSearchOpen(true);
                }}
              >
                <Search aria-hidden="true" width={15} height={15} />
                Search customers, orgs, pages
                <kbd aria-hidden="true">⌘K</kbd>
              </button>
              <button
                type="button"
                className="adm-ib"
                aria-label={alerts.length ? `Alerts, ${String(alerts.length)}` : "Alerts"}
                onClick={() => {
                  setAlertsOpen(true);
                }}
              >
                <Bell aria-hidden="true" width={17} height={17} />
                {alerts.length > 0 && <span className="dot" aria-hidden="true" />}
              </button>
            </div>
            <div className="adm-view">{children}</div>
          </main>
          <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} role={staff.role} />
          <AlertsDrawer
            open={alertsOpen}
            onOpenChange={setAlertsOpen}
            alerts={alerts}
            role={staff.role}
          />
        </div>
      </AlertsContext.Provider>
    </StaffContext.Provider>
  );
}

interface Hit {
  icon: typeof Gauge;
  text: string;
  sub: string;
  href: string;
}

function SearchPalette({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: StaffRole;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<{ q: string; hits: Hit[] }>({ q: "", hits: [] });
  const [selected, setSelected] = useState(0);
  const q = query.trim().toLowerCase();

  const pageHits = useMemo(
    (): Hit[] =>
      adminPages
        .filter((page) => canSee(role, page.key) && (!q || page.title.toLowerCase().includes(q)))
        .map((page) => ({
          icon: ICONS[page.key] ?? List,
          text: page.title,
          sub: "Page",
          href: `/admin/${page.path}`,
        })),
    [role, q],
  );

  useEffect(() => {
    if (!open || !q || !canSee(role, "customers")) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all([fetchCustomers({ q }), fetchOrganisations()]).then(
        ([customers, organisations]) => {
          if (cancelled) return;
          const found: Hit[] = [];
          if (customers.ok) {
            for (const customer of customers.data.customers.slice(0, 7)) {
              found.push({
                icon: Users,
                text: customer.email,
                sub: `${customer.id.slice(0, 8)} · ${customer.planName}`,
                href: `/admin/customers/${customer.id}`,
              });
            }
          }
          if (organisations.ok) {
            for (const org of organisations.data.organisations
              .filter((o) => o.name.toLowerCase().includes(q))
              .slice(0, 4)) {
              found.push({
                icon: Building2,
                text: org.name,
                sub: `${String(org.members)} members`,
                href: `/admin/orgs/${org.id}`,
              });
            }
          }
          setRemote({ q, hits: found });
        },
      );
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, q, role]);

  const hits = [...pageHits, ...(remote.q === q ? remote.hits : [])].slice(0, 16);
  const go = (hit: Hit) => {
    onOpenChange(false);
    setQuery("");
    router.push(hit.href as Parameters<typeof router.push>[0]);
  };
  const optionId = (index: number) => `adm-cmdk-option-${String(index)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="adm-cmdk p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Customers, organisations and pages, found by typing.
        </DialogDescription>
        <input
          role="combobox"
          aria-label="Search customers, organisations and pages"
          aria-expanded="true"
          aria-controls="adm-cmdk-results"
          aria-activedescendant={hits[selected] ? optionId(selected) : undefined}
          aria-autocomplete="list"
          placeholder="Search customers, emails, organisations, pages…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((current) => Math.min(current + 1, hits.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              const hit = hits[selected];
              if (hit) go(hit);
            }
          }}
        />
        <div className="res" id="adm-cmdk-results" role="listbox" aria-label="Results">
          {hits.length === 0 ? (
            <div className="empty">No results</div>
          ) : (
            hits.map((hit, index) => {
              const Icon = hit.icon;
              return (
                <button
                  key={hit.href + hit.text}
                  type="button"
                  className="it"
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === selected}
                  tabIndex={-1}
                  onClick={() => {
                    go(hit);
                  }}
                >
                  <Icon aria-hidden="true" width={16} height={16} />
                  <span>{hit.text}</span>
                  <span className="muted sm" style={{ marginLeft: "auto" }}>
                    {hit.sub}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AlertsDrawer({
  open,
  onOpenChange,
  alerts,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alerts: Alert[];
  role: StaffRole;
}) {
  const router = useRouter();
  const visible = alerts.filter((alert) => canSee(role, alert.page));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="adm-modal w-[min(560px,96vw)]">
        <div className="row">
          <DialogTitle>Alerts for {staffRoleNames[role]}</DialogTitle>
          <button
            type="button"
            className="adm-ib"
            style={{ marginLeft: "auto" }}
            aria-label="Close"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            <X aria-hidden="true" width={16} height={16} />
          </button>
        </div>
        <DialogDescription className="sr-only">What needs attention now.</DialogDescription>
        {visible.length === 0 ? (
          <div className="empty">You’re all caught up</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {visible.map((alert) => (
              <li key={alert.text + alert.page} className="list-i">
                <button
                  type="button"
                  className="row"
                  style={{
                    background: "none",
                    border: 0,
                    textAlign: "left",
                    width: "100%",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  onClick={() => {
                    onOpenChange(false);
                    const page = adminPages.find((p) => p.key === alert.page);
                    router.push(`/admin/${page?.path ?? ""}` as Parameters<typeof router.push>[0]);
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div>{alert.text}</div>
                    <div className="muted sm">{alert.detail}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Where a role lands: `/admin` for the founder, its first page for others. */
export const homePath = (role: StaffRole) => `/admin/${homeOf(role)}`;
