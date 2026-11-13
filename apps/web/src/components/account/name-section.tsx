"use client";

import { updateNameRequestSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { useToast } from "@brawzer/ui/components/toast";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";
import { updateName } from "@/lib/api/account";
import { fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";

/** The name on the account: shown, and changed in place. */
export function NameSection({ name }: { name: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(name === null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateNameRequestSchema.safeParse({
      name: new FormData(event.currentTarget).get("name"),
    });
    setFailure(null);
    if (!parsed.success) {
      setError(fieldErrorsFromIssues(parsed.error.issues).name ?? "Enter your name.");
      return;
    }
    setError(null);
    setPending(true);
    const result = await updateName(parsed.data.name);
    setPending(false);
    if (result.ok) {
      setEditing(false);
      toast.add({ type: "success", title: "Name saved" });
      router.refresh();
      return;
    }
    if (result.error.code === "validation_failed") {
      setError(fieldErrorsFromDetails(result.error.details).name ?? result.error.message);
    } else {
      setFailure(result.error.message);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-footnote text-ink-secondary">Name</p>
          <p className="truncate text-callout font-medium text-ink">{name}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditing(true);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <form method="post" noValidate onSubmit={handleSubmit} className="flex flex-col gap-3">
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}
      <Field name="name" invalid={Boolean(error)}>
        <FieldLabel>Name</FieldLabel>
        <Input name="name" defaultValue={name ?? ""} autoComplete="name" maxLength={80} required />
        {error && <FieldError match>{error}</FieldError>}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          Save
        </Button>
        {name !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
