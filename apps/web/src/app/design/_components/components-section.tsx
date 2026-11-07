"use client";

import { Badge } from "@brawzer/ui/components/badge";
import { Button } from "@brawzer/ui/components/button";
import { Checkbox } from "@brawzer/ui/components/checkbox";
import { DevState } from "@brawzer/ui/components/dev-state";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@brawzer/ui/components/dialog";
import { EmptyState } from "@brawzer/ui/components/empty-state";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@brawzer/ui/components/field";
import { Kbd, ModifierKey } from "@brawzer/ui/components/kbd";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@brawzer/ui/components/menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@brawzer/ui/components/popover";
import { SegmentedControl } from "@brawzer/ui/components/segmented-control";
import { Select } from "@brawzer/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@brawzer/ui/components/sheet";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { Spinner } from "@brawzer/ui/components/spinner";
import { StatusDot } from "@brawzer/ui/components/status-dot";
import { Switch } from "@brawzer/ui/components/switch";
import { Tab, Tabs, TabsList, TabsPanel } from "@brawzer/ui/components/tabs";
import { useToast } from "@brawzer/ui/components/toast";
import { Tooltip } from "@brawzer/ui/components/tooltip";
import { cn } from "@brawzer/ui/lib/cn";
import {
  Copy,
  Ellipsis,
  Layers,
  LogOut,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Trash,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { designSections, Section } from "./section";

type Preview = (action: string) => void;

function Specimen({
  title,
  note,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <figure
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-line bg-surface",
        className,
      )}
    >
      <div className={cn("flex flex-1 flex-wrap items-center gap-3 p-6", bodyClassName)}>
        {children}
      </div>
      <figcaption className="border-t border-line bg-canvas-subtle px-5 py-3 text-footnote">
        <span className="font-medium text-ink">{title}</span>
        {note && <span className="text-ink-tertiary"> · {note}</span>}
      </figcaption>
    </figure>
  );
}

function Buttons({ preview }: { preview: Preview }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  return (
    <Specimen
      title="Buttons"
      note="one primary action per screen; secondary for everything else"
      className="md:col-span-2"
      bodyClassName="flex-col items-start gap-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => preview("Launch browser")}>
          Launch browser
        </Button>
        <Button onClick={() => preview("Secondary")}>Secondary</Button>
        <Button variant="ghost" onClick={() => preview("Ghost")}>
          Ghost
        </Button>
        <Button variant="danger" onClick={() => preview("End session")}>
          End session
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => preview("Small")}>
          Small
        </Button>
        <Button onClick={() => preview("Medium")}>Medium</Button>
        <Button size="lg" variant="primary" onClick={() => preview("Large")}>
          Large
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          loading={saving}
          onClick={() => {
            setSaving(true);
            window.setTimeout(() => {
              setSaving(false);
              toast.add({
                title: "Changes saved",
                description: "Preview only: nothing was stored.",
                type: "success",
              });
            }, 1200);
          }}
        >
          Save changes
        </Button>
        <Button disabled>Disabled</Button>
        <Tooltip content="New profile">
          <Button size="icon" aria-label="New profile" onClick={() => preview("New profile")}>
            <Plus />
          </Button>
        </Tooltip>
        <Tooltip content="Reload page">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Reload page"
            onClick={() => preview("Reload page")}
          >
            <RefreshCw />
          </Button>
        </Tooltip>
        <Tooltip content="Browser settings">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Browser settings"
            onClick={() => preview("Browser settings")}
          >
            <Settings />
          </Button>
        </Tooltip>
      </div>
    </Specimen>
  );
}

function TextFields() {
  return (
    <Specimen
      title="Text fields"
      note="checked when you leave the field"
      bodyClassName="flex-col items-stretch gap-5"
    >
      <Field validationMode="onBlur">
        <FieldLabel>Profile name</FieldLabel>
        <Input required placeholder="For example, Research" autoComplete="off" />
        <FieldError match="valueMissing">Give the profile a name.</FieldError>
      </Field>
      <Field validationMode="onBlur">
        <FieldLabel>Recovery email</FieldLabel>
        <Input type="email" placeholder="you@example.com" autoComplete="off" />
        <FieldDescription>Used only to recover your account.</FieldDescription>
        <FieldError match="typeMismatch">Enter an email address like name@example.com.</FieldError>
      </Field>
    </Specimen>
  );
}

function SelectionControls() {
  return (
    <Specimen
      title="Selection"
      note="settings apply as soon as they change"
      bodyClassName="flex-col items-stretch gap-5"
    >
      <Select
        label="Browser engine"
        defaultValue="chromium"
        options={[
          { value: "chromium", label: "Chromium" },
          { value: "firefox", label: "Firefox (coming later)", disabled: true },
        ]}
      />
      <label className="flex items-center gap-2.5 text-callout text-ink">
        <Checkbox defaultChecked />
        This is a shared computer
      </label>
      <div className="divide-y divide-line rounded-lg border border-line">
        <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-callout text-ink">
          Allow clipboard access
          <Switch />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-callout text-ink">
          Block third-party cookies
          <Switch defaultChecked />
        </label>
      </div>
    </Specimen>
  );
}

function DialogDemo() {
  const toast = useToast();
  return (
    <Specimen title="Dialog" note="for decisions that need full attention">
      <Dialog>
        <DialogTrigger render={<Button variant="danger" />}>
          <LogOut aria-hidden="true" />
          End all sessions…
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>End all sessions?</DialogTitle>
          <DialogDescription>
            Every device signed in to this account is disconnected, and any cloud browser that is
            open stops immediately.
          </DialogDescription>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <DialogClose
              render={<Button variant="danger" />}
              onClick={() =>
                toast.add({ title: "Preview only", description: "No sessions were ended." })
              }
            >
              End sessions
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Specimen>
  );
}

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Specimen title="Sheet" note="navigation and details on small screens">
      <Sheet side="left" open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button />}>
          <PanelLeft aria-hidden="true" />
          Open panel
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Jump to a section</SheetTitle>
          <SheetDescription>Panels slide in from the edge and can be swiped away.</SheetDescription>
          <nav aria-label="Sections in this panel" className="mt-6 flex flex-col gap-0.5">
            {designSections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={() => setOpen(false)}
                className="rounded-md px-2.5 py-2 text-callout text-ink hover:bg-hover"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </Specimen>
  );
}

function MenuDemo({ preview }: { preview: Preview }) {
  return (
    <Specimen title="Menu">
      <Menu>
        <MenuTrigger render={<Button />}>
          Profile actions
          <Ellipsis aria-hidden="true" />
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<Pencil />} onClick={() => preview("Rename")}>
            Rename
          </MenuItem>
          <MenuItem icon={<Copy />} onClick={() => preview("Duplicate")}>
            Duplicate
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash />} tone="danger" onClick={() => preview("Delete profile")}>
            Delete profile
          </MenuItem>
        </MenuContent>
      </Menu>
    </Specimen>
  );
}

function PopoverDemo() {
  return (
    <Specimen title="Popover" note="sample data">
      <Popover>
        <PopoverTrigger render={<Button />}>
          <StatusDot tone="success" />
          Proxy · Frankfurt
        </PopoverTrigger>
        <PopoverContent align="start">
          <PopoverTitle>Proxy connected</PopoverTitle>
          <PopoverDescription>
            Traffic from this profile leaves through the proxy below.
          </PopoverDescription>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-footnote">
            <dt className="text-ink-tertiary">Exit IP</dt>
            <dd className="font-mono text-ink">203.0.113.42</dd>
            <dt className="text-ink-tertiary">Protocol</dt>
            <dd className="text-ink">SOCKS5</dd>
            <dt className="text-ink-tertiary">Location</dt>
            <dd className="text-ink">Frankfurt, Germany</dd>
          </dl>
        </PopoverContent>
      </Popover>
    </Specimen>
  );
}

function Notifications() {
  const toast = useToast();
  return (
    <Specimen title="Notifications" note="announced to screen readers">
      <Button
        onClick={() =>
          toast.add({
            title: "Profile created",
            description: "Research is ready to launch.",
            type: "success",
          })
        }
      >
        Success
      </Button>
      <Button
        onClick={() =>
          toast.add({
            title: "Couldn’t reach the proxy",
            description: "Check the address and try again.",
            type: "error",
          })
        }
      >
        Error
      </Button>
      <Button
        onClick={() =>
          toast.add({
            title: "Session locks in 5 minutes",
            description: "This computer has been idle.",
          })
        }
      >
        Information
      </Button>
    </Specimen>
  );
}

function TabsDemo() {
  return (
    <Specimen title="Tabs" bodyClassName="block">
      <Tabs defaultValue="overview">
        <TabsList>
          <Tab value="overview">Overview</Tab>
          <Tab value="activity">Activity</Tab>
          <Tab value="settings">Settings</Tab>
        </TabsList>
        <TabsPanel value="overview">
          <p className="text-callout text-ink-secondary">
            Engine, proxy and storage for this profile.
          </p>
        </TabsPanel>
        <TabsPanel value="activity">
          <p className="text-callout text-ink-secondary">
            Recent sessions and the devices they ran on.
          </p>
        </TabsPanel>
        <TabsPanel value="settings">
          <p className="text-callout text-ink-secondary">
            Privacy controls, extensions and defaults.
          </p>
        </TabsPanel>
      </Tabs>
    </Specimen>
  );
}

function SegmentedDemo() {
  const [range, setRange] = useState<"day" | "week" | "month">("week");
  return (
    <Specimen title="Segmented control">
      <SegmentedControl
        aria-label="Time range"
        value={range}
        onValueChange={setRange}
        options={[
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
        ]}
      />
      <span className="text-footnote text-ink-tertiary" aria-live="polite">
        Showing the last {range}
      </span>
    </Specimen>
  );
}

function StatusDemo() {
  return (
    <Specimen
      title="Status"
      note="colour always comes with words"
      bodyClassName="flex-col items-start gap-5"
    >
      <ul className="space-y-2.5 text-callout text-ink">
        <li className="flex items-center gap-2.5">
          <StatusDot tone="success" /> Connected
        </li>
        <li className="flex items-center gap-2.5">
          <StatusDot tone="warning" pulse /> Connecting
        </li>
        <li className="flex items-center gap-2.5">
          <StatusDot tone="danger" /> Disconnected
        </li>
        <li className="flex items-center gap-2.5">
          <StatusDot /> Not configured
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Badge tone="success">Protected</Badge>
        <Badge tone="accent">Default profile</Badge>
        <Badge tone="warning">Proxy off</Badge>
        <Badge tone="danger">Blocked</Badge>
        <Badge>Chromium</Badge>
      </div>
    </Specimen>
  );
}

function ShortcutsDemo() {
  return (
    <Specimen title="Keyboard shortcuts" note="sample shortcuts" bodyClassName="block">
      <dl className="grid grid-cols-[1fr_auto] items-center gap-y-3 text-callout">
        <dt className="text-ink">Command menu</dt>
        <dd className="flex gap-1">
          <ModifierKey />
          <Kbd>K</Kbd>
        </dd>
        <dt className="text-ink">New tab in the cloud browser</dt>
        <dd className="flex gap-1">
          <Kbd>Alt</Kbd>
          <Kbd>T</Kbd>
        </dd>
        <dt className="text-ink">Lock this session</dt>
        <dd className="flex gap-1">
          <ModifierKey />
          <Kbd>⇧</Kbd>
          <Kbd>L</Kbd>
        </dd>
      </dl>
    </Specimen>
  );
}

function LoadingDemo() {
  return (
    <Specimen title="Loading" bodyClassName="flex-col items-stretch gap-4">
      <div role="status" className="flex items-center gap-2.5 text-callout text-ink-secondary">
        <Spinner />
        Starting your browser…
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-line p-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      </div>
    </Specimen>
  );
}

function EmptyDemo() {
  const toast = useToast();
  return (
    <Specimen title="Empty state" bodyClassName="block p-0">
      <EmptyState
        icon={<Layers />}
        title="No browser profiles yet"
        description="Profiles keep cookies, history and extensions separate for each part of your life."
        actions={
          <Button
            variant="primary"
            onClick={() =>
              toast.add({
                title: "Coming in Phase 2",
                description: "Profiles are built after sign-in.",
              })
            }
          >
            <Plus aria-hidden="true" />
            Create a profile
          </Button>
        }
      />
    </Specimen>
  );
}

function DevStateDemo() {
  return (
    <Specimen
      title="Development state"
      note="marks anything not connected yet"
      bodyClassName="block"
    >
      <DevState
        title="Brawzer Drive isn’t connected yet"
        milestone="Phase 4"
        requires={["S3-compatible object storage", "Malware scanning for downloads"]}
      >
        Files you download in your cloud browser will appear here.
      </DevState>
    </Specimen>
  );
}

export function ComponentsSection() {
  const toast = useToast();
  const preview: Preview = (action) => {
    toast.add({ title: action, description: "Component preview: no action was taken." });
  };

  return (
    <Section
      id="components"
      index="06"
      title="Components"
      description="Built on Base UI, so keyboard support, focus handling and screen-reader semantics come from a tested foundation. Every control here works; examples use sample content."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Buttons preview={preview} />
        <TextFields />
        <SelectionControls />
        <DialogDemo />
        <SheetDemo />
        <MenuDemo preview={preview} />
        <PopoverDemo />
        <Notifications />
        <SegmentedDemo />
        <TabsDemo />
        <StatusDemo />
        <ShortcutsDemo />
        <LoadingDemo />
        <EmptyDemo />
        <DevStateDemo />
      </div>
    </Section>
  );
}
