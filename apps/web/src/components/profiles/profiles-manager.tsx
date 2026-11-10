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
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@brawzer/ui/components/dialog";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { useToast } from "@brawzer/ui/components/toast";
import { Switch } from "@brawzer/ui/components/switch";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useRef, useState } from "react";
import { useConfirmedRequest } from "@/components/app-shell/confirm-identity";
import { Panel } from "@/components/app-shell/page";
import { focusFirstInvalid } from "@/components/auth/auth-ui";
import { LocalDate } from "@/components/local-date";
import { ProfileAvatar } from "@/components/profile-avatar";
import { type ApiResult, fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import {
  clearProfileData,
  createProfile,
  deleteProfile,
  reorderProfiles,
  updateProfile,
} from "@/lib/api/profiles";
import { formatBytes } from "@/lib/drive";
import { initialOf, profileColorShades } from "@/lib/profiles";
import { leaveSignedInArea } from "@/lib/session-channel";
import { EngineChoice, ProfileNameAndColor } from "./profile-fields";

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
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setErrors({});
      setFailure(null);
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = createProfileRequestSchema.safeParse({
      name: data.get("name"),
      color: data.get("color"),
      engine: data.get("engine") ?? undefined,
    });
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
      handleOpenChange(false);
      toast.add({ type: "success", title: `Created “${result.data.name}”` });
      router.refresh();
    } else if (handleFailure(result, setErrors, setFailure)) {
      focusFirstInvalid(formRef.current);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="primary" />}>
        <Plus aria-hidden="true" />
        New profile
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>New profile</DialogTitle>
        <DialogDescription>
          A separate browser with its own name, colour and saved data, in the browser you choose.
        </DialogDescription>
        <form
          method="post"
          ref={formRef}
          noValidate
          onSubmit={handleSubmit}
          className="mt-5 flex flex-col gap-5"
        >
          {failure && <FormMessage tone="danger">{failure}</FormMessage>}
          <ProfileNameAndColor color={suggestedColor} errors={errors} />
          <EngineChoice engines={engines} />
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
              Create profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-callout text-ink-secondary">
          {profiles.length} of {limit} profiles
        </p>
        {!atLimit && <NewProfile suggestedColor={suggestedColor} engines={engines} />}
      </div>
      {atLimit && (
        <p className="text-footnote text-ink-secondary">
          You’ve reached the limit of {limit} profiles while Brawzer is in development.
        </p>
      )}

      <Panel>
        <ul aria-label="Your profiles" className="divide-y divide-line">
          {profiles.map((profile, index) => (
            <li
              key={profile.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ProfileAvatar
                  initial={initialOf(profile.name)}
                  color={profileColorShades[profile.color].hex}
                />
                <div className="min-w-0">
                  <p className="truncate text-callout font-medium text-ink">{profile.name}</p>
                  <p className="text-footnote text-ink-secondary">
                    {engineDetails[profile.engine].name}
                    {profile.proxyId && proxyNames.has(profile.proxyId)
                      ? ` · Proxy: ${proxyNames.get(profile.proxyId) ?? ""}${profile.privateThroughProxy ? " · Private addresses through the proxy" : ""}`
                      : ""}
                    {profile.extensions.length > 0
                      ? ` · ${String(profile.extensions.length)} extension${profile.extensions.length === 1 ? "" : "s"}`
                      : ""}{" "}
                    · Created <LocalDate iso={profile.createdAt} />
                  </p>
                  <p className="text-footnote text-ink-secondary">
                    {profile.keepData
                      ? profile.data
                        ? `Keeps browsing data · ${formatBytes(profile.data.bytes)} saved `
                        : "Keeps browsing data · nothing saved yet"
                      : "Starts every session clean"}
                    {profile.keepData && profile.data && <LocalDate iso={profile.data.savedAt} />}
                    {profile.keepData && profile.browserAccount
                      ? " · Browser account and saved passwords on"
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0 || moving}
                  aria-label={`Move ${profile.name} up`}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === profiles.length - 1 || moving}
                  aria-label={`Move ${profile.name} down`}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDown aria-hidden="true" />
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
                {profiles.length > 1 && <DeleteProfile profile={profile} />}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      {profiles.length === 1 && (
        <p className="text-footnote text-ink-secondary">
          An account always keeps at least one profile, so the last one can’t be deleted.
        </p>
      )}
    </div>
  );
}
