import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { HistoryController } from "./history.controller.js";
import { HistoryService } from "./history.service.js";

/** History, bookmarks and open tabs as Brawzer's own records (Phase 8, ideas 2 and 3; ADR 0020). */
@Module({
  imports: [AuthModule, DatabaseModule, SecurityEventsModule],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}
