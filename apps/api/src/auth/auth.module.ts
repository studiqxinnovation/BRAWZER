import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { BreachedPasswordCheck } from "./breached-passwords.js";
import { ChallengeService } from "./challenges.js";
import { EmailTokenService } from "./email-token.service.js";
import { MfaController } from "./mfa/mfa.controller.js";
import { MfaService } from "./mfa/mfa.service.js";
import { PasskeyService } from "./passkeys/passkey.service.js";
import { PasskeysController } from "./passkeys/passkeys.controller.js";
import { RecentAuthGuard } from "./recent-auth.guard.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";
import { SessionsController } from "./sessions.controller.js";

@Module({
  imports: [DatabaseModule, RateLimitModule, EmailModule, SecurityEventsModule],
  controllers: [AuthController, SessionsController, PasskeysController, MfaController],
  providers: [
    AuthService,
    SessionService,
    EmailTokenService,
    SessionGuard,
    RecentAuthGuard,
    BreachedPasswordCheck,
    ChallengeService,
    PasskeyService,
    MfaService,
  ],
  // Later modules (profiles, sessions, Drive) protect their routes with SessionGuard.
  exports: [SessionService, SessionGuard, RecentAuthGuard, ChallengeService],
})
export class AuthModule {}
