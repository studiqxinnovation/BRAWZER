"use client";

import { cn } from "@brawzer/ui/lib/cn";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a window dropped at the screen's edge snaps to. */
export type Snap = "left" | "right" | "max";

const MIN_WIDTH = 420;
const MIN_HEIGHT = 280;

/**
 * Follows the pointer from a title bar (move) or a corner (resize) until it
 * lets go, reporting the window's new rectangle as it goes, and a snap when
 * it lets go at the left, right or top edge of the desktop.
 */
export function trackPointer(
  event: ReactPointerEvent<HTMLElement>,
  kind: "move" | "resize",
  start: Rect,
  bounds: () => DOMRect,
  onRect: (rect: Rect) => void,
  onEnd: (snap: Snap | null) => void,
  /** While moving: where the window would snap if let go now (the prototype's blue hint). */
  onHint?: (snap: Snap | null) => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  handle.setPointerCapture(event.pointerId);
  const fromX = event.clientX;
  const fromY = event.clientY;
  let last = { x: fromX, y: fromY };
  const snapAt = (x: number, y: number): Snap | null => {
    const box = bounds();
    const left = x - box.left;
    const top = y - box.top;
    return top <= 2 ? "max" : left <= 4 ? "left" : left >= box.width - 4 ? "right" : null;
  };
  const move = (moved: PointerEvent) => {
    const box = bounds();
    last = { x: moved.clientX, y: moved.clientY };
    if (kind === "move") onHint?.(snapAt(moved.clientX, moved.clientY));
    const dx = moved.clientX - fromX;
    const dy = moved.clientY - fromY;
    if (kind === "move") {
      onRect({
        ...start,
        left: Math.min(Math.max(start.left + dx, 120 - start.width), box.width - 120),
        top: Math.min(Math.max(start.top + dy, 0), box.height - 60),
      });
    } else {
      onRect({
        ...start,
        width: Math.max(MIN_WIDTH, Math.min(start.width + dx, box.width - start.left)),
        height: Math.max(MIN_HEIGHT, Math.min(start.height + dy, box.height - start.top)),
      });
    }
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    onHint?.(null);
    if (kind !== "move") {
      onEnd(null);
      return;
    }
    onEnd(snapAt(last.x, last.y));
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
}

/** The rectangle a snapped window fills, inside the desktop's working area. */
export function snapRect(snap: Snap, area: Rect): Rect {
  if (snap === "max") return area;
  const half = Math.floor(area.width / 2) - 4;
  return {
    left: snap === "left" ? area.left : area.left + area.width - half,
    top: area.top,
    width: half,
    height: area.height,
  };
}

/**
 * A window's title bar: the traffic lights on the left (Mac style) or the
 * controls on the right (Windows style; CSS shows one or the other), the
 * title, and anything else the window puts in it.
 */
export function TitleBar({
  label,
  title,
  icon,
  focused,
  onClose,
  onMinimise,
  onZoom,
  onDragStart,
  onMenu,
  children,
  className,
}: {
  /** What the window is, for the buttons' names: "Chrome", "Brawzer". */
  label: string;
  title: ReactNode;
  icon?: ReactNode;
  focused: boolean;
  onClose: () => void;
  onMinimise: () => void;
  onZoom: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Right-click on the title bar: the window's menu. */
  onMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    // Dragging by the title bar is the pointer's way to move a window; the
    // buttons in it (and Zoom) work from the keyboard.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={cn("dt-bar", className)}
      data-focused={focused || undefined}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        onDragStart(event);
      }}
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest("button, a, input")) onZoom();
      }}
      onContextMenu={(event) => {
        if (!onMenu || (event.target as HTMLElement).closest("button, a, input")) return;
        onMenu(event);
      }}
    >
      <span className="dt-lights">
        <button
          type="button"
          className="dt-light dt-light-close"
          aria-label={`Close ${label}`}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
        <button
          type="button"
          className="dt-light dt-light-min"
          aria-label={`Minimise ${label}`}
          onClick={onMinimise}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          className="dt-light dt-light-zoom"
          aria-label={`Zoom ${label}`}
          onClick={onZoom}
        >
          <span aria-hidden="true">+</span>
        </button>
      </span>
      {children}
      <span className="dt-title">
        {icon}
        <span className="truncate">{title}</span>
      </span>
      <span className="dt-controls">
        <button
          type="button"
          className="dt-control"
          aria-label={`Minimise ${label}`}
          onClick={onMinimise}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 5.5h8" />
          </svg>
        </button>
        <button
          type="button"
          className="dt-control"
          aria-label={`Maximise ${label}`}
          onClick={onZoom}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
          </svg>
        </button>
        <button
          type="button"
          className="dt-control dt-control-close"
          aria-label={`Close ${label}`}
          onClick={onClose}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
          </svg>
        </button>
      </span>
    </div>
  );
}
