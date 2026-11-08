"use client";

import { createSiteRuleRequestSchema, type SiteRule, type SiteRuleKind } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { EmptyState } from "@brawzer/ui/components/empty-state";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { useToast } from "@brawzer/ui/components/toast";
import { Ban, CircleCheck, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { Panel, SectionHeading } from "@/components/app-shell/page";
import { createSiteRule, deleteSiteRule } from "@/lib/api/site-rules";
import { leaveSignedInArea } from "@/lib/session-channel";

const KINDS: Record<SiteRuleKind, { title: string; intro: string; empty: string; add: string }> = {
  block: {
    title: "Blocked sites",
    intro: "These never open, whatever else is allowed.",
    empty: "No blocked sites.",
    add: "Block a site",
  },
  allow: {
    title: "Allowed sites",
    intro:
      "Leave this empty and every site may open. Add one, and only the sites listed here open: handy for a child’s profile or a work-only computer.",
    empty: "Every site may open.",
    add: "Allow a site",
  },
};

function AddRule({ kind, full }: { kind: SiteRuleKind; full: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createSiteRuleRequestSchema.safeParse({ kind, host });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a website’s host name.");
      return;
    }
    setError(null);
    setPending(true);
    const result = await createSiteRule(parsed.data);
    setPending(false);
    if (result.ok) {
      setHost("");
      toast.add({
        type: "success",
        title: `${kind === "block" ? "Blocked" : "Allowed"} ${result.data.host}`,
      });
      router.refresh();
      return;
    }
    if (result.status === 401) {
      leaveSignedInArea("expired");
      return;
    }
    const detail = result.error.details?.find((line) => line.startsWith("host: "));
    setError(detail ? detail.slice("host: ".length) : result.error.message);
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <Field className="flex-1">
        <FieldLabel htmlFor={`site-rule-${kind}`}>{KINDS[kind].add}</FieldLabel>
        <Input
          id={`site-rule-${kind}`}
          name="host"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="example.com"
          value={host}
          disabled={full}
          aria-invalid={error !== null}
          aria-describedby={error ? `site-rule-${kind}-error` : undefined}
          onChange={(event) => {
            setHost(event.target.value);
          }}
        />
        {error && (
          <p id={`site-rule-${kind}-error`} className="text-footnote text-danger">
            {error}
          </p>
        )}
      </Field>
      <Button
        type="submit"
        variant={kind === "block" ? "secondary" : "primary"}
        loading={pending}
        disabled={full}
      >
        <Plus aria-hidden="true" />
        {kind === "block" ? "Block" : "Allow"}
      </Button>
    </form>
  );
}

function RuleRow({ rule }: { rule: SiteRule }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const Icon = rule.kind === "block" ? Ban : CircleCheck;
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Icon
        aria-hidden="true"
        className={rule.kind === "block" ? "size-4 text-danger" : "size-4 text-success"}
      />
      <span className="min-w-0 flex-1 truncate text-callout text-ink">{rule.host}</span>
      <span className="hidden text-caption text-ink-tertiary sm:inline">
        and everything under it
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${rule.host} from ${rule.kind === "block" ? "blocked" : "allowed"} sites`}
        loading={pending}
        onClick={() => {
          setPending(true);
          void deleteSiteRule(rule.id).then((result) => {
            setPending(false);
            if (result.ok) {
              toast.add({ type: "success", title: `Removed ${rule.host}` });
              router.refresh();
            } else if (result.status === 401) {
              leaveSignedInArea("expired");
            } else {
              toast.add({
                type: "error",
                title: "Couldn’t remove the rule",
                description: result.error.message,
              });
            }
          });
        }}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

export function SiteRulesManager({ rules, limit }: { rules: readonly SiteRule[]; limit: number }) {
  const full = rules.length >= limit;
  return (
    <div className="flex flex-col gap-10">
      {full && (
        <FormMessage
          tone="info"
          title={`You have ${String(limit)} rules, the most an account can have`}
        >
          Remove one to add another.
        </FormMessage>
      )}
      {(["block", "allow"] as const).map((kind) => {
        const own = rules.filter((rule) => rule.kind === kind);
        return (
          <section
            key={kind}
            aria-labelledby={`site-rules-${kind}`}
            className="flex flex-col gap-4"
          >
            <div>
              <SectionHeading id={`site-rules-${kind}`}>{KINDS[kind].title}</SectionHeading>
              <p className="mt-1 text-footnote text-ink-secondary">{KINDS[kind].intro}</p>
            </div>
            <Panel className="p-5">
              <AddRule kind={kind} full={full} />
            </Panel>
            {own.length === 0 ? (
              <EmptyState title={KINDS[kind].empty} />
            ) : (
              <Panel>
                <ul aria-label={KINDS[kind].title} className="divide-y divide-line">
                  {own.map((rule) => (
                    <RuleRow key={rule.id} rule={rule} />
                  ))}
                </ul>
              </Panel>
            )}
          </section>
        );
      })}
      <p className="text-footnote text-ink-tertiary">
        {String(rules.length)} of {String(limit)} rules. Rules are yours alone and never shared; the
        engine sees a refusal, not the list.
      </p>
    </div>
  );
}
