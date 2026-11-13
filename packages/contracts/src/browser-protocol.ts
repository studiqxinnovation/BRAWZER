import { z } from "zod";
import { BROWSER_LIMITS } from "./browser.ts";

/**
 * The cloud browser stream (ADR 0006, step 3a): one WebSocket between the
 * Browser page and the runtime agent, relayed by the API. Control messages
 * are JSON text frames in both directions; page pixels travel as binary
 * frames (see {@link encodeFrame}). Every message is validated on arrival by
 * the relay and again by the agent.
 */
export const BROWSER_PROTOCOL_VERSION = 1;

const { viewport } = BROWSER_LIMITS;

export const viewportSchema = z.object({
  width: z.number().int().min(viewport.minWidth).max(viewport.maxWidth),
  height: z.number().int().min(viewport.minHeight).max(viewport.maxHeight),
});

const tabIdSchema = z.string().min(1).max(64);

/** Chrome DevTools Protocol modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const modifiersSchema = z.number().int().min(0).max(15).default(0);

/** Only web addresses are ever opened: no file, chrome, javascript or data URLs. */
export const browserUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { error: "Only http and https addresses can be opened." },
  );

/** The first message on a fresh connection to the relay: the single-use stream ticket. */
export const streamAuthMessageSchema = z.object({
  type: z.literal("ticket"),
  ticket: z.string().length(43),
});

/** From the Browser page to the agent. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), viewport: viewportSchema }),
  z.object({ type: z.literal("resize"), viewport: viewportSchema }),
  z.object({ type: z.literal("navigate"), tabId: tabIdSchema, url: browserUrlSchema }),
  z.object({ type: z.literal("back"), tabId: tabIdSchema }),
  z.object({ type: z.literal("forward"), tabId: tabIdSchema }),
  z.object({ type: z.literal("reload"), tabId: tabIdSchema }),
  z.object({ type: z.literal("stop"), tabId: tabIdSchema }),
  z.object({ type: z.literal("new-tab"), url: browserUrlSchema.optional() }),
  z.object({ type: z.literal("close-tab"), tabId: tabIdSchema }),
  z.object({ type: z.literal("activate-tab"), tabId: tabIdSchema }),
  z.object({
    type: z.literal("mouse"),
    tabId: tabIdSchema,
    kind: z.enum(["move", "down", "up", "wheel"]),
    x: z.number().min(0).max(viewport.maxWidth),
    y: z.number().min(0).max(viewport.maxHeight),
    button: z.enum(["none", "left", "middle", "right", "back", "forward"]).default("none"),
    /** Buttons held, as a bitmask (left 1, right 2, middle 4, back 8, forward 16). */
    buttons: z.number().int().min(0).max(31).default(0),
    clickCount: z.number().int().min(0).max(3).default(0),
    deltaX: z.number().min(-4096).max(4096).default(0),
    deltaY: z.number().min(-4096).max(4096).default(0),
    modifiers: modifiersSchema,
  }),
  z.object({
    type: z.literal("key"),
    tabId: tabIdSchema,
    kind: z.enum(["down", "up"]),
    key: z.string().min(1).max(32),
    code: z.string().max(32),
    /** The legacy key code, which Chromium needs for editing keys (Backspace, arrows, Enter). */
    keyCode: z.number().int().min(0).max(255),
    /** The character a key-down inserts, if any. */
    text: z.string().max(8).optional(),
    modifiers: modifiersSchema,
  }),
  /** Text from an input method (composition, dictation): inserted as typed. */
  z.object({ type: z.literal("text"), tabId: tabIdSchema, text: z.string().min(1).max(4096) }),
  /** The page drew this frame; the agent passes it on so the engine sends the next one. */
  z.object({ type: z.literal("frame-ack"), tabId: tabIdSchema, frameId: z.number().int().min(0) }),
  z.object({
    type: z.literal("dialog"),
    tabId: tabIdSchema,
    accept: z.boolean(),
    text: z.string().max(4096).optional(),
  }),
  z.object({ type: z.literal("ping") }),
]);

export const tabSecuritySchema = z.enum(["secure", "insecure", "neutral"]);

export const tabStateSchema = z.object({
  id: tabIdSchema,
  url: z.string().max(4096),
  title: z.string().max(1024),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  security: tabSecuritySchema,
});

export const dialogKinds = ["alert", "confirm", "prompt", "beforeunload"] as const;

/** What the cloud browser refused on the page's behalf, for Brawzer to explain. */
export const refusedActions = ["download", "upload", "print", "blocked-url"] as const;

/** From the agent (or the relay) to the Browser page. */
export const agentMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    protocol: z.literal(BROWSER_PROTOCOL_VERSION),
    engine: z.object({ name: z.literal("chromium"), version: z.string().max(64) }),
    tabs: z.array(tabStateSchema),
    activeTabId: tabIdSchema,
  }),
  z.object({
    type: z.literal("tabs"),
    tabs: z.array(tabStateSchema),
    activeTabId: tabIdSchema,
  }),
  z.object({
    type: z.literal("dialog"),
    tabId: tabIdSchema,
    kind: z.enum(dialogKinds),
    message: z.string().max(4096),
    defaultValue: z.string().max(4096),
  }),
  z.object({
    type: z.literal("refused"),
    tabId: tabIdSchema,
    action: z.enum(refusedActions),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["unauthorized", "replaced", "ended", "engine_failed", "bad_message"]),
    message: z.string().max(512),
  }),
  z.object({ type: z.literal("pong") }),
]);

export type Viewport = z.infer<typeof viewportSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
/** What a sender may build: optional fields take their defaults when parsed. */
export type ClientMessageInput = z.input<typeof clientMessageSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type TabState = z.infer<typeof tabStateSchema>;
export type TabSecurity = z.infer<typeof tabSecuritySchema>;
export type DialogKind = (typeof dialogKinds)[number];
export type RefusedAction = (typeof refusedActions)[number];

/** Close codes the relay uses, so the page can tell why the stream stopped. */
export const STREAM_CLOSE_CODES = {
  unauthorized: 4001,
  replaced: 4002,
  ended: 4003,
  runtimeClosed: 4004,
  badMessage: 4005,
} as const;

// ── Binary frames ──────────────────────────────────────────────────────────

export const frameHeaderSchema = z.object({
  tabId: tabIdSchema,
  frameId: z.number().int().min(0),
  width: z.number().int().min(1).max(viewport.maxWidth),
  height: z.number().int().min(1).max(viewport.maxHeight),
});

export type FrameHeader = z.infer<typeof frameHeaderSchema>;

const FRAME_MAGIC = 0x42; // "B"
const FRAME_PREFIX_BYTES = 6; // magic, version, header length (uint32)

/** `B`, version, big-endian header length, the JSON header, then the JPEG bytes. */
export function encodeFrame(header: FrameHeader, image: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(FRAME_PREFIX_BYTES + headerBytes.length + image.length);
  const view = new DataView(out.buffer);
  out[0] = FRAME_MAGIC;
  out[1] = BROWSER_PROTOCOL_VERSION;
  view.setUint32(2, headerBytes.length);
  out.set(headerBytes, FRAME_PREFIX_BYTES);
  out.set(image, FRAME_PREFIX_BYTES + headerBytes.length);
  return out;
}

/** Null for anything that isn't a well-formed frame. The image is a view, not a copy. */
export function decodeFrame(bytes: Uint8Array): { header: FrameHeader; image: Uint8Array } | null {
  if (bytes.length < FRAME_PREFIX_BYTES) return null;
  if (bytes[0] !== FRAME_MAGIC || bytes[1] !== BROWSER_PROTOCOL_VERSION) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(2);
  if (headerLength > 4096 || FRAME_PREFIX_BYTES + headerLength > bytes.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(
        bytes.subarray(FRAME_PREFIX_BYTES, FRAME_PREFIX_BYTES + headerLength),
      ),
    );
  } catch {
    return null;
  }
  const header = frameHeaderSchema.safeParse(parsed);
  if (!header.success) return null;
  return { header: header.data, image: bytes.subarray(FRAME_PREFIX_BYTES + headerLength) };
}
