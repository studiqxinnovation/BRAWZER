"use client";

import {
  type BrowserEngine,
  type BrowserSession,
  engineDetails,
  type Profile,
} from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@brawzer/ui/components/menu";
import { ChevronDown, Plus } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchBrowserOverview } from "@/lib/api/browser";
import { EngineLogo } from "./engine-logo";

/**
 * Which browser this is, and the way to the others: every browser open on
 * the account, read fresh when the menu opens, and "Open another browser".
 */
export function SessionSwitcher({
  current,
  engine,
  profiles,
  hrefFor,
  launcherHref,
}: {
  current: BrowserSession;
  engine: BrowserEngine;
  profiles: readonly Profile[];
  hrefFor: (id: string) => string;
  launcherHref: string;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<readonly BrowserSession[]>([current]);
  const labelOf = (session: BrowserSession) =>
    `${engineDetails[session.engine].short} · ${
      profiles.find((profile) => profile.id === session.profileId)?.name ?? "Temporary"
    }`;

  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) return;
        void fetchBrowserOverview().then((result) => {
          if (result.ok) setSessions(result.data.sessions);
        });
      }}
    >
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 rounded-xl px-2"
            aria-label={`${labelOf(current)}. Switch browser`}
          />
        }
      >
        <EngineLogo engine={engine} />
        <ChevronDown aria-hidden="true" className="size-3.5 text-ink-tertiary" />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuGroup>
          <MenuGroupLabel>Open browsers</MenuGroupLabel>
          {sessions.map((session) => (
            <MenuItem
              key={session.id}
              icon={<EngineLogo engine={session.engine} size="sm" />}
              disabled={session.id === current.id}
              onClick={() => {
                router.push(hrefFor(session.id) as Route);
              }}
            >
              {labelOf(session)}
              {session.id === current.id ? " (this one)" : ""}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem
          icon={<Plus />}
          onClick={() => {
            router.push(launcherHref as Route);
          }}
        >
          Open another browser
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
