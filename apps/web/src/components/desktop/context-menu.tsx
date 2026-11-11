"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

/**
 * The prototype's menus (right-click on the desktop, a Dock icon or a title
 * bar): items with an icon, a check or a shortcut, headings, separators and
 * submenus. One is open at a time; arrow keys move, Enter chooses, Escape
 * or a click elsewhere closes it.
 */
export type MenuEntry =
  | "-"
  | { heading: string }
  | {
      label: string;
      onSelect?: () => void;
      disabled?: boolean;
      checked?: boolean;
      shortcut?: string;
      /** A second line, smaller: what the page is for. */
      sub?: string;
      /** A count beside it, as the Protect menu shows Shield's. */
      badge?: string;
      /** The page that's open: marked, as a navigation menu marks it (not a checkbox). */
      current?: boolean;
      icon?: ReactNode;
      danger?: boolean;
      children?: readonly MenuEntry[];
    };

interface OpenMenu {
  x: number;
  y: number;
  entries: readonly MenuEntry[];
  /** Where focus goes back to when it closes. */
  returnTo: HTMLElement | null;
}

let current: OpenMenu | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Opens a menu where the pointer is (or under the element, from the keyboard). */
export function openContextMenu(
  event: {
    clientX: number;
    clientY: number;
    currentTarget: EventTarget | null;
    preventDefault: () => void;
  },
  entries: readonly MenuEntry[],
) {
  event.preventDefault();
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  let { clientX: x, clientY: y } = event;
  if (x === 0 && y === 0 && target) {
    const box = target.getBoundingClientRect();
    x = box.left + 8;
    y = box.bottom + 4;
  }
  current = { x, y, entries, returnTo: target };
  emit();
}

export function closeContextMenu() {
  if (!current) return;
  const back = current.returnTo;
  current = null;
  emit();
  back?.focus({ preventScroll: true });
}

type Item = Exclude<MenuEntry, "-" | { heading: string }>;
const isItem = (entry: MenuEntry): entry is Item => typeof entry === "object" && "label" in entry;

function MenuList({
  entries,
  x,
  y,
  onClose,
  label,
}: {
  entries: readonly MenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);

  // Kept on screen, as the prototype's menus are.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({
      left: Math.max(6, Math.min(x, window.innerWidth - box.width - 6)),
      top: Math.max(6, Math.min(y, window.innerHeight - box.height - 6)),
    });
  }, [x, y]);

  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]',
      )
      ?.focus();
  }, []);

  const items = () => [
    ...(ref.current?.querySelectorAll<HTMLElement>(
      ':scope > [role="menuitem"]:not([aria-disabled="true"]), :scope > [role="menuitemcheckbox"]',
    ) ?? []),
  ];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list.at(-1)?.focus();
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      className="dt-cm"
      style={{ left: place.left, top: place.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {entries.map((entry, index) => {
        if (entry === "-") return <div key={index} role="separator" className="dt-cm-sep" />;
        if (!isItem(entry)) {
          return (
            <div key={index} role="presentation" className="dt-cm-h">
              {entry.heading}
            </div>
          );
        }
        const hasChildren = (entry.children?.length ?? 0) > 0;
        const openSub = (element: HTMLElement) => {
          const box = element.getBoundingClientRect();
          setSub({ index, x: box.right - 2, y: box.top - 5 });
        };
        return (
          // A menuitem or menuitemcheckbox (the rule can't read a role chosen at run time).
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            key={index}
            role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={entry.checked}
            aria-current={entry.current ? "page" : undefined}
            aria-disabled={entry.disabled ? true : undefined}
            aria-haspopup={hasChildren ? "menu" : undefined}
            aria-expanded={hasChildren ? sub?.index === index : undefined}
            tabIndex={-1}
            className="dt-cm-i"
            data-danger={entry.danger ? true : undefined}
            onPointerEnter={(event) => {
              if (hasChildren) openSub(event.currentTarget);
              else setSub(null);
              if (!entry.disabled) event.currentTarget.focus();
            }}
            onClick={(event) => {
              if (entry.disabled) return;
              if (hasChildren) {
                openSub(event.currentTarget);
                return;
              }
              closeContextMenu();
              entry.onSelect?.();
            }}
            onKeyDown={(event) => {
              if (entry.disabled) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.currentTarget.click();
              } else if (event.key === "ArrowRight" && hasChildren) {
                event.preventDefault();
                openSub(event.currentTarget);
              }
            }}
          >
            <span className="dt-cm-ck" aria-hidden="true">
              {(entry.checked ?? entry.current) && (
                <svg viewBox="0 0 24 24">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </span>
            {entry.icon && <span className="dt-cm-ico">{entry.icon}</span>}
            <span className="dt-cm-l">
              {entry.label}
              {entry.sub && <small>{entry.sub}</small>}
            </span>
            {entry.badge && <span className="dt-cm-badge">{entry.badge}</span>}
            {entry.shortcut && <span className="dt-cm-k">{entry.shortcut}</span>}
            {hasChildren && (
              <span className="dt-cm-k" aria-hidden="true">
                ›
              </span>
            )}
          </div>
        );
      })}
      {sub !== null &&
        (() => {
          const parent = entries[sub.index];
          if (!parent || !isItem(parent) || !parent.children) return null;
          return (
            <MenuList
              key={sub.index}
              entries={parent.children}
              x={sub.x}
              y={sub.y}
              label={parent.label}
              onClose={() => {
                setSub(null);
                items()[0]?.focus();
              }}
            />
          );
        })()}
    </div>
  );
}

/** Where the open menu is drawn; once, in the desktop. */
export function ContextMenuHost() {
  const menu = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".dt-cm")) closeContextMenu();
    };
    const onBlur = () => {
      closeContextMenu();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [menu]);
  if (!menu) return null;
  return createPortal(
    <MenuList
      entries={menu.entries}
      x={menu.x}
      y={menu.y}
      label="Menu"
      onClose={closeContextMenu}
    />,
    document.body,
  );
}
