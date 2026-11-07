"use client";

import {
  type CreateProxyRequest,
  createProxyRequestSchema,
  type ProxyKind,
  proxyKinds,
  type ProxyProtocol,
  proxyProtocols,
  type ProxyRotation,
  proxyRotations,
  type SavedProxy,
  type UpdateProxyRequest,
  updateProxyRequestSchema,
} from "@brawzer/contracts";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { PasswordInput } from "@brawzer/ui/components/password-input";
import { Select } from "@brawzer/ui/components/select";
import { useState } from "react";
import {
  fromIssues,
  kindLabels,
  protocolLabels,
  proxyFieldErrors,
  rotationLabels,
} from "@/lib/proxies";

type CredentialsAction = "keep" | "replace" | "remove";

const text = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

const isAction = (value: unknown): value is CredentialsAction =>
  value === "keep" || value === "replace" || value === "remove";

type FormResult<T> = { ok: true; body: T } | { ok: false; errors: Record<string, string> };

/**
 * Reads the proxy form. The password field is never pre-filled: saved
 * credentials can be kept, replaced or removed, but never shown.
 */
function readFields(data: FormData, existing?: SavedProxy) {
  const username = text(data, "username");
  const password = text(data, "password");
  const chosen = data.get("credentialsAction");
  const action: CredentialsAction = isAction(chosen)
    ? chosen
    : existing?.hasCredentials
      ? "keep"
      : "replace";
  const fields = {
    name: data.get("name"),
    protocol: data.get("protocol"),
    host: data.get("host"),
    port: data.get("port"),
    kind: data.get("kind"),
    rotation: data.get("rotation"),
  };

  let credentials: { username: string; password: string } | null | undefined;
  if (action === "remove") {
    credentials = null;
  } else if (
    action === "replace" &&
    (username !== "" || password !== "" || existing?.hasCredentials)
  ) {
    credentials = { username, password };
  }

  return { fields, credentials };
}

export function readNewProxy(data: FormData): FormResult<CreateProxyRequest> {
  const { fields, credentials } = readFields(data);
  const parsed = createProxyRequestSchema.safeParse({
    ...fields,
    ...(credentials ? { credentials } : {}),
  });
  return parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, errors: proxyFieldErrors(fromIssues(parsed.error.issues)) };
}

export function readProxyChanges(
  data: FormData,
  existing: SavedProxy,
): FormResult<UpdateProxyRequest> {
  const { fields, credentials } = readFields(data, existing);
  const parsed = updateProxyRequestSchema.safeParse({
    ...fields,
    ...(credentials === undefined ? {} : { credentials }),
  });
  return parsed.success
    ? { ok: true, body: parsed.data }
    : { ok: false, errors: proxyFieldErrors(fromIssues(parsed.error.issues)) };
}

/** The fields of the add and edit dialogs. */
export function ProxyFields({
  proxy,
  errors,
  failure,
  sharedComputer,
}: {
  proxy?: SavedProxy;
  errors: Record<string, string>;
  failure: string | null;
  sharedComputer: boolean;
}) {
  const [action, setAction] = useState<CredentialsAction>(
    proxy?.hasCredentials ? "keep" : "replace",
  );

  return (
    <>
      {failure && <FormMessage tone="danger">{failure}</FormMessage>}

      <Field name="name" invalid={Boolean(errors.name)}>
        <FieldLabel>Name</FieldLabel>
        <Input name="name" defaultValue={proxy?.name} maxLength={40} autoComplete="off" required />
        {errors.name && <FieldError match>{errors.name}</FieldError>}
      </Field>

      <Select<ProxyProtocol>
        label="Protocol"
        name="protocol"
        defaultValue={proxy?.protocol ?? "socks5"}
        options={proxyProtocols.map((value) => ({ value, label: protocolLabels[value] }))}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <Field name="host" invalid={Boolean(errors.host)}>
          <FieldLabel>Host</FieldLabel>
          <Input
            name="host"
            defaultValue={proxy?.host}
            placeholder="proxy.example.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          {errors.host && <FieldError match>{errors.host}</FieldError>}
        </Field>
        <Field name="port" invalid={Boolean(errors.port)}>
          <FieldLabel>Port</FieldLabel>
          <Input
            name="port"
            defaultValue={proxy ? String(proxy.port) : undefined}
            inputMode="numeric"
            autoComplete="off"
            required
          />
          {errors.port && <FieldError match>{errors.port}</FieldError>}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select<ProxyKind>
          label="Type"
          name="kind"
          defaultValue={proxy?.kind ?? "unspecified"}
          options={proxyKinds.map((value) => ({ value, label: kindLabels[value] }))}
        />
        <Select<ProxyRotation>
          label="Address"
          name="rotation"
          defaultValue={proxy?.rotation ?? "unknown"}
          options={proxyRotations.map((value) => ({ value, label: rotationLabels[value] }))}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-callout font-medium text-ink">Username and password</legend>
        {proxy?.hasCredentials ? (
          <div className="flex flex-col gap-2">
            <p className="text-footnote text-ink-secondary">
              A username and password are saved. They’re encrypted and never shown again.
            </p>
            {(
              [
                ["keep", "Keep them"],
                ["replace", "Replace them"],
                ["remove", "Remove them"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2.5 text-callout text-ink">
                <input
                  type="radio"
                  name="credentialsAction"
                  value={value}
                  checked={action === value}
                  onChange={() => {
                    setAction(value);
                  }}
                  className="size-4 accent-accent"
                />
                {label}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-footnote text-ink-secondary">
            Optional. They’re encrypted on Brawzer’s servers and never shown again.
          </p>
        )}
        {action === "replace" && (
          <>
            <Field name="username" invalid={Boolean(errors.username)}>
              <FieldLabel>Username</FieldLabel>
              <Input name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} />
              {errors.username && <FieldError match>{errors.username}</FieldError>}
            </Field>
            <Field name="password" invalid={Boolean(errors.password)}>
              <FieldLabel>Password</FieldLabel>
              <PasswordInput name="password" autoComplete="new-password" />
              {sharedComputer && (
                <FieldDescription>
                  If the browser offers to save this password, choose Never on a computer you don’t
                  own.
                </FieldDescription>
              )}
              {errors.password && <FieldError match>{errors.password}</FieldError>}
            </Field>
          </>
        )}
      </fieldset>
    </>
  );
}
