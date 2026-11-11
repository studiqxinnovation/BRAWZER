"use client";

import {
  type BrowserEngine,
  createProfileRequestSchema,
  type Profile,
  type ProfileColor,
  profileColors,
  engineDetails,
  updateProfileRequestSchema,
} from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@brawzer/ui/components/dialog";
import { Field, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { useToast } from "@brawzer/ui/components/toast";
import { Switch } from "@brawzer/ui/components/switch";
import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useRef, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Card, InfoHead, Panel, Pill, Row } from "@/components/app-shell/page";
import { focusFirstInvalid } from "@/components/auth/auth-ui";
import { LocalDate } from "@/components/local-date";
import { type ApiResult, fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import {
  clearProfileData,
  createProfile,
  deleteProfile,
  reorderProfiles,
  updateProfile,
} from "@/lib/api/profiles";
import { useLaunchBrowser } from "@/lib/browser/use-launch";
import { formatBytes } from "@/lib/drive";
import { initialOf, profileColorShades } from "@/lib/profiles";
import { leaveSignedInArea } from "@/lib/session-channel";
import { ProfileNameAndColor } from "./profile-fields";

/** What a failed save means for the form: field errors, a message, or signing in again. */
function handleFailure(
  result: Extract<ApiResult<unknown>, { ok: false }>,
  setErrors: (errors: Record<string, string>) => void,
  setFailure: (message: string) => void,
): boolean {
  if (result.status === 401) {
    leaveSignedInArea("expired");
    return false;
  }
  const fields = fieldErrorsFromDetails(result.error.details);
  if (Object.keys(fields).length > 0) {
    setErrors(fields);
    return true;
  }
  setFailure(result.error.message);
  return false;
}

function NewProfile({
  suggestedColor,
  engines,
}: {
  suggestedColor: ProfileColor;
  engines: readonly BrowserEngine[];
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<BrowserEngine>(engines[0] ?? "bee");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // The colour is picked for you (one no profile uses yet); Edit changes it.
    const parsed = createProfileRequestSchema.safeParse({ name, color: suggestedColor, engine });
    setFailure(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await createProfile(parsed.data);
    setPending(false);
    if (result.ok) {
      setName("");
      toast.add({ type: "success", title: `Created “${result.data.name}”` });
      router.refresh();
    } else if (handleFailure(result, setErrors, setFailure)) {
      focusFirstInvalid(formRef.current);
    }
  }

  return (
    <Card label="New profile" className="mb-[14px]">
      <form method="post" ref={formRef} noValidate onSubmit={handleSubmit}>
        <div className="ad-form-row">
          <Field name="name" invalid={Boolean(errors.name)} className="ad-grow">
            <FieldLabel className="sr-only">Name</FieldLabel>
            <Input
              name="name"
              value={name}
              maxLength={40}
              autoComplete="off"
              placeholder="Work, Shopping, Banking…"
              required
              onChange={(event) => {
                setName(event.target.value);
                setErrors({});
              }}
            />
          </Field>
          <Select
            label="Browser"
            hideLabel
            name="engine"
            value={engine}
            onValueChange={setEngine}
            options={engines.map((option) => ({
              value: option,
              label: engineDetails[option].name,
            }))}
          />
          <Button type="submit" variant="primary" loading={pending}>
            Create profile
          </Button>
        </div>
        {errors.name && (
          <p className="mt-2 text-footnote text-danger" role="alert">
            {errors.name}
          </p>
        )}
        {errors.engine && <p className="mt-2 text-footnote text-danger">{errors.engine}</p>}
        {failure && (
          <FormMessage tone="danger" className="mt-3">
            {failure}
          </FormMessage>
        )}
      </form>
    </Card>
  );
}

interface ProxyChoice {
  id: string;
  name: string;
}

const NO_PROXY = "none";

function EditProfile({ profile, proxies }: { profile: Profile; proxies: readonly ProxyChoice[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [keepData, setKeepData] = useState(profile.keepData);
  const [browserAccount, setBrowserAccount] = useState(profile.browserAccount);
  const [privateThroughProxy, setPrivateThroughProxy] = useState(profile.privateThroughProxy);
  const [proxyChoice, setProxyChoice] = useState(profile.proxyId ?? NO_PROXY);
  const confirmed = useConfirmedRequest();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Fresh from the profile each time it opens (it may have changed since), and clean on close.
    setErrors({});
    setFailure(null);
    setKeepData(profile.keepData);
    setBrowserAccount(profile.browserAccount);
    setPrivateThroughProxy(profile.privateThroughProxy);
    setProxyChoice(profile.proxyId ?? NO_PROXY);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const proxyChoice = data.get("proxyId");
    const parsed = updateProfileRequestSchema.safeParse({
      name: data.get("name"),
      color: data.get("color"),
      ...(proxyChoice === null ? {} : { proxyId: proxyChoice === NO_PROXY ? null : proxyChoice }),
      keepData,
      // Sent only when it changes: changing it asks the person to confirm it's them.
      ...(browserAccount !== profile.browserAccount ? { browserAccount } : {}),
      // Only meaningful with a proxy; dropping the proxy switches it off.
      privateThroughProxy: proxyChoice !== null && proxyChoice !== NO_PROXY && privateThroughProxy,
    });
    setFailure(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await confirmed(() => updateProfile(profile.id, parsed.data));
    setPending(false);
    if (result.ok) {
      handleOpenChange(false);
      router.refresh();
    } else if (handleFailure(result, setErrors, setFailure)) {
      focusFirstInvalid(formRef.current);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Edit<span className="sr-only"> {profile.name}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit “{profile.name}”</DialogTitle>
        <form
          method="post"
          ref={formRef}
          noValidate
          onSubmit={handleSubmit}
          className="mt-5 flex flex-col gap-5"
        >
          {failure && <FormMessage tone="danger">{failure}</FormMessage>}
          <ProfileNameAndColor name={profile.name} color={profile.color} errors={errors} />
          {proxies.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Select
                label="Proxy"
                name="proxyId"
                value={proxyChoice}
                onValueChange={setProxyChoice}
                options={[
                  { value: NO_PROXY, label: "No proxy" },
                  ...proxies.map((proxy) => ({ value: proxy.id, label: proxy.name })),
                ]}
              />
              <p className="text-footnote text-ink-secondary">
                Every connection of this profile’s sessions goes through it. Changing it asks you to
                confirm it’s you.
              </p>
              {errors.proxyId && <p className="text-footnote text-danger">{errors.proxyId}</p>}
            </div>
          ) : (
            <p className="text-footnote text-ink-secondary">
              To give this profile a proxy, add one on the Proxy page first.
            </p>
          )}
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-callout font-medium text-ink">
                Keep browsing data between sessions
              </span>
              <span className="block text-footnote text-ink-secondary">
                Cookies, history, sign-ins and site data are saved encrypted when a session ends and
                restored next time. Off: every session starts clean.
              </span>
            </span>
            <Switch
              aria-label="Keep browsing data between sessions"
              checked={keepData}
              onCheckedChange={setKeepData}
            />
          </label>
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-callout font-medium text-ink">
                Browser account and saved passwords
              </span>
              <span className="block text-footnote text-ink-secondary">
                Turns on {engineDetails[profile.engine].name}’s own password manager
                {engineDetails[profile.engine].account
                  ? `, and signing in to your ${engineDetails[profile.engine].account} account so the passwords you saved there sync in (${engineDetails[profile.engine].account} syncs them under its own terms)`
                  : ""}
                . They’re kept with this profile’s data, encrypted. Needs the data kept. Changing it
                asks you to confirm it’s you.
              </span>
            </span>
            <Switch
              aria-label="Browser account and saved passwords"
              checked={browserAccount && keepData}
              disabled={!keepData}
              onCheckedChange={setBrowserAccount}
            />
          </label>
          {proxies.length > 0 && proxyChoice !== NO_PROXY && (
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-callout font-medium text-ink">
                  Reach private addresses through the proxy
                </span>
                <span className="block text-footnote text-ink-secondary">
                  Intranet sites and devices on the proxy’s own network become reachable: Brawzer
                  hands those addresses to the proxy instead of refusing them, and never connects to
                  them itself. Off, every private address is refused. Changing it asks you to
                  confirm it’s you.
                </span>
              </span>
              <Switch checked={privateThroughProxy} onCheckedChange={setPrivateThroughProxy} />
            </label>
          )}
          <DialogFooter className="mt-1">
            <Button
              variant="secondary"
              onClick={() => {
                handleOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProfile({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    const result = await deleteProfile(profile.id);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.add({ type: "success", title: `Deleted “${profile.name}”` });
      router.refresh();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t delete the profile",
        description: result.error.message,
      });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Delete<span className="sr-only"> {profile.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete “{profile.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {profile.data
            ? `Its saved browsing data (${formatBytes(profile.data.bytes)} of cookies, history and site data) is deleted with it.`
            : "Its name and colour are removed. It holds no saved browsing data."}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="danger" loading={pending} onClick={() => void remove()}>
            Delete profile
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ClearProfileData({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function clear() {
    setPending(true);
    const result = await clearProfileData(profile.id);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.add({ type: "success", title: `Cleared the browsing data of “${profile.name}”` });
      router.refresh();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t clear the browsing data",
        description: result.error.message,
      });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Clear data<span className="sr-only"> of {profile.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Clear the browsing data of “{profile.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          The cookies, history, sign-ins and site data saved for this profile (
          {profile.data ? formatBytes(profile.data.bytes) : "nothing"}) are deleted. The next
          session starts clean. The profile itself stays.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Keep it</AlertDialogClose>
          <Button variant="danger" loading={pending} onClick={() => void clear()}>
            Clear data
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The account's profiles: create, edit, reorder and delete. */
export function ProfilesManager({
  profiles,
  limit,
  engines,
  proxies,
}: {
  profiles: readonly Profile[];
  limit: number;
  /** The browsers this installation offers for a new profile. */
  engines: readonly BrowserEngine[];
  proxies: readonly ProxyChoice[];
}) {
  const proxyNames = new Map(proxies.map((proxy) => [proxy.id, proxy.name]));
  const router = useRouter();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const atLimit = profiles.length >= limit;
  const used = new Set(profiles.map((profile) => profile.color));
  const suggestedColor = profileColors.find((color) => !used.has(color)) ?? "indigo";

  async function move(index: number, offset: -1 | 1) {
    const ids = profiles.map((profile) => profile.id);
    const target = index + offset;
    const current = ids[index];
    const neighbour = ids[target];
    if (current === undefined || neighbour === undefined) return;
    ids[index] = neighbour;
    ids[target] = current;
    setMoving(true);
    const result = await reorderProfiles(ids);
    setMoving(false);
    if (!result.ok && result.status === 401) {
      leaveSignedInArea("expired");
      return;
    }
    if (!result.ok) {
      toast.add({
        type: "error",
        title: "Couldn’t move the profile",
        description: result.error.message,
      });
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col">
      {atLimit ? (
        <Card label="New profile" className="mb-[14px]">
          <p className="ad-stat-small">
            You’ve reached the limit of {limit} profiles while Brawzer is in development. Delete one
            to make another.
          </p>
        </Card>
      ) : (
        <NewProfile suggestedColor={suggestedColor} engines={engines} />
      )}

      <Panel>
        <InfoHead title="Your profiles">
          <span className="ad-info-count">
            {profiles.length} of {limit} profiles
          </span>
        </InfoHead>
        <ul aria-label="Your profiles">
          {profiles.map((profile, index) => (
            <li key={profile.id}>
              <ProfileRow
                profile={profile}
                index={index}
                count={profiles.length}
                moving={moving}
                proxies={proxies}
                proxyName={
                  profile.proxyId && proxyNames.has(profile.proxyId)
                    ? (proxyNames.get(profile.proxyId) ?? null)
                    : null
                }
                onMove={(offset) => void move(index, offset)}
              />
            </li>
          ))}
        </ul>
      </Panel>
      {profiles.length === 1 && (
        <p className="mt-3 text-footnote text-ink-secondary">
          An account always keeps at least one profile, so the last one can’t be deleted.
        </p>
      )}
    </div>
  );
}

/** One profile as the prototype lists them: avatar, name, a line about it, Open and the rest. */
function ProfileRow({
  profile,
  index,
  count,
  moving,
  proxies,
  proxyName,
  onMove,
}: {
  profile: Profile;
  index: number;
  count: number;
  moving: boolean;
  proxies: readonly ProxyChoice[];
  proxyName: string | null;
  onMove: (offset: -1 | 1) => void;
}) {
  const { launch, opening } = useLaunchBrowser();
  const kept = profile.keepData
    ? profile.data
      ? `keeps browsing data, ${formatBytes(profile.data.bytes)} saved`
      : "keeps browsing data, nothing saved yet"
    : "starts every session clean";
  return (
    <Row
      icon={
        <span
          className="ad-pav"
          style={{ background: profileColorShades[profile.color].hex }}
          aria-hidden="true"
        >
          {initialOf(profile.name)}
        </span>
      }
      title={
        <>
          <span className="truncate">{profile.name}</span>
          {index === 0 && <Pill tone="green">Default</Pill>}
        </>
      }
      sub={
        <>
          {engineDetails[profile.engine].name} · {kept[0]?.toUpperCase()}
          {kept.slice(1)}
          {profile.keepData && profile.data && (
            <>
              {" "}
              <LocalDate iso={profile.data.savedAt} />
            </>
          )}
          {profile.keepData && profile.browserAccount
            ? " · Browser account and saved passwords on"
            : ""}
          {proxyName
            ? ` · Proxy: ${proxyName}${profile.privateThroughProxy ? " · Private addresses through the proxy" : ""}`
            : ""}
          {profile.extensions.length > 0
            ? ` · ${String(profile.extensions.length)} extension${profile.extensions.length === 1 ? "" : "s"}`
            : ""}{" "}
          · Created <LocalDate iso={profile.createdAt} />
        </>
      }
    >
      <Button
        variant="primary"
        size="sm"
        loading={opening === profile.engine}
        onClick={() => void launch(profile.engine, undefined, { profileId: profile.id })}
      >
        Open<span className="sr-only"> {profile.name}</span>
      </Button>
      <EditProfile profile={profile} proxies={proxies} />
      <Button
        variant="ghost"
        size="sm"
        render={<Link href={`/app/profiles/${profile.id}/history`} />}
      >
        History<span className="sr-only"> and bookmarks of {profile.name}</span>
      </Button>
      {profile.data && <ClearProfileData profile={profile} />}
      {count > 1 && <DeleteProfile profile={profile} />}
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={index === 0 || moving}
        aria-label={`Move ${profile.name} up`}
        onClick={() => {
          onMove(-1);
        }}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={index === count - 1 || moving}
        aria-label={`Move ${profile.name} down`}
        onClick={() => {
          onMove(1);
        }}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
    </Row>
  );
}
