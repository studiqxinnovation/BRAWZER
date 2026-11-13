"use client";

import type { ClientMessageInput, FrameHeader, Viewport } from "@brawzer/contracts";
import { cn } from "@brawzer/ui/lib/cn";
import {
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { buttonOf, fitViewport, keyMessage, modifiersOf } from "@/lib/browser/input";

export interface ViewportHandle {
  /** Draws the frame; `onDrawn` fires once it is on screen (or when it was skipped for a newer one). */
  draw(header: FrameHeader, image: Blob): void;
  focus(): void;
  /** Opens the on-screen keyboard on touch devices. */
  focusKeyboard(): void;
}

/** Brawzer's own shortcuts, handled by the workspace rather than sent to the page. */
export type Shortcut =
  "address" | "new-tab" | "close-tab" | "back" | "forward" | "reload" | "leave";

function shortcutOf(event: KeyboardEvent): Shortcut | null {
  if (event.key === "Escape" && event.shiftKey) return "leave";
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  switch (event.code) {
    case "KeyL":
      return "address";
    case "KeyT":
      return "new-tab";
    case "KeyW":
      return "close-tab";
    case "KeyR":
      return "reload";
    case "ArrowLeft":
      return "back";
    case "ArrowRight":
      return "forward";
    default:
      return null;
  }
}

interface ViewportProps {
  ref?: Ref<ViewportHandle>;
  tabId: string | null;
  /** Null while nothing is connected: input is ignored and the surface stays blank. */
  send: ((message: ClientMessageInput) => void) | null;
  onDrawn: (header: FrameHeader) => void;
  /** The size the page should be rendered at, after the area was measured or resized. */
  onViewport: (viewport: Viewport) => void;
  onShortcut: (shortcut: Shortcut) => void;
  /** True once the first frame was drawn. */
  onReady?: () => void;
  className?: string;
}

const RESIZE_DEBOUNCE_MS = 150;
const TAP_SLOP_PX = 10;

/**
 * The streamed page: a canvas showing the engine's frames at device pixel
 * ratio 1, with the pointer and keyboard forwarded to the page. The canvas
 * is only ever pixels; nothing from the page runs here.
 */
export function BrowserViewport({
  ref,
  tabId,
  send,
  onDrawn,
  onViewport,
  onShortcut,
  onReady,
  className,
}: ViewportProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [frames, setFrames] = useState(0);
  const pending = useRef<{ header: FrameHeader; image: Blob } | null>(null);
  const drawing = useRef(false);
  const readyRef = useRef(false);
  const touch = useRef<{
    x: number;
    y: number;
    moved: boolean;
    last: { x: number; y: number };
  } | null>(null);

  const drawNext = useCallback(() => {
    const next = pending.current;
    const canvas = canvasRef.current;
    if (!next || !canvas || drawing.current) return;
    pending.current = null;
    drawing.current = true;
    createImageBitmap(next.image).then(
      (bitmap) => {
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          setSize({ width: bitmap.width, height: bitmap.height });
        }
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        bitmap.close();
        drawing.current = false;
        setFrames((count) => count + 1);
        if (!readyRef.current) {
          readyRef.current = true;
          onReady?.();
        }
        onDrawn(next.header);
        drawNext();
      },
      () => {
        drawing.current = false;
        onDrawn(next.header);
        drawNext();
      },
    );
  }, [onDrawn, onReady]);

  useImperativeHandle(
    ref,
    () => ({
      draw(header, image) {
        // A newer frame replaces one still waiting to be decoded; the skipped one is acknowledged.
        const skipped = pending.current;
        pending.current = { header, image };
        if (skipped) onDrawn(skipped.header);
        drawNext();
      },
      focus() {
        areaRef.current?.focus();
      },
      focusKeyboard() {
        keyboardRef.current?.focus();
      },
    }),
    [drawNext, onDrawn],
  );

  // Measure the area and report what size the page should be rendered at.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = () => {
      const rect = area.getBoundingClientRect();
      onViewport(fitViewport(rect.width, rect.height));
    };
    report();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(report, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(area);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [onViewport]);

  // Wheel and keyboard need non-passive listeners to stop the local page scrolling or acting.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!send || !tabId) return;
      const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? 400 : 1;
      const point = pointOf(event);
      send({
        type: "mouse",
        tabId,
        kind: "wheel",
        x: point.x,
        y: point.y,
        deltaX: clampDelta(event.deltaX * scale),
        deltaY: clampDelta(event.deltaY * scale),
        modifiers: modifiersOf(event),
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.target === keyboardRef.current) return;
      const shortcut = shortcutOf(event);
      if (shortcut) {
        if (event.type === "keydown") {
          event.preventDefault();
          onShortcut(shortcut);
        }
        return;
      }
      if (!send || !tabId) return;
      // Combinations the local browser reserves (⌘/Ctrl+T, W, N…) never reach the page.
      if (event.metaKey || (event.ctrlKey && !event.altKey && /^Key[NTW]$/.test(event.code)))
        return;
      event.preventDefault();
      // The legacy key code is what the engine needs for editing keys; browsers still provide it.
      const legacy = event as unknown as { keyCode: number };
      send(
        keyMessage(tabId, event.type === "keydown" ? "down" : "up", {
          key: event.key,
          code: event.code,
          keyCode: legacy.keyCode,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        }),
      );
    };
    // Text from the on-screen keyboard (touch devices), as the page would receive it.
    const keyboard = keyboardRef.current;
    const onBeforeInput = (event: InputEvent) => {
      event.preventDefault();
      if (!send || !tabId) return;
      if (event.inputType === "insertText" && event.data) {
        send({ type: "text", tabId, text: event.data.slice(0, 4096) });
      } else if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
        sendKey(send, tabId, "Enter", "Enter", 13);
      } else if (event.inputType === "deleteContentBackward") {
        sendKey(send, tabId, "Backspace", "Backspace", 8);
      }
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    area.addEventListener("keydown", onKey);
    area.addEventListener("keyup", onKey);
    keyboard?.addEventListener("beforeinput", onBeforeInput);
    return () => {
      area.removeEventListener("wheel", onWheel);
      area.removeEventListener("keydown", onKey);
      area.removeEventListener("keyup", onKey);
      keyboard?.removeEventListener("beforeinput", onBeforeInput);
    };
  }, [send, tabId, onShortcut]);

  function pointOf(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
    return {
      x: Math.min(canvas.width, Math.max(0, Math.round(x))),
      y: Math.min(canvas.height, Math.max(0, Math.round(y))),
    };
  }

  function mouse(
    kind: "move" | "down" | "up",
    event: ReactPointerEvent<HTMLDivElement>,
    overrides: Partial<Extract<ClientMessageInput, { type: "mouse" }>> = {},
  ) {
    if (!send || !tabId) return;
    const point = pointOf(event);
    send({
      type: "mouse",
      tabId,
      kind,
      x: point.x,
      y: point.y,
      button: kind === "move" ? "none" : buttonOf(event.button),
      buttons: event.buttons & 31,
      clickCount: kind === "move" ? 0 : 1,
      modifiers: modifiersOf(event),
      ...overrides,
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    areaRef.current?.focus({ preventScroll: true });
    if (event.pointerType === "touch") {
      const point = pointOf(event);
      touch.current = { x: point.x, y: point.y, moved: false, last: point };
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    mouse("down", event);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") {
      const start = touch.current;
      if (!start || !send || !tabId) return;
      const point = pointOf(event);
      if (Math.hypot(point.x - start.x, point.y - start.y) > TAP_SLOP_PX) start.moved = true;
      if (start.moved) {
        // A drag scrolls the page.
        send({
          type: "mouse",
          tabId,
          kind: "wheel",
          x: start.x,
          y: start.y,
          deltaX: clampDelta(start.last.x - point.x),
          deltaY: clampDelta(start.last.y - point.y),
          modifiers: 0,
        });
        start.last = point;
      }
      return;
    }
    mouse("move", event);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") {
      const start = touch.current;
      touch.current = null;
      if (!start || start.moved || !send || !tabId) return;
      // A tap is a click.
      const base = { type: "mouse" as const, tabId, x: start.x, y: start.y, modifiers: 0 };
      send({ ...base, kind: "move" });
      send({ ...base, kind: "down", button: "left", buttons: 1, clickCount: 1 });
      send({ ...base, kind: "up", button: "left", buttons: 0, clickCount: 1 });
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    mouse("up", event, { buttons: event.buttons & ~buttonBit(event.button) & 31 });
  }

  // The streamed page is an application region: every key and pointer event
  // belongs to the page inside it. A keyboard user reaches it with Tab and
  // leaves with Shift+Escape (jsx-a11y doesn't count "application" as interactive).
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      ref={areaRef}
      role="application"
      aria-label="Page shown by the cloud browser. Keys go to the page; press Shift and Escape to leave."
      tabIndex={0}
      data-frames={frames}
      data-testid="browser-viewport"
      className={cn(
        "relative flex min-h-0 flex-1 touch-none items-start justify-center overflow-hidden bg-[#fff] outline-none",
        "focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        touch.current = null;
      }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn("block max-h-full max-w-full", size ? "" : "hidden")}
        style={size ? { width: size.width, height: size.height } : undefined}
      />
      <textarea
        ref={keyboardRef}
        aria-label="Type into the page"
        className="absolute size-px opacity-0"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (!send || !tabId) return;
          if (event.key === "Enter" || event.key === "Backspace" || event.key === "Tab") {
            event.preventDefault();
            sendKey(send, tabId, event.key, event.code, EDITING_KEY_CODES[event.key] ?? 0);
          }
        }}
      />
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}

const EDITING_KEY_CODES: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9 };

function buttonBit(button: number): number {
  return [1, 4, 2, 8, 16][button] ?? 0;
}

function clampDelta(value: number): number {
  return Math.max(-4096, Math.min(4096, Math.round(value)));
}

function sendKey(
  send: (message: ClientMessageInput) => void,
  tabId: string,
  key: string,
  code: string,
  keyCode: number,
) {
  send({ type: "key", tabId, kind: "down", key, code, keyCode, modifiers: 0 });
  send({ type: "key", tabId, kind: "up", key, code, keyCode, modifiers: 0 });
}
