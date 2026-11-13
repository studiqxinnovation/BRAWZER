"use client";

import { type DriveFolder, driveNameSchema } from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@brawzer/ui/components/alert-dialog";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@brawzer/ui/components/dialog";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { FormMessage } from "@brawzer/ui/components/form-message";
import { Select } from "@brawzer/ui/components/select";
import { type ReactNode, type SubmitEvent, useRef, useState } from "react";
import { focusFirstInvalid } from "@/components/auth/auth-ui";
import { type ApiResult, fieldErrorsFromDetails } from "@/lib/api/client";
import { describePath, folderSubtree } from "@/lib/drive";
import { leaveSignedInArea } from "@/lib/session-channel";

/** What a failed request means for a dialog: a field message, a general one, or signing in again. */
export function failureMessage(result: Extract<ApiResult<unknown>, { ok: false }>): {
  field?: string;
  message: string;
} | null {
  if (result.status === 401) {
    leaveSignedInArea("expired");
    return null;
  }
  const fields = fieldErrorsFromDetails(result.error.details);
  const [field] = Object.keys(fields);
  if (field && fields[field]) return { field, message: fields[field] };
  return { message: result.error.message };
}

/** Names a new folder, or renames a file or folder. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<ApiResult<unknown>>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setError(null);
    setFailure(null);
    onOpenChange(false);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFailure(null);
    const parsed = driveNameSchema.safeParse(new FormData(event.currentTarget).get("name"));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Give it a name.");
      focusFirstInvalid(formRef.current);
      return;
    }
    if (parsed.data === initial) {
      close();
      return;
    }
    setPending(true);
    const result = await onSubmit(parsed.data);
    setPending(false);
    if (result.ok) {
      close();
      return;
    }
    const problem = failureMessage(result);
    if (!problem) return;
    if (problem.field === "name") {
      setError(problem.message);
      focusFirstInvalid(formRef.current);
    } else setFailure(problem.message);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <form
          method="post"
          ref={formRef}
          noValidate
          onSubmit={handleSubmit}
          className="mt-5 flex flex-col gap-5"
        >
          {failure && <FormMessage tone="danger">{failure}</FormMessage>}
          <Field name="name" invalid={error !== null}>
            <FieldLabel>{label}</FieldLabel>
            <Input name="name" defaultValue={initial} maxLength={255} autoComplete="off" required />
            {error && <FieldError match>{error}</FieldError>}
          </Field>
          <DialogFooter className="mt-1">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TOP_LEVEL = "__top__";

/** Moves a file or folder to another folder, or to the top level. */
export function MoveDialog({
  open,
  onOpenChange,
  itemName,
  kind,
  folders,
  currentParentId,
  /** For folders: the folder itself, which can't contain itself. */
  movingFolderId,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  kind: "file" | "folder";
  folders: readonly DriveFolder[];
  currentParentId: string | null;
  movingFolderId?: string;
  onMove: (targetId: string | null) => Promise<ApiResult<unknown>>;
}) {
  const [target, setTarget] = useState<string>(currentParentId ?? TOP_LEVEL);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const excluded = movingFolderId ? folderSubtree(folders, movingFolderId) : new Set<string>();
  const options = [
    { value: TOP_LEVEL, label: "Drive (top level)" },
    ...folders
      .filter((folder) => !excluded.has(folder.id))
      .map((folder) => ({ value: folder.id, label: describePath(folders, folder.id) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  function close() {
    setFailure(null);
    setTarget(currentParentId ?? TOP_LEVEL);
    onOpenChange(false);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetId = target === TOP_LEVEL ? null : target;
    if (targetId === currentParentId) {
      close();
      return;
    }
    setPending(true);
    setFailure(null);
    const result = await onMove(targetId);
    setPending(false);
    if (result.ok) {
      close();
      return;
    }
    const problem = failureMessage(result);
    if (problem) setFailure(problem.message);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent>
        <DialogTitle>Move “{itemName}”</DialogTitle>
        <DialogDescription>
          {kind === "folder"
            ? "Everything inside moves with it."
            : "Choose the folder to move the file to."}
        </DialogDescription>
        <form method="post" noValidate onSubmit={handleSubmit} className="mt-5 flex flex-col gap-5">
          {failure && <FormMessage tone="danger">{failure}</FormMessage>}
          <Select<string>
            label="Move to"
            name="target"
            value={target}
            onValueChange={setTarget}
            options={options}
          />
          <DialogFooter className="mt-1">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms a deletion. */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<ApiResult<unknown>>;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    setFailure(null);
    const result = await onConfirm();
    setPending(false);
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    const problem = failureMessage(result);
    if (problem) setFailure(problem.message);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailure(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {failure && (
          <FormMessage tone="danger" className="mt-4">
            {failure}
          </FormMessage>
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="danger" loading={pending} onClick={() => void confirm()}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
