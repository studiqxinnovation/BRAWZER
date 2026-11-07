import { type DatabaseHandle, schema, type SecurityEventType } from "@brawzer/db";
import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE, DatabaseModule } from "../database/database.module.js";

export interface SecurityEventInput {
  type: SecurityEventType;
  meta: RequestMeta;
  userId?: string | null;
  sessionId?: string | null;
  /** Small, non-sensitive facts only: never passwords, tokens or page addresses. */
  metadata?: Record<string, string | number | boolean>;
}

const logger = new Logger("SecurityEvents");

/** The account's security history. Recording never blocks or fails a request. */
@Injectable()
export class SecurityEventsService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async record(event: SecurityEventInput): Promise<void> {
    try {
      await this.database.db.insert(schema.securityEvents).values({
        type: event.type,
        userId: event.userId ?? null,
        sessionId: event.sessionId ?? null,
        ipAddress: event.meta.ip,
        userAgent: event.meta.userAgent,
        metadata: event.metadata ?? {},
      });
    } catch (error) {
      logger.error(
        `Could not record security event ${event.type}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [SecurityEventsService],
  exports: [SecurityEventsService],
})
export class SecurityEventsModule {}
