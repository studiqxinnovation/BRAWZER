import { Skeleton } from "@brawzer/ui/components/skeleton";
import Link from "next/link";
import { getSession } from "@/lib/session";

export function AccountPanelSkeleton() {
  return (
    <div className="flex items-center gap-3 px-2.5 py-2">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

/** Who is signed in, and in which mode. Links to Account. */
export async function AccountPanel() {
  const state = await getSession();
  if (state.kind !== "ok") return null;
  const { account, session } = state.data;

  return (
    <Link
      href="/app/account"
      className="flex min-w-0 items-center gap-3 rounded-md px-2.5 py-2 transition-colors duration-(--bw-duration-fast) ease-standard outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-callout font-semibold text-accent-ink uppercase"
      >
        {(account.name ?? account.email).slice(0, 1)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-callout font-medium text-ink">
          {account.name ?? account.email}
        </span>
        <span className="truncate text-footnote text-ink-secondary">
          {session.persistent ? "Kept signed in" : "Shared-computer mode"}
        </span>
      </span>
    </Link>
  );
}
