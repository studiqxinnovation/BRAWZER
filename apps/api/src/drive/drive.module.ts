import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { RedisModule } from "../redis/redis.module.js";
import { ScanningModule } from "../scanning/scanning.module.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { StorageModule } from "../storage/storage.module.js";
import { DriveController } from "./drive.controller.js";
import { DriveService } from "./drive.service.js";
import { DownloadTickets } from "./tickets.js";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    CryptoModule,
    StorageModule,
    ScanningModule,
    RedisModule,
    RateLimitModule,
    SecurityEventsModule,
    BillingModule,
  ],
  controllers: [DriveController],
  providers: [DriveService, DownloadTickets],
  exports: [DriveService],
})
export class DriveModule {}
