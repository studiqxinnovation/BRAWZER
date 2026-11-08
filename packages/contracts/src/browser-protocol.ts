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
/** The most text one deliberate copy or paste carries between the page and the local computer. */
export const CLIPBOARD_MAX_CHARS = 65_536;

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

/** How many Drive files a page may be given at once. */
export const MAX_CHOSEN_FILES = 10;

/** The first message on a fresh connection to the relay: the single-use stream ticket. */
export const streamAuthMessageSchema = z.object({
  type: z.literal("ticket"),
  ticket: z.string().length(43),
});

/** Messages the page may send, apart from the file chooser's answer (which differs per hop). */
const baseClientMessages = [
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
  /** Save the tab as a PDF in Drive. */
  z.object({ type: z.literal("print"), tabId: tabIdSchema }),
  /** Find in page: the next (or previous) match of `text`; answered with `find-result`. */
  z.object({
    type: z.literal("find"),
    tabId: tabIdSchema,
    text: z.string().min(1).max(256),
    forward: z.boolean().default(true),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({ type: z.literal("find-stop"), tabId: tabIdSchema }),
  z.object({ type: z.literal("zoom"), tabId: tabIdSchema, factor: z.number().min(0.25).max(5) }),
  /** Reader view on or off; `reader` on the tab says what happened. */
  z.object({ type: z.literal("reader"), tabId: tabIdSchema, on: z.boolean() }),
  /** Clipboard with intent: the page's selected text, asked for on purpose; answered with `clipboard`. */
  z.object({ type: z.literal("copy"), tabId: tabIdSchema }),
  /** Text from the local computer's clipboard, typed into the page's focused field on purpose. */
  z.object({
    type: z.literal("paste"),
    tabId: tabIdSchema,
    text: z.string().min(1).max(CLIPBOARD_MAX_CHARS),
  }),
  z.object({ type: z.literal("ping") }),
] as const;

/** From the Browser page to the relay. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  ...baseClientMessages,
  /** The answer to a page's file chooser: Drive files to give it (none cancels). */
  z.object({
    type: z.literal("file-chooser"),
    tabId: tabIdSchema,
    chooserId: z.string().min(1).max(64),
    fileIds: z.array(z.uuid()).max(MAX_CHOSEN_FILES),
  }),
]);

/**
 * What the relay sends the agent: the page's messages, except that a file
 * chooser's answer carries the chosen files (name and size; the bytes follow
 * as transfer chunks) in place of the Drive ids only the relay can resolve.
 */
export const chosenFileSchema = z.object({
  transferId: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  bytes: z.number().int().min(0),
});

export const relayMessageSchema = z.discriminatedUnion("type", [
  ...baseClientMessages,
  z.object({
    type: z.literal("file-chooser"),
    tabId: tabIdSchema,
    chooserId: z.string().min(1).max(64),
    files: z.array(chosenFileSchema).max(MAX_CHOSEN_FILES),
  }),
]);

export const tabSecuritySchema = z.enum(["secure", "insecure", "neutral"]);

/**
 * A navigation the engine couldn't complete: the address it tried and the
 * engine's own code for why (Chromium's `ERR_…`, Firefox's `dnsNotFound`
 * and friends). Brawzer draws the explanation; the engine's page is never
 * what the person reads.
 */
export const navigationErrorSchema = z.object({
  url: z.string().max(4096),
  code: z.string().max(64),
});

export const tabStateSchema = z.object({
  id: tabIdSchema,
  url: z.string().max(4096),
  title: z.string().max(1024),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  security: tabSecuritySchema,
  error: navigationErrorSchema.nullable(),
  /** Layout zoom, 1 being none; kept per tab and re-applied as the tab loads pages. */
  zoom: z.number().min(0.25).max(5),
  /** Brawzer's reader view is showing in place of the page. */
  reader: z.boolean(),
});

export const ZOOM_LIMITS = { min: 0.25, max: 5 } as const;

export const dialogKinds = ["alert", "confirm", "prompt", "beforeunload"] as const;

/** What the cloud browser refused on the page's behalf, for Brawzer to explain. */
export const refusedActions = ["download", "upload", "print", "blocked-url"] as const;

/**
 * A file on its way from the cloud browser to Drive (a download or a printed
 * page). The agent reports the engine's side; the relay adds what happened
 * in Drive. Only the states the page needs to show reach it.
 */
export const transferStates = [
  /** The engine started receiving the file. */
  "started",
  /** The engine has the whole file and is handing it to the relay. */
  "received",
  /** Saved in Drive, clean. */
  "saved",
  /** Saved in Drive, but the scanner found something: quarantined. */
  "quarantined",
  /** Larger than the per-file limit; nothing was kept. */
  "too_large",
  /** The page or the engine gave up. */
  "canceled",
  /** Drive refused it (full, rate limit, scanner down) or the hand-off broke. */
  "failed",
] as const;
export const transferKinds = ["download", "print"] as const;

/** From the agent (or the relay) to the Browser page. */
export const agentMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    protocol: z.literal(BROWSER_PROTOCOL_VERSION),
    engine: z.object({
      name: z.enum(["bee", "firefox"]),
      /** What the engine says it is, such as "Chrome/156.0.8078.79" or "153.6.0esr". */
      version: z.string().max(64),
    }),
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
    type: z.literal("transfer"),
    transferId: z.string().min(1).max(64),
    tabId: tabIdSchema,
    kind: z.enum(transferKinds),
    /** The name the file will have in Drive (the engine's suggestion, cleaned up). */
    filename: z.string().max(255),
    state: z.enum(transferStates),
    /** Plaintext size, once known. */
    bytes: z.number().int().min(0).optional(),
    /** The Drive file, once saved. */
    fileId: z.uuid().optional(),
    /** Why it failed, for the person. */
    reason: z.string().max(512).optional(),
  }),
  /** A page asked for files; Brawzer offers Drive. Answered with a `file-chooser` client message. */
  z.object({
    type: z.literal("file-chooser"),
    tabId: tabIdSchema,
    chooserId: z.string().min(1).max(64),
    multiple: z.boolean(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["unauthorized", "replaced", "ended", "engine_failed", "bad_message"]),
    message: z.string().max(512),
  }),
  z.object({
    type: z.literal("find-result"),
    tabId: tabIdSchema,
    text: z.string().max(256),
    matches: z.number().int().min(0),
    /** 1-based; 0 when nothing matched. */
    active: z.number().int().min(0),
  }),
  /** Reader view was asked for and the page has no article to read. */
  z.object({ type: z.literal("reader-unavailable"), tabId: tabIdSchema }),
  /** The page's selected text, after a `copy`; empty when nothing is selected. */
  z.object({
    type: z.literal("clipboard"),
    tabId: tabIdSchema,
    text: z.string().max(CLIPBOARD_MAX_CHARS),
  }),
  z.object({ type: z.literal("pong") }),
]);

export type Viewport = z.infer<typeof viewportSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
/** What a sender may build: optional fields take their defaults when parsed. */
export type ClientMessageInput = z.input<typeof clientMessageSchema>;
export type RelayMessage = z.infer<typeof relayMessageSchema>;
export type ChosenFile = z.infer<typeof chosenFileSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type TabState = z.infer<typeof tabStateSchema>;
export type NavigationError = z.infer<typeof navigationErrorSchema>;
export type TabSecurity = z.infer<typeof tabSecuritySchema>;
export type DialogKind = (typeof dialogKinds)[number];
export type RefusedAction = (typeof refusedActions)[number];
export type TransferState = (typeof transferStates)[number];
export type TransferKind = (typeof transferKinds)[number];
export type TransferMessage = Extract<AgentMessage, { type: "transfer" }>;

/** Close codes the relay uses, so the page can tell why the stream stopped. */
export const STREAM_CLOSE_CODES = {
  unauthorized: 4001,
  replaced: 4002,
  ended: 4003,
  runtimeClosed: 4004,
  badMessage: 4005,
} as const;

// ── Binary messages ────────────────────────────────────────────────────────
//
// Two kinds share one layout: a magic byte, the protocol version, a big-endian
// uint32 header length, a JSON header, then the payload. `B` carries a
// screencast frame (JPEG) to the page; `T` carries a piece of a file between
// the agent and the relay (a download on its way to Drive, or a Drive file on
// its way to a page's file chooser). The page never sees `T` messages.

export const frameHeaderSchema = z.object({
  tabId: tabIdSchema,
  frameId: z.number().int().min(0),
  width: z.number().int().min(1).max(viewport.maxWidth),
  height: z.number().int().min(1).max(viewport.maxHeight),
});

export type FrameHeader = z.infer<typeof frameHeaderSchema>;

/** One piece of a file. Pieces arrive in order; `last` closes the file. */
export const transferChunkHeaderSchema = z.object({
  transferId: z.string().min(1).max(64),
  seq: z.number().int().min(0),
  last: z.boolean(),
});

export type TransferChunkHeader = z.infer<typeof transferChunkHeaderSchema>;

/** The largest payload in one transfer chunk. */
export const TRANSFER_CHUNK_BYTES = 256 * 1024;

const FRAME_MAGIC = 0x42; // "B"
const TRANSFER_MAGIC = 0x54; // "T"
const PREFIX_BYTES = 6; // magic, version, header length (uint32)

function encodeBinary(magic: number, header: object, payload: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(PREFIX_BYTES + headerBytes.length + payload.length);
  const view = new DataView(out.buffer);
  out[0] = magic;
  out[1] = BROWSER_PROTOCOL_VERSION;
  view.setUint32(2, headerBytes.length);
  out.set(headerBytes, PREFIX_BYTES);
  out.set(payload, PREFIX_BYTES + headerBytes.length);
  return out;
}

function decodeBinary(
  magic: number,
  bytes: Uint8Array,
): { header: unknown; payload: Uint8Array } | null {
  if (bytes.length < PREFIX_BYTES) return null;
  if (bytes[0] !== magic || bytes[1] !== BROWSER_PROTOCOL_VERSION) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(2);
  if (headerLength > 4096 || PREFIX_BYTES + headerLength > bytes.length) return null;
  let header: unknown;
  try {
    header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength)),
    );
  } catch {
    return null;
  }
  return { header, payload: bytes.subarray(PREFIX_BYTES + headerLength) };
}

/** Which kind of binary message this is, without decoding it. */
export function binaryKind(bytes: Uint8Array): "frame" | "transfer" | null {
  if (bytes.length < PREFIX_BYTES || bytes[1] !== BROWSER_PROTOCOL_VERSION) return null;
  if (bytes[0] === FRAME_MAGIC) return "frame";
  if (bytes[0] === TRANSFER_MAGIC) return "transfer";
  return null;
}

/** `B`, version, big-endian header length, the JSON header, then the JPEG bytes. */
export function encodeFrame(header: FrameHeader, image: Uint8Array): Uint8Array {
  return encodeBinary(FRAME_MAGIC, header, image);
}

/** Null for anything that isn't a well-formed frame. The image is a view, not a copy. */
export function decodeFrame(bytes: Uint8Array): { header: FrameHeader; image: Uint8Array } | null {
  const decoded = decodeBinary(FRAME_MAGIC, bytes);
  if (!decoded) return null;
  const header = frameHeaderSchema.safeParse(decoded.header);
  return header.success ? { header: header.data, image: decoded.payload } : null;
}

/** `T`, version, big-endian header length, the JSON header, then the file bytes. */
export function encodeTransferChunk(header: TransferChunkHeader, data: Uint8Array): Uint8Array {
  return encodeBinary(TRANSFER_MAGIC, header, data);
}

/** Null for anything that isn't a well-formed transfer chunk. The data is a view, not a copy. */
export function decodeTransferChunk(
  bytes: Uint8Array,
): { header: TransferChunkHeader; data: Uint8Array } | null {
  const decoded = decodeBinary(TRANSFER_MAGIC, bytes);
  if (!decoded) return null;
  const header = transferChunkHeaderSchema.safeParse(decoded.header);
  if (!header.success || decoded.payload.length > TRANSFER_CHUNK_BYTES) return null;
  return { header: header.data, data: decoded.payload };
}
