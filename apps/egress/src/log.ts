/** One JSON line per entry on stdout, which the container's log driver keeps. */
export function log(level: "info" | "warn" | "error", message: string, extra?: object): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), level, message, ...extra })}\n`,
  );
}
