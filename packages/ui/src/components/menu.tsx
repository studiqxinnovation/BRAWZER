"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";
import { popupSurface } from "../lib/popup";
import type { WithClassName } from "../lib/types";

export const Menu = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;
export const MenuGroup = BaseMenu.Group;

export interface MenuContentProps {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  className?: string;
  children: ReactNode;
}

export function MenuContent({
  align = "start",
  side = "bottom",
  sideOffset = 6,
  className,
  children,
}: MenuContentProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="z-50 outline-none"
      >
        <BaseMenu.Popup className={cn(popupSurface, "min-w-48 p-1", className)}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export interface MenuItemProps extends WithClassName<ComponentProps<typeof BaseMenu.Item>> {
  icon?: ReactNode;
  /** Keyboard shortcut hint, shown right-aligned. */
  shortcut?: ReactNode;
  /** Use "danger" for destructive actions. */
  tone?: "default" | "danger";
}

export function MenuItem({
  icon,
  shortcut,
  tone = "default",
  className,
  children,
  ...props
}: MenuItemProps) {
  return (
    <BaseMenu.Item
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-callout text-ink outline-none select-none",
        "data-disabled:opacity-50 data-highlighted:bg-hover",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-secondary",
        tone === "danger" && "text-danger [&_svg]:text-danger",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="ml-6 text-footnote text-ink-tertiary">{shortcut}</span>}
    </BaseMenu.Item>
  );
}

export function MenuSeparator({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseMenu.Separator>>) {
  return <BaseMenu.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />;
}

export function MenuGroupLabel({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseMenu.GroupLabel>>) {
  return (
    <BaseMenu.GroupLabel
      className={cn("px-2.5 pt-1.5 pb-1 text-caption font-medium text-ink-tertiary", className)}
      {...props}
    />
  );
}
