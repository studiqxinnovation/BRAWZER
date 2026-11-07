import type { LoggerService } from "@nestjs/common";
import { type DestinationStream, type Level, type Logger, type LoggerOptions, pino } from "pino";
import type { AppConfig } from "../config/env.js";

/**
 * Fields that must never reach a log line. Logs are retained and shipped to
 * third-party tooling, so credentials and tokens are removed at the source.
 */
export const REDACTED_PATHS = [
  "password",
  "token",
  "secret",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.secret",
  "*.apiKey",
  "*.proxyPassword",
  "*.cookie",
  "*.authorization",
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
];

/** Drops the query string, where tokens and personal data tend to end up. */
export function stripQuery(url: string): string {
  const index = url.indexOf("?");
  return index === -1 ? url : url.slice(0, index);
}

/**
 * Request log shape: method, path and request ID only. Headers, query strings
 * and client IP addresses are deliberately left out. Security events that need
 * an IP record it explicitly, with its own retention rules.
 */
export function serializeRequest(request: { id?: unknown; method?: unknown; url?: unknown }) {
  return {
    id: request.id,
    method: request.method,
    path: typeof request.url === "string" ? stripQuery(request.url) : undefined,
  };
}

export function serializeReply(reply: { statusCode?: unknown }) {
  return { statusCode: reply.statusCode };
}

type LoggerConfig = Pick<AppConfig, "logLevel" | "logFormat">;

function prettyTransportAvailable(): boolean {
  try {
    import.meta.resolve("pino-pretty");
    return true;
  } catch {
    return false; // pino-pretty is a dev dependency; production images log JSON.
  }
}

export function createLoggerOptions(config: LoggerConfig, pretty: boolean): LoggerOptions {
  return {
    level: config.logLevel,
    base: { service: "brawzer-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: "[Redacted]" },
    serializers: {
      req: serializeRequest,
      res: serializeReply,
      err: pino.stdSerializers.err,
    },
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" },
          },
        }
      : {}),
  };
}

/** Creates the API's root logger. Pass `destination` to capture output (tests). */
export function createLogger(config: LoggerConfig, destination?: DestinationStream): Logger {
  if (destination) return pino(createLoggerOptions(config, false), destination);
  const pretty = config.logFormat === "pretty" && prettyTransportAvailable();
  return pino(createLoggerOptions(config, pretty));
}

/** Routes Nest's own log calls into the same structured logger. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write("info", message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write("error", message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write("warn", message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write("debug", message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write("trace", message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write("fatal", message, params);
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    // Nest passes the context name as the last string argument, and for
    // error() a stack trace before it.
    const last = params.at(-1);
    const context = typeof last === "string" ? last : undefined;
    const rest = context === undefined ? params : params.slice(0, -1);
    const bindings: Record<string, unknown> = context ? { context } : {};

    if (message instanceof Error) {
      this.logger[level]({ ...bindings, err: message }, message.message);
      return;
    }
    const stack = rest.find((param): param is string => typeof param === "string");
    if (level === "error" && stack) bindings.stack = stack;
    this.logger[level](bindings, typeof message === "string" ? message : JSON.stringify(message));
  }
}
