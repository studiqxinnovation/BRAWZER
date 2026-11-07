import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityController } from "./security.controller.js";
import { SecurityHistoryService } from "./security.service.js";

/**
 * Reading the security history. Writing it is SecurityEventsModule's job;
 * keeping them apart avoids a cycle with AuthModule, which writes events and
 * provides the SessionGuard used here.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SecurityController],
  providers: [SecurityHistoryService],
})
export class SecurityModule {}
