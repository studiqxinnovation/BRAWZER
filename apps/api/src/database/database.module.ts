import { createDatabase, type DatabaseHandle } from "@brawzer/db";
import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";

/** Injection token for the PostgreSQL connection pool and Drizzle client. */
export const DATABASE = Symbol.for("brawzer.api.database");

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}

@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabaseHandle =>
        createDatabase({ url: config.databaseUrl, applicationName: "brawzer-api" }),
    },
    DatabaseShutdown,
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
