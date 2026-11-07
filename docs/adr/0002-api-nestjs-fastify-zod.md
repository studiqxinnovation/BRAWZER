# 0002 API: NestJS on Fastify with Zod contracts

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The API will grow to cover accounts, profiles, proxies, Drive, sessions,
security and billing. It handles credentials and personal data. It needs clear
module boundaries, strict validation and documentation that can't drift from
the code.

## Decision

- **NestJS 12** (ESM) on the **Fastify** adapter, for modules, dependency injection, guards and Fastify's mature plugins (helmet, cookies, multipart for Drive, rate limiting).
- **Zod 4 schemas in `packages/contracts`** are the single source of truth. NestJS 12's built-in `StandardSchemaValidationPipe` validates input, and `StandardSchemaSerializerInterceptor` filters output. `@nestjs/swagger` turns the same schemas into OpenAPI. The web app uses them to type its client. `nestjs-zod` isn't used: it doesn't support NestJS 12, and it isn't needed.
- **Explicit injection tokens** (`@Inject(TOKEN)`) for every dependency, so the API doesn't rely on TypeScript's decorator-metadata emit.
- **One error envelope** (`{ error: { code, message, details?, requestId } }`). Server errors are always generic to the client and logged in full on the server.
- **Structured logging** with pino through Fastify, with redaction at the source and no headers, query strings or IP addresses.
- **URI versioning** under `/api/v1`.

## Consequences

- Responses can only contain fields declared in their schema.
- Adding an endpoint means: a schema in `contracts`, a controller method with `@Body({ schema })` and `@SerializeOptions({ schema })`, and the API docs update automatically.
- `@nestjs/platform-node` is reportedly faster than Fastify. Revisit if API throughput, rather than browser streaming, ever becomes the bottleneck.
