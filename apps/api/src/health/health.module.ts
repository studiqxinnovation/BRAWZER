import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { RedisModule } from "../redis/redis.module.js";
import { ScanningModule } from "../scanning/scanning.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  imports: [DatabaseModule, RedisModule, StorageModule, ScanningModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
