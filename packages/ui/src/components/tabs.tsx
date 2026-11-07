"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import type { WithClassName } from "../lib/types";

export function Tabs({ className, ...props }: WithClassName<ComponentProps<typeof BaseTabs.Root>>) {
  return <BaseTabs.Root className={cn("flex flex-col", className)} {...props} />;
}

export function TabsList({
  className,
  children,
  ...props
}: WithClassName<ComponentProps<typeof BaseTabs.List>>) {
  return (
    <BaseTabs.List className={cn("relative flex gap-6 border-b border-line", className)} {...props}>
      {children}
      <BaseTabs.Indicator className="absolute bottom-[-1px] left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-accent transition-[translate,width] duration-(--bw-duration-base) ease-emphasized" />
    </BaseTabs.List>
  );
}

export function Tab({ className, ...props }: WithClassName<ComponentProps<typeof BaseTabs.Tab>>) {
  return (
    <BaseTabs.Tab
      className={cn(
        "relative flex h-10 cursor-pointer items-center text-callout font-medium text-ink-secondary",
        "transition-colors duration-(--bw-duration-fast) ease-standard outline-none hover:text-ink data-active:text-ink",
        "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseTabs.Panel>>) {
  return (
    <BaseTabs.Panel
      className={cn(
        "pt-5 outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
        className,
      )}
      {...props}
    />
  );
}
