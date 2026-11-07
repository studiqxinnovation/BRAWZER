import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { ProfilesModule } from "../profiles/profiles.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { SecurityModule } from "../security/security.module.js";
import { AccountController } from "./account.controller.js";
import { AccountService } from "./account.service.js";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    EmailModule,
    RateLimitModule,
    SecurityEventsModule,
    SecurityModule,
    ProfilesModule,
  ],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
