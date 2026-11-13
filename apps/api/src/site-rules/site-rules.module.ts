import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SiteRulesController } from "./site-rules.controller.js";
import { SiteRulesService } from "./site-rules.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SiteRulesController],
  providers: [SiteRulesService],
  exports: [SiteRulesService],
})
export class SiteRulesModule {}
