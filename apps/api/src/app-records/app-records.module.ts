import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { AppRecordsController } from "./app-records.controller.js";
import { AppRecordsService } from "./app-records.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, RateLimitModule],
  controllers: [AppRecordsController],
  providers: [AppRecordsService],
  exports: [AppRecordsService],
})
export class AppRecordsModule {}
