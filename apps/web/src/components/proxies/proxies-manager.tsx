"use client";

import type { SavedProxy } from "@brawzer/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@brawzer/ui/components/alert-dialog";
import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@brawzer/ui/components/dialog";
import { EmptyState } from "@brawzer/ui/components/empty-state";
import { useToast } from "@brawzer/ui/components/toast";
import { CircleAlert, CircleCheck, Globe, KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useRef, useState } from "react";
import { Panel } from "@/components/app-shell/page";
import { focusFirstInvalid } from "@/components/auth/auth-ui";
import type { ApiResult } from "@/lib/api/client";
import { createProxy, deleteProxy, testProxy, updateProxy } from "@/lib/api/proxies";
import {
  fromDetails,
  hostAndPort,
  kindLabels,
  protocolLabels,
  proxyFieldErrors,
  rotationLabels,
} from "@/lib/proxies";
import { leaveSignedInArea } from "@/lib/session-channel";
import { timeAgo } from "@/lib/time";
import { ProxyFields, readNewProxy, readProxyChanges } from "./proxy-form";

const listFormat = new Intl.ListFormat("en-GB", { type: "conjunction" });

function ProxyDialog({ proxy, sharedComputer }: { proxy?: SavedProxy; sharedComputer: boolean }) {
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

  function invalid(errors: Record<string, string>): null {
    setErrors(errors);
    focusFirstInvalid(formRef.current);
    return null;
  }

  async function send<T>(request: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    setErrors({});
    setPending(true);
    const result = await request();
    setPending(false);
    return result;
  }

  async function save(data: FormData): Promise<ApiResult<SavedProxy> | null> {
    if (proxy) {
      const form = readProxyChanges(data, proxy);
      return form.ok ? send(() => updateProxy(proxy.id, form.body)) : invalid(form.errors);
    }
    const form = readNewProxy(data);
    return form.ok ? send(() => createProxy(form.body)) : invalid(form.errors);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    const result = await save(new FormData(event.currentTarget));
    if (!result) return;
    if (result.ok) {
      handleOpenChange(false);
      toast.add({
        type: "success",
        title: proxy ? `Saved “${result.data.name}”` : `Added “${result.data.name}”`,
      });
      router.refresh();
      return;
    }
    if (result.status === 401) {
      leaveSignedInArea("expired");
      return;
    }
    const fields = proxyFieldErrors(fromDetails(result.error.details));
    if (Object.keys(fields).length > 0) {
      setErrors(fields);
      focusFirstInvalid(formRef.current);
    } else {
      setFailure(result.error.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {proxy ? (
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>
          Edit<span className="sr-only"> {proxy.name}</span>
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant="primary" />}>
          <Plus aria-hidden="true" />
          Add proxy
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle>{proxy ? `Edit “${proxy.name}”` : "Add a proxy"}</DialogTitle>
        <DialogDescription>
          Brawzer connects to proxies from its own servers, never from this computer.
        </DialogDescription>
        <form
          method="post"
          ref={formRef}
          noValidate
          onSubmit={handleSubmit}
          className="mt-5 flex flex-col gap-5"
        >
          <ProxyFields
            proxy={proxy}
            errors={errors}
            failure={failure}
            sharedComputer={sharedComputer}
          />
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
              {proxy ? "Save" : "Add proxy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProxy({ proxy }: { proxy: SavedProxy }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const users = proxy.usedBy.map((profile) => profile.name);

  async function remove() {
    setPending(true);
    const result = await deleteProxy(proxy.id);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.add({ type: "success", title: `Deleted “${proxy.name}”` });
      router.refresh();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t delete the proxy",
        description: result.error.message,
      });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Delete<span className="sr-only"> {proxy.name}</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete “{proxy.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {users.length > 0
            ? `${listFormat.format(users)} will go back to no proxy. Its saved username and password are deleted too.`
            : "No profile uses it. Its saved username and password are deleted too."}
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="danger" loading={pending} onClick={() => void remove()}>
            Delete proxy
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TestResult({ proxy, renderedAt }: { proxy: SavedProxy; renderedAt: number }) {
  const test = proxy.lastTest;
  if (!test) return <p className="text-footnote text-ink-secondary">Not tested yet.</p>;
  const when = timeAgo(test.testedAt, renderedAt);
  if (test.ok) {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 text-footnote text-ink-secondary">
        <CircleCheck aria-hidden="true" className="size-4 text-success" />
        <span className="font-medium text-ink">Working</span>
        {test.latencyMs !== null && <span>· {test.latencyMs} ms</span>}
        {test.exitAddress && <span>· websites see {test.exitAddress}</span>}
        <span>· tested {when}</span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-footnote text-ink-secondary">
      <CircleAlert aria-hidden="true" className="size-4 text-danger" />
      <span className="font-medium text-ink">Not working:</span>
      <span>{test.message}</span>
      <span>· tested {when}</span>
    </p>
  );
}

function TestButton({ proxy }: { proxy: SavedProxy }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    const result = await testProxy(proxy.id);
    setPending(false);
    if (result.ok) {
      toast.add({
        type: result.data.ok ? "success" : "error",
        title: result.data.ok ? `“${proxy.name}” works` : `“${proxy.name}” isn’t working`,
        description: result.data.ok
          ? `Websites will see ${result.data.exitAddress ?? "the proxy’s address"}.`
          : result.data.message,
      });
      router.refresh();
    } else if (result.status === 401) {
      leaveSignedInArea("expired");
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t run the test",
        description: result.error.message,
      });
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={pending} onClick={() => void run()}>
      Test<span className="sr-only"> {proxy.name}</span>
    </Button>
  );
}

/** The account's proxies: add, edit, test and delete. */
export function ProxiesManager({
  proxies,
  limit,
  renderedAt,
  sharedComputer,
}: {
  proxies: readonly SavedProxy[];
  limit: number;
  renderedAt: number;
  sharedComputer: boolean;
}) {
  const atLimit = proxies.length >= limit;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-callout text-ink-secondary">
          {proxies.length} of {limit} proxies
        </p>
        {!atLimit && <ProxyDialog sharedComputer={sharedComputer} />}
      </div>
      {atLimit && (
        <p className="text-footnote text-ink-secondary">
          You’ve reached the limit of {limit} proxies while Brawzer is in development.
        </p>
      )}

      {proxies.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Globe />}
            title="No proxies yet"
            description="Add one to give a profile a different network route. Brawzer tests it from its own servers and keeps any password encrypted."
          />
        </Panel>
      ) : (
        <Panel>
          <ul aria-label="Your proxies" className="divide-y divide-line">
            {proxies.map((proxy) => (
              <li key={proxy.id} className="flex flex-col gap-3 p-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-callout font-medium text-ink">{proxy.name}</p>
                    <p className="text-footnote break-all text-ink-secondary">
                      {protocolLabels[proxy.protocol]} · {hostAndPort(proxy.host, proxy.port)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <TestButton proxy={proxy} />
                    <ProxyDialog proxy={proxy} sharedComputer={sharedComputer} />
                    <DeleteProxy proxy={proxy} />
                  </div>
                </div>
                {(proxy.kind !== "unspecified" ||
                  proxy.rotation !== "unknown" ||
                  proxy.hasCredentials) && (
                  <div className="flex flex-wrap gap-1.5">
                    {proxy.kind !== "unspecified" && <Badge>{kindLabels[proxy.kind]}</Badge>}
                    {proxy.rotation !== "unknown" && (
                      <Badge>{rotationLabels[proxy.rotation]}</Badge>
                    )}
                    {proxy.hasCredentials && (
                      <Badge>
                        <KeyRound aria-hidden="true" />
                        Password saved
                      </Badge>
                    )}
                  </div>
                )}
                <TestResult proxy={proxy} renderedAt={renderedAt} />
                <p className="text-footnote text-ink-secondary">
                  {proxy.usedBy.length > 0
                    ? `Used by ${listFormat.format(proxy.usedBy.map((profile) => profile.name))}`
                    : "Not used by any profile yet. Choose it for a profile on the Profiles page."}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
