import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import {
  accountExistsMessage,
  type EmailContent,
  mfaDisabledMessage,
  mfaEnabledMessage,
  passkeyAddedMessage,
  passkeyRemovedMessage,
  passwordChangedMessage,
  recoveryCodeUsedMessage,
  resetPasswordMessage,
  type SignedOutScope,
  verifyEmailMessage,
} from "./templates.js";
import { createTransport, type EmailTransport, maskEmail } from "./transports.js";

export const EMAIL_TRANSPORT = Symbol.for("brawzer.api.email-transport");

const logger = new Logger("Email");

/**
 * Sends Brawzer's transactional email. Messages go out in the background, so
 * a response never takes longer because an email was (or wasn't) sent: that
 * would reveal whether an account exists.
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Link into the web app. Tokens travel in the URL fragment, which is never sent to servers or logs. */
  link(path: string, token?: string): string {
    return `${this.config.webOrigin}${path}${token ? `#token=${token}` : ""}`;
  }

  private dispatch(to: string, content: EmailContent): void {
    this.transport.send({ to, ...content }).catch((error: unknown) => {
      logger.error(
        `Could not deliver "${content.subject}" to ${maskEmail(to)}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    });
  }

  sendVerification(to: string, token: string): void {
    this.dispatch(to, verifyEmailMessage(this.link("/verify-email", token)));
  }

  sendPasswordReset(to: string, token: string): void {
    this.dispatch(to, resetPasswordMessage(this.link("/reset-password", token)));
  }

  sendAccountExists(to: string): void {
    this.dispatch(to, accountExistsMessage(this.link("/sign-in")));
  }

  private now(): string {
    const when = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date());
    return `${when} UTC`;
  }

  sendPasskeyAdded(to: string, name: string, device: string | null): void {
    this.dispatch(to, passkeyAddedMessage(name, this.now(), device));
  }

  sendMfaEnabled(to: string): void {
    this.dispatch(to, mfaEnabledMessage(this.now()));
  }

  sendMfaDisabled(to: string): void {
    this.dispatch(to, mfaDisabledMessage(this.now()));
  }

  sendRecoveryCodeUsed(to: string, remaining: number): void {
    this.dispatch(to, recoveryCodeUsedMessage(this.now(), remaining));
  }

  sendPasskeyRemoved(to: string, name: string): void {
    this.dispatch(to, passkeyRemovedMessage(name, this.now()));
  }

  sendPasswordChanged(to: string, device: string | null, scope: SignedOutScope): void {
    const when = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date());
    this.dispatch(to, passwordChangedMessage(`${when} UTC`, device, scope));
  }
}

@Module({
  providers: [
    {
      provide: EMAIL_TRANSPORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailTransport =>
        createTransport(config.email, (message) => {
          logger.log(message);
        }),
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
