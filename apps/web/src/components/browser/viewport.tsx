"use client";

import type { ClientMessageInput, CursorKind, FrameHeader, Viewport } from "@brawzer/contracts";
import { DRAG_FILE_TYPE, DRAG_PAGE_IMAGE_TYPE } from "@/components/desktop/desktop-context";
import { cn } from "@brawzer/ui/lib/cn";
import {
  type MouseEvent as ReactMouseEvent,
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
  /** Where a point on screen is in the page's own pixels (for a drop handed over by the desktop). */
  pointAt: (clientX: number, clientY: number) => { x: number; y: number };
  /** Draws the frame; `onDrawn` fires once it is on screen (or when it was skipped for a newer one). */
  draw(header: FrameHeader, image: Blob): void;
  focus(): void;
  /** Opens the on-screen keyboard on touch devices. */
  focusKeyboard(): void;
  /** What the page shows now, as drawn here; null before the first frame. */
  canvas(): HTMLCanvasElement | null;
  /**
   * A new connection is starting: the next frame drawn counts as the first
   * again, so `onReady` fires for it. Without this, a reconnect never lifts
   * the workspace's waiting overlay, though frames keep arriving under it.
   */
  restart(): void;
}

/** Brawzer's own shortcuts, handled by the workspace rather than sent to the page. */
export type Shortcut =
  | "address"
  | "new-tab"
  | "close-tab"
  | "back"
  | "forward"
  | "reload"
  | "print"
  | "leave"
  | "find"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "reader"
  | "copy"
  | "paste";

function shortcutOf(event: KeyboardEvent): Shortcut | null {
  if (event.key === "Escape" && event.shiftKey) return "leave";
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.shiftKey) return event.code === "KeyR" ? "reader" : null;
  switch (event.code) {
    case "KeyF":
      return "find";
    case "KeyC":
      return "copy";
    case "KeyV":
      return "paste";
    case "Equal":
    case "NumpadAdd":
      return "zoom-in";
    case "Minus":
    case "NumpadSubtract":
      return "zoom-out";
    case "Digit0":
    case "Numpad0":
      return "zoom-reset";
    case "KeyL":
      return "address";
    case "KeyT":
      return "new-tab";
    case "KeyW":
      return "close-tab";
    case "KeyR":
      return "reload";
    case "KeyP":
      return "print";
    case "ArrowLeft":
      return "back";
    case "ArrowRight":
      return "forward";
    default:
      return null;
  }
}

/** What a trackpad or touch gesture over the page asks for. */
export type Gesture = "back" | "forward" | "zoom-in" | "zoom-out";

/** How far a two-finger swipe travels sideways before it goes back or forward. */
const SWIPE_DISTANCE_PX = 260;
/** A swipe is one burst: sideways movement that stops for this long starts a new one. */
const SWIPE_REST_MS = 500;
/** Pinch (ctrl+wheel on a trackpad) distance per zoom step. */
const PINCH_STEP = 40;
/** A two-finger touch pinch changes zoom a step for every this much change in spread. */
const TOUCH_PINCH_RATIO = 1.25;

interface ViewportProps {
  ref?: Ref<ViewportHandle>;
  /** The cursor the page would show where the pointer is. */
  cursor?: CursorKind;
  /** Whether a sideways swipe should go back or forward now (not over something that scrolls sideways). */
  canSwipe?: () => boolean;
  onGesture?: (gesture: Gesture) => void;
  /** A right-click on the page: Brawzer's own menu for what is under the pointer. */
  onPageMenu?: (event: ReactMouseEvent<HTMLDivElement>, point: { x: number; y: number }) => void;
  /** Files dropped on the page: Drive files (by id) from Brawzer's own windows, or this computer's. */
  onDropFiles?: (
    point: { x: number; y: number },
    dropped: { fileIds: string[]; files: File[] },
  ) => void;
  /** The image under the pointer, if any, for dragging it out of the page with Alt held. */
  imageAt?: () => string | null;
  /** What a drag out carries: which session the image belongs to. */
  dragOutSession?: string | null;
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
 * The streamed page: a canvas showing the engine's frames, with the pointer
 * and keyboard forwarded to the page. A moving page's frames are at scale 1;
 * a still page's one sharp frame is at this screen's own pixel ratio, drawn
 * pixel for pixel. The canvas is only ever pixels; nothing from the page runs
 * here.
 */
export function BrowserViewport({
  ref,
  tabId,
  send,
  onDrawn,
  onViewport,
  onShortcut,
  onReady,
  cursor = "default",
  canSwipe,
  onGesture,
  onPageMenu,
  onDropFiles,
  imageAt,
  dragOutSession = null,
  className,
}: ViewportProps) {
  /** Set while Alt is held over an image: the next drag takes the image out, not the pointer in. */
  const [dragOut, setDragOut] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState(false);
  const gestureRef = useRef({ canSwipe, onGesture });
  gestureRef.current = { canSwipe, onGesture };
  /** A sideways swipe in progress: how far so far, and when it last moved. */
  const swipe = useRef<{ distance: number; at: number; fired: boolean } | null>(null);
  const pinch = useRef(0);
  /** Two fingers on the page: the spread they started at, and the zoom steps taken since. */
  const spread = useRef<{ start: number; steps: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  /** The canvas's size on screen, in CSS pixels: the page's size, whatever a frame's scale. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const sizeRef = useRef<{ width: number; height: number } | null>(null);
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
        }
        const shown = {
          width: Math.round(bitmap.width / next.header.scale),
          height: Math.round(bitmap.height / next.header.scale),
        };
        if (sizeRef.current?.width !== shown.width || sizeRef.current.height !== shown.height) {
          sizeRef.current = shown;
          setSize(shown);
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
      canvas() {
        const canvas = canvasRef.current;
        return canvas && readyRef.current && canvas.width > 0 ? canvas : null;
      },
      pointAt(clientX, clientY) {
        return pointOf({ clientX, clientY });
      },
      restart() {
        readyRef.current = false;
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
      onViewport(fitViewport(rect.width, rect.height, window.devicePixelRatio));
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(report, RESIZE_DEBOUNCE_MS);
    };
    report();
    const observer = new ResizeObserver(later);
    observer.observe(area);
    // The pixel ratio changes when the window moves to another screen or the page zooms.
    let density = matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    const onDensity = () => {
      later();
      density.removeEventListener("change", onDensity);
      density = matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
      density.addEventListener("change", onDensity);
    };
    density.addEventListener("change", onDensity);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      density.removeEventListener("change", onDensity);
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
      const gestures = gestureRef.current;
      // A trackpad pinch arrives as a wheel with Ctrl held: zoom, a step at a time.
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        pinch.current += event.deltaY * scale;
        while (Math.abs(pinch.current) >= PINCH_STEP) {
          gestures.onGesture?.(pinch.current < 0 ? "zoom-in" : "zoom-out");
          pinch.current -= Math.sign(pinch.current) * PINCH_STEP;
        }
        return;
      }
      // Two fingers sideways go back or forward, unless the page under the pointer scrolls that way.
      const deltaX = event.deltaX * scale;
      if (deltaX !== 0 && Math.abs(deltaX) > Math.abs(event.deltaY * scale)) {
        const now = performance.now();
        const ongoing =
          swipe.current &&
          now - swipe.current.at < SWIPE_REST_MS &&
          Math.sign(swipe.current.distance) === Math.sign(deltaX)
            ? swipe.current
            : { distance: 0, at: now, fired: false };
        ongoing.distance += deltaX;
        ongoing.at = now;
        swipe.current = ongoing;
        if (
          !ongoing.fired &&
          Math.abs(ongoing.distance) >= SWIPE_DISTANCE_PX &&
          gestures.canSwipe?.() !== false
        ) {
          ongoing.fired = true;
          gestures.onGesture?.(ongoing.distance < 0 ? "back" : "forward");
        }
      }
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

  /** Where on the page, in its CSS pixels, whatever scale the frame on the canvas has. */
  function pointOf(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const canvas = canvasRef.current;
    const page = sizeRef.current;
    if (!canvas || !page) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * page.width;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * page.height;
    return {
      x: Math.min(page.width, Math.max(0, Math.round(x))),
      y: Math.min(page.height, Math.max(0, Math.round(y))),
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

  /** The distance between the two touches, if there are two. */
  function touchSpread(): number | null {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  }

  /** What a drag can carry: Drive files from Brawzer's own windows, or this computer's files. */
  function carries(transfer: DataTransfer): boolean {
    return transfer.types.includes(DRAG_FILE_TYPE) || transfer.types.includes("Files");
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    areaRef.current?.focus({ preventScroll: true });
    // Alt and a press on an image: the drag that follows takes the image out to Files or the desktop.
    if (event.altKey && event.pointerType === "mouse" && event.button === 0) {
      const image = imageAt?.() ?? null;
      if (image) {
        setDragOut(image);
        return;
      }
    }
    if (event.pointerType === "touch") {
      const point = pointOf(event);
      pointers.current.set(event.pointerId, point);
      const distance = touchSpread();
      if (distance !== null) {
        // A second finger: the gesture is a pinch, not a scroll or a tap.
        spread.current = { start: distance, steps: 0 };
        touch.current = null;
        return;
      }
      touch.current = { x: point.x, y: point.y, moved: false, last: point };
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    mouse("down", event);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") {
      if (pointers.current.has(event.pointerId))
        pointers.current.set(event.pointerId, pointOf(event));
      const pinching = spread.current;
      const distance = touchSpread();
      if (pinching && distance !== null) {
        const steps = Math.round(Math.log(distance / pinching.start) / Math.log(TOUCH_PINCH_RATIO));
        while (pinching.steps !== steps) {
          const direction = steps > pinching.steps ? 1 : -1;
          pinching.steps += direction;
          gestureRef.current.onGesture?.(direction === 1 ? "zoom-in" : "zoom-out");
        }
        return;
      }
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
      pointers.current.delete(event.pointerId);
      if (spread.current) {
        if (pointers.current.size === 0) spread.current = null;
        return;
      }
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
      onPointerCancel={(event) => {
        touch.current = null;
        pointers.current.delete(event.pointerId);
        if (pointers.current.size === 0) spread.current = null;
      }}
      style={{ cursor }}
      data-cursor={cursor}
      data-drop={dropHint || undefined}
      draggable={dragOut !== null}
      onDragStart={(event) => {
        if (!dragOut || !dragOutSession) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(
          DRAG_PAGE_IMAGE_TYPE,
          JSON.stringify({ url: dragOut, session: dragOutSession }),
        );
        event.dataTransfer.setData("text/uri-list", dragOut);
      }}
      onDragEnd={() => {
        setDragOut(null);
      }}
      onDragOver={(event) => {
        if (!onDropFiles || !carries(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!dropHint) setDropHint(true);
      }}
      onDragLeave={() => {
        setDropHint(false);
      }}
      onDrop={(event) => {
        setDropHint(false);
        if (!onDropFiles || !carries(event.dataTransfer)) return;
        event.preventDefault();
        const fileIds: string[] = [];
        const own = event.dataTransfer.getData(DRAG_FILE_TYPE);
        if (own) {
          try {
            const parsed = JSON.parse(own) as { ids?: unknown };
            if (Array.isArray(parsed.ids)) {
              for (const id of parsed.ids) if (typeof id === "string") fileIds.push(id);
            }
          } catch {
            // Not Brawzer's own drag after all.
          }
        }
        const files = fileIds.length === 0 ? Array.from(event.dataTransfer.files) : [];
        if (fileIds.length === 0 && files.length === 0) return;
        onDropFiles(pointOf(event), { fileIds, files });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onPageMenu?.(event, pointOf(event));
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
