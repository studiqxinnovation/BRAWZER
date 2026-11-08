import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { encodeAudioChunk } from "@brawzer/contracts";
import { log } from "./log.ts";

/** What the page hears: one channel, 24 kHz, 16-bit, in 20 ms pieces. Plenty for speech and music on a stream. */
export const AUDIO_SAMPLE_RATE = 24_000;
export const AUDIO_CHANNELS = 1;
const CHUNK_MS = 20;
const CHUNK_BYTES = (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 2 * CHUNK_MS) / 1000;
const SINK = "brawzer";

export interface AudioSink {
  /** False when the sink can't take the chunk right now; it is then dropped. */
  sendAudio(bytes: Uint8Array): boolean;
}

/**
 * Sound in the cloud browser (Phase 3b): a PulseAudio server of the session's
 * own, with one null sink that both engines play into (they find it through
 * `PULSE_SERVER`), and a capture of that sink's monitor that the agent streams
 * to the viewer as short PCM chunks. Nothing else in the container hears or
 * speaks; the socket lives in the scratch space.
 */
export class SessionAudio {
  private server: ChildProcess | null = null;
  private capture: ChildProcess | null = null;
  private sink: AudioSink | null = null;
  private on = true;
  private seq = 0;
  private pending: Buffer = Buffer.alloc(0);
  readonly socketPath: string;

  constructor(private readonly scratchDir: string) {
    this.socketPath = path.join(scratchDir, "pulse", "native");
  }

  /** Environment that makes an engine play into the session's sink. */
  env(): Record<string, string> {
    return {
      PULSE_SERVER: `unix:${this.socketPath}`,
      PULSE_SINK: SINK,
      XDG_RUNTIME_DIR: path.join(this.scratchDir, "xdg"),
    };
  }

  /** Starts the server and waits for its socket; a missing PulseAudio means no sound, not no session. */
  async start(): Promise<boolean> {
    const dir = path.dirname(this.socketPath);
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(this.scratchDir, "xdg"), { recursive: true });
    mkdirSync(path.join(this.scratchDir, "home", ".config", "pulse"), { recursive: true });
    const child = spawn(
      "pulseaudio",
      [
        "--daemonize=no",
        "--exit-idle-time=-1",
        "--disallow-exit",
        "--use-pid-file=no",
        "-n",
        `--load=module-null-sink sink_name=${SINK} sink_properties=device.description=Brawzer`,
        `--load=module-native-protocol-unix auth-anonymous=1 socket=${this.socketPath}`,
        "--log-target=stderr",
        "--log-level=error",
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: path.join(this.scratchDir, "home"),
          XDG_RUNTIME_DIR: path.join(this.scratchDir, "xdg"),
          DBUS_SESSION_BUS_ADDRESS: "disabled:",
        },
      },
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (line: string) => {
      log("warn", "pulseaudio", { line: line.trim().slice(0, 300) });
    });
    child.on("error", (error) => {
      log("warn", "pulseaudio could not start", { message: error.message });
    });
    child.on("exit", (code) => {
      log("info", "pulseaudio exited", { code });
      this.server = null;
    });
    this.server = child;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!this.running()) return false;
      if (await this.ready()) {
        log("info", "sound ready", { sink: SINK });
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    log("warn", "pulseaudio did not become ready; the session has no sound");
    return false;
  }

  /** Read through a call: the exit handler clears the field from another turn of the loop. */
  private running(): boolean {
    return this.server !== null;
  }

  private ready(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn("pactl", ["info"], { env: this.processEnv(), stdio: "ignore" });
      check.on("error", () => resolve(false));
      check.on("exit", (code) => resolve(code === 0));
    });
  }

  private processEnv(): Record<string, string> {
    return { PATH: process.env.PATH ?? "/usr/bin:/bin", ...this.env() };
  }

  /** Streams the sink's monitor to `sink` while a viewer is attached and sound is on. */
  attach(sink: AudioSink): void {
    this.sink = sink;
    this.update();
  }

  detach(sink: AudioSink): void {
    if (this.sink === sink) this.sink = null;
    this.update();
  }

  setOn(on: boolean): void {
    this.on = on;
    this.update();
  }

  private update(): void {
    const wanted = this.server !== null && this.sink !== null && this.on;
    if (wanted && !this.capture) this.startCapture();
    else if (!wanted && this.capture) this.stopCapture();
  }

  private startCapture(): void {
    const child = spawn(
      "parec",
      [
        `--device=${SINK}.monitor`,
        "--format=s16le",
        `--rate=${String(AUDIO_SAMPLE_RATE)}`,
        `--channels=${String(AUDIO_CHANNELS)}`,
        "--latency-msec=40",
        "--raw",
      ],
      { stdio: ["ignore", "pipe", "ignore"], env: this.processEnv() },
    );
    child.stdout.on("data", (data: Buffer) => {
      this.pending = this.pending.length === 0 ? data : Buffer.concat([this.pending, data]);
      while (this.pending.length >= CHUNK_BYTES) {
        const chunk = this.pending.subarray(0, CHUNK_BYTES);
        this.pending = this.pending.subarray(CHUNK_BYTES);
        // Silence costs nothing to skip: the page plays nothing when nothing arrives.
        if (isSilent(chunk)) continue;
        const bytes = encodeAudioChunk(
          { seq: this.seq, sampleRate: AUDIO_SAMPLE_RATE, channels: AUDIO_CHANNELS },
          new Uint8Array(chunk),
        );
        this.seq = (this.seq + 1) % 1_000_000_000;
        this.sink?.sendAudio(bytes);
      }
    });
    child.on("exit", (code) => {
      if (this.capture === child) {
        this.capture = null;
        if (code !== 0 && code !== null) log("warn", "audio capture exited", { code });
      }
    });
    child.on("error", (error) => {
      log("warn", "audio capture could not start", { message: error.message });
    });
    this.capture = child;
  }

  private stopCapture(): void {
    const child = this.capture;
    this.capture = null;
    this.pending = Buffer.alloc(0);
    child?.kill("SIGTERM");
  }

  close(): void {
    this.stopCapture();
    this.server?.kill("SIGTERM");
    this.server = null;
  }
}

/** All samples within a hair of zero: nothing is playing. */
function isSilent(chunk: Buffer): boolean {
  for (let offset = 0; offset + 1 < chunk.length; offset += 2) {
    const sample = chunk.readInt16LE(offset);
    if (sample > 8 || sample < -8) return false;
  }
  return true;
}
