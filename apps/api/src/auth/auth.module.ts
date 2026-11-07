import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { EmailTokenService } from "./email-token.service.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [DatabaseModule, RateLimitModule, EmailModule, SecurityEventsModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, EmailTokenService, SessionGuard],
  // Later modules (profiles, sessions, Drive) protect their routes with SessionGuard.
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
