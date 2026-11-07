"use client";

import {
  createProfileRequestSchema,
  type Profile,
  type ProfileColor,
  profileColors,
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
import { useToast } from "@brawzer/ui/components/toast";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useRef, useState } from "react";
import { Panel } from "@/components/app-shell/page";
import { focusFirstInvalid } from "@/components/auth/auth-ui";
import { LocalDate } from "@/components/local-date";
import { ProfileAvatar } from "@/components/profile-avatar";
import { type ApiResult, fieldErrorsFromDetails, fieldErrorsFromIssues } from "@/lib/api/client";
import { createProfile, deleteProfile, reorderProfiles, updateProfile } from "@/lib/api/profiles";
import { initialOf, profileColorShades } from "@/lib/profiles";
import { leaveSignedInArea } from "@/lib/session-channel";
import { EngineChoice, ProfileNameAndColor } from "./profile-fields";

const engineLabels = { chromium: "Chromium", firefox: "Firefox" } as const;

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

function NewProfile({ suggestedColor }: { suggestedColor: ProfileColor }) {
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
          A separate browser with its own name and colour. Browsing in it arrives in Phase 3.
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
          <EngineChoice />
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

function EditProfile({ profile }: { profile: Profile }) {
  const router = useRouter();
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
    const parsed = updateProfileRequestSchema.safeParse({
      name: data.get("name"),
      color: data.get("color"),
    });
    setFailure(null);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await updateProfile(profile.id, parsed.data);
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
          Its name and colour are removed. Profiles don’t hold any browsing data yet, so nothing
          else is lost.
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

/** The account's profiles: create, edit, reorder and delete. */
export function ProfilesManager({
  profiles,
  limit,
}: {
  profiles: readonly Profile[];
  limit: number;
}) {
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
        {!atLimit && <NewProfile suggestedColor={suggestedColor} />}
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
                    {engineLabels[profile.engine]} · Created <LocalDate iso={profile.createdAt} />
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
                <EditProfile profile={profile} />
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
