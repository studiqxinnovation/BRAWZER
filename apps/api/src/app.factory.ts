import { randomUUID } from "node:crypto";
import { sessionCookieName } from "@brawzer/contracts";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import {
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { LogController } from "fastify";
import type { Logger } from "pino";
import { AppModule } from "./app.module.js";
import { SESSION_AUTH } from "./auth/auth.controller.js";
import { StreamGateway } from "./browser/stream-gateway.js";
import { ApiExceptionFilter, errorBody } from "./common/api-exception.filter.js";
import { isAllowedOrigin, isUnsafeMethod } from "./common/request-meta.js";
import type { AppConfig } from "./config/env.js";
import { createLogger, NestPinoLogger } from "./logging/logger.js";

export interface CreateAppOptions {
  /** Replace the root logger (tests pass a silent one). */
  logger?: Logger;
}

const ONE_MEGABYTE = 1_048_576;

/** Builds a fully configured API application without starting to listen. */
export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const logger = options.logger ?? createLogger(config);

  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    trustProxy: typeof config.trustProxy === "boolean" ? config.trustProxy : [...config.trustProxy],
    bodyLimit: ONE_MEGABYTE,
    // Request IDs are always generated here; a client-supplied ID is never trusted.
    genReqId: () => randomUUID(),
    logController: new LogController({ requestIdLogLabel: "requestId" }),
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    adapter,
    {
      logger: new NestPinoLogger(logger),
      abortOnError: false,
    },
  );

  app.enableShutdownHooks();
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // Every request body, query and param is validated against the Zod schema
  // declared on the route; every response is filtered through its schema, so
  // fields that are not part of the contract can never leak.
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new ApiExceptionFilter(logger));

  await app.register(helmet, {
    // JSON responses get a strict CSP below; the docs UI needs inline assets.
    contentSecurityPolicy: false,
    hsts: config.isProduction
      ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
      : false,
  });

  // Session tokens are random and checked against the database, so cookies
  // don't need signing.
  await app.register(cookie);

  // Drive uploads: one file per request, streamed (never buffered in full).
  // The size limit is enforced by the upload pipeline, which knows the message
  // to give; busboy's own limit sits above it so it never fires first.
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 5,
      fieldSize: 1024,
      fileSize: config.drive.maxFileBytes + 1024,
      headerPairs: 200,
    },
  });

  const fastify = app.getHttpAdapter().getInstance();

  // The cloud browser stream: a WebSocket outside Nest's routing, relayed to
  // the session's runtime by the gateway (see browser/stream-gateway.ts).
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  const gateway = app.get(StreamGateway);
  fastify.get("/api/v1/browser/sessions/:id/stream", { websocket: true }, (socket, request) => {
    gateway.handle(socket, request);
  });

  // Cross-site request forgery: a state-changing request must come from one
  // of Brawzer's own pages. Future webhook routes (billing) will authenticate
  // with signatures instead and be listed here as exceptions.
  fastify.addHook("onRequest", (request, reply, done) => {
    if (
      isUnsafeMethod(request.method) &&
      request.url.startsWith("/api/") &&
      !isAllowedOrigin(request.headers, config.allowedOrigins)
    ) {
      void reply
        .code(403)
        .header("Cache-Control", "no-store")
        .send(
          errorBody(
            "forbidden",
            "This request didn’t come from a Brawzer page, so it was blocked.",
            request.id,
          ),
        );
      return;
    }
    done();
  });

  fastify.addHook("onSend", (_request, reply, payload, done) => {
    // Nothing the API returns may be stored by a browser or proxy cache:
    // on a shared computer, a cached response is a leaked response.
    void reply.header("Cache-Control", "no-store");
    const contentType = reply.getHeader("content-type");
    if (typeof contentType === "string" && contentType.startsWith("application/json")) {
      void reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    }
    done(null, payload);
  });

  if (config.apiDocsEnabled) setUpApiDocs(app, config);

  return app;
}

function setUpApiDocs(app: NestFastifyApplication, config: AppConfig): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Brawzer API")
      .setDescription(
        "Brawzer's application API. These interactive docs exist for development and are disabled in production.",
      )
      .setVersion(config.version)
      .addCookieAuth(
        sessionCookieName(config.secureCookies),
        { type: "apiKey", in: "cookie" },
        SESSION_AUTH,
      )
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api/docs/openapi.json",
    customSiteTitle: "Brawzer API",
  });
}
