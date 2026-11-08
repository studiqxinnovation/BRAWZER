"use client";

import {
  type AdminAccount,
  type AdminAccountSummary,
  adminSetPlanRequestSchema,
  type Plan,
} from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { Spinner } from "@brawzer/ui/components/spinner";
import { useToast } from "@brawzer/ui/components/toast";
import { type SubmitEvent, useEffect, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Panel } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { fetchAdminAccount, listAccounts, setAccountPlan } from "@/lib/api/billing";
import { fieldErrorsFromIssues } from "@/lib/api/client";
import { describeLimits } from "@/lib/plans";
import { leaveSignedInArea } from "@/lib/session-channel";

function SourceBadge({ source }: { source: AdminAccountSummary["source"] }) {
  if (source === "free") return null;
  return <Badge tone="neutral">{source === "stripe" ? "Subscription" : "Set by hand"}</Badge>;
}

/** Looks accounts up and opens one. */
export function AdminAccounts({ plans }: { plans: readonly Plan[] }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    key: string;
    accounts: AdminAccountSummary[];
    nextCursor: string | null;
    error: string | null;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const key = query.trim();
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void listAccounts({ q: key || undefined }).then((response) => {
          if (cancelled) return;
          if (response.status === 401) {
            leaveSignedInArea("expired");
            return;
          }
          setResult(
            response.ok
              ? { key, ...response.data, error: null }
              : { key, accounts: [], nextCursor: null, error: response.error.message },
          );
        });
      },
      key ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  async function more() {
    if (!current?.nextCursor) return;
    const response = await listAccounts({ q: key || undefined, before: current.nextCursor });
    if (!response.ok) return;
    setResult({
      key,
      accounts: [...current.accounts, ...response.data.accounts],
      nextCursor: response.data.nextCursor,
      error: null,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        name="q"
        aria-label="Search accounts by email"
        placeholder="Search by email address"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <Panel>
        {!current && (
          <div className="flex items-center justify-center gap-2 p-6 text-footnote text-ink-secondary">
            <Spinner className="size-4" /> Loading accounts…
          </div>
        )}
        {current?.error && <p className="p-4 text-footnote text-danger">{current.error}</p>}
        {current && !current.error && current.accounts.length === 0 && (
          <p className="p-4 text-footnote text-ink-secondary">No accounts match.</p>
        )}
        {current && current.accounts.length > 0 && (
          <ul aria-label="Accounts" className="divide-y divide-line">
            {current.accounts.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-hover sm:px-5"
                  onClick={() => {
                    setSelected(account.id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-callout text-ink">
                    {account.email}
                  </span>
                  {account.role === "admin" && <Badge tone="neutral">Admin</Badge>}
                  <span className="text-footnote text-ink-secondary">{account.planCode}</span>
                  <SourceBadge source={account.source} />
                  <span className="text-footnote text-ink-tertiary">
                    joined <LocalDate iso={account.createdAt} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {current?.nextCursor && (
          <div className="border-t border-line p-3">
            <Button variant="secondary" size="sm" onClick={() => void more()}>
              Show more
            </Button>
          </div>
        )}
      </Panel>
      <AccountDialog
        id={selected}
        plans={plans}
        onClose={() => {
          setSelected(null);
        }}
        onChanged={(account) => {
          setResult((previous) =>
            previous
              ? {
                  ...previous,
                  accounts: previous.accounts.map((candidate) =>
                    candidate.id === account.id ? { ...candidate, ...account } : candidate,
                  ),
                }
              : previous,
          );
        }}
      />
    </div>
  );
}

function AccountDialog({
  id,
  plans,
  onClose,
  onChanged,
}: {
  id: string | null;
  plans: readonly Plan[];
  onClose: () => void;
  onChanged: (account: AdminAccount) => void;
}) {
  const toast = useToast();
  const confirmed = useConfirmedRequest();
  // The loaded account is keyed by its id, so another id reads as "loading" without a reset.
  const [loaded, setLoaded] = useState<{ id: string; account: AdminAccount } | null>(null);
  const account = loaded?.id === id ? loaded.account : null;
  const [planCode, setPlanCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void fetchAdminAccount(id).then((response) => {
      if (cancelled) return;
      if (response.ok) {
        setLoaded({ id, account: response.data });
        setPlanCode(response.data.source === "admin" ? response.data.planCode : "free");
      } else {
        toast.add({
          type: "error",
          title: "Couldn’t open the account",
          description: response.error.message,
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // The toast manager is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    const data = new FormData(event.currentTarget);
    const parsed = adminSetPlanRequestSchema.safeParse({ planCode, reason: data.get("reason") });
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      return;
    }
    setErrors({});
    setPending(true);
    const result = await confirmed(() => setAccountPlan(account.id, parsed.data));
    setPending(false);
    if (result.ok) {
      setLoaded({ id: account.id, account: result.data });
      onChanged(result.data);
      toast.add({ type: "success", title: `Plan of ${account.email} set` });
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else if (result.error.code !== "reauthentication_required") {
      toast.add({
        type: "error",
        title: "Couldn’t set the plan",
        description: result.error.message,
      });
    }
  }

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{account?.email ?? "Account"}</DialogTitle>
        <DialogDescription>
          {account
            ? `${account.planCode} plan${account.source === "stripe" ? " by subscription" : account.source === "admin" ? ", set by hand" : ""} · ${String(account.activeSessions)} signed-in ${account.activeSessions === 1 ? "device" : "devices"}`
            : "Loading…"}
        </DialogDescription>
        {account && (
          <div className="mt-4 flex flex-col gap-4">
            {account.planNote && (
              <FormMessage tone="info" title="Why the plan was set by hand">
                {account.planNote}
              </FormMessage>
            )}
            <dl className="grid gap-2 sm:grid-cols-2" aria-label="Usage against the plan">
              {describeLimits(account.limits, account.usage).map((row) => (
                <div key={row.label} className="rounded-lg border border-line px-3 py-2">
                  <dt className="text-caption text-ink-secondary">{row.label}</dt>
                  <dd className="text-footnote text-ink">
                    {row.used !== null ? `${row.used} of ${row.allowed}` : row.allowed}
                  </dd>
                </div>
              ))}
            </dl>
            <form method="post" onSubmit={submit} className="flex flex-col gap-4">
              <Select
                label="Plan"
                options={[
                  { value: "free", label: "Free, or whatever the subscription grants" },
                  ...plans
                    .filter((plan) => plan.code !== "free")
                    .map((plan) => ({ value: plan.code, label: `${plan.name} (set by hand)` })),
                ]}
                value={planCode}
                onValueChange={setPlanCode}
              />
              <Field>
                <FieldLabel>Reason</FieldLabel>
                <Input
                  name="reason"
                  autoComplete="off"
                  placeholder="Why this account gets this plan"
                />
                {errors.reason && <p className="text-footnote text-danger">{errors.reason}</p>}
              </Field>
              <DialogFooter>
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
                <Button type="submit" variant="primary" loading={pending}>
                  Set plan
                </Button>
              </DialogFooter>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
