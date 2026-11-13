"use client";

import { createSiteRuleRequestSchema, type SiteRule, type SiteRuleKind } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { useToast } from "@brawzer/ui/components/toast";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { Card, Empty, InfoHead, Panel, Pill } from "@/components/app-shell/page";
import { LocalDate } from "@/components/local-date";
import { createSiteRule, deleteSiteRule } from "@/lib/api/site-rules";
import { leaveSignedInArea } from "@/lib/session-channel";

const KIND_OPTIONS = [
  { value: "block", label: "Block" },
  { value: "allow", label: "Always allow" },
] as const;

function AddRule({ full }: { full: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [host, setHost] = useState("");
  const [kind, setKind] = useState<SiteRuleKind>("block");
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
    <Card label="Add a rule">
      <form method="post" noValidate onSubmit={submit} className="ad-form-row">
        <Field className="ad-grow">
          <FieldLabel className="sr-only">Website</FieldLabel>
          <Input
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
            aria-describedby={error ? "site-rule-error" : undefined}
            onChange={(event) => {
              setHost(event.target.value);
            }}
          />
        </Field>
        <Select
          label="Rule"
          hideLabel
          options={KIND_OPTIONS}
          value={kind}
          onValueChange={setKind}
          className="w-40"
        />
        <Button type="submit" variant="primary" loading={pending} disabled={full}>
          Add rule
        </Button>
      </form>
      {error && (
        <p id="site-rule-error" className="text-footnote text-danger">
          {error}
        </p>
      )}
      <p className="text-footnote text-ink-secondary">
        A blocked site never opens. Once you allow any site, only allowed sites open: handy for a
        child’s profile or a work-only computer. Each rule covers the site and everything under it,
        for sessions you start from then on.
      </p>
    </Card>
  );
}

function RemoveButton({ rule }: { rule: SiteRule }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
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
      Remove
    </Button>
  );
}

/** Site rules, as the prototype's: one form to add a rule, and one table of them. */
export function SiteRulesManager({ rules, limit }: { rules: readonly SiteRule[]; limit: number }) {
  const full = rules.length >= limit;
  const allowed = rules.filter((rule) => rule.kind === "allow").length;
  return (
    <div className="flex flex-col gap-[14px]">
      {full && (
        <FormMessage
          tone="info"
          title={`You have ${String(limit)} rules, the most an account can have`}
        >
          Remove one to add another.
        </FormMessage>
      )}
      <AddRule full={full} />
      <Panel>
        <InfoHead title="Rules">
          <span className="ad-info-count">
            {String(rules.length)} of {String(limit)} rules
            {allowed > 0 ? " · only allowed sites open" : " · every site may open"}
          </span>
        </InfoHead>
        {rules.length === 0 ? (
          <Empty>No rules yet. Add a website above; every site may open.</Empty>
        ) : (
          <table className="ad-table" aria-label="Site rules">
            <thead>
              <tr>
                <th scope="col">Website</th>
                <th scope="col">Rule</th>
                <th scope="col">Added</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="strong">{rule.host}</td>
                  <td>
                    <Pill tone={rule.kind === "block" ? "red" : "green"}>
                      {rule.kind === "block" ? "Blocked" : "Always allow"}
                    </Pill>
                  </td>
                  <td>
                    <LocalDate iso={rule.createdAt} />
                  </td>
                  <td className="text-right">
                    <RemoveButton rule={rule} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="text-footnote text-ink-tertiary">
        Rules are yours alone and never shared; the engine sees a refusal, not the list.
      </p>
    </div>
  );
}
