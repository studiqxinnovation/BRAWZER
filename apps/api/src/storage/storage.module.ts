import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { type ObjectStore, S3ObjectStore } from "./object-store.js";

export const OBJECT_STORE = Symbol.for("brawzer.api.object-store");

/** Development and tests only: makes sure the bucket exists before anything uses it. */
@Injectable()
class StorageBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger("Storage");

  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.storage.createBucket) return;
    try {
      await this.store.ensureBucket();
    } catch (error) {
      // Drive won't work, but the rest of the API should still start locally.
      this.logger.warn(
        `Drive's object store isn't available: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}

@Module({
  providers: [
    {
      provide: OBJECT_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStore => new S3ObjectStore(config.storage),
    },
    StorageBootstrap,
  ],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
