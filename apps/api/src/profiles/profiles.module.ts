import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { ProfilesController } from "./profiles.controller.js";
import { ProfilesService } from "./profiles.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, SecurityEventsModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
