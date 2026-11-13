import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { WebAppsController } from "./web-apps.controller.js";
import { WebAppsService } from "./web-apps.service.js";

@Module({
  imports: [AuthModule],
  controllers: [WebAppsController],
  providers: [WebAppsService],
})
export class WebAppsModule {}
