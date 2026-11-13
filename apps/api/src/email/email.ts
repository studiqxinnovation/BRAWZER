import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import { type EmailCategory, type EmailPreferences, emailCategorySchema } from "@brawzer/contracts";
import { and, type DatabaseHandle, eq, gt, isNull, schema } from "@brawzer/db";
import { generateToken, hashToken, isWellFormedToken } from "../auth/tokens.js";
import { EMAIL_LINK_LIFETIME_SECONDS } from "../auth/session-policy.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE, DatabaseModule } from "../database/database.module.js";
import { EmailDeliveryService } from "./delivery.js";
import {
  adminNoticeMessage,
  fileQuarantinedMessage,
  paymentFailedMessage,
  setMarkUrl,
  subscriptionChangedMessage,
  subscriptionEndedMessage,
  subscriptionEndingMessage,
  subscriptionStartedMessage,
  teamMemberJoinedMessage,
  teamMemberRemovedMessage,
  teamOwnershipTransferredMessage,
  trialEndingMessage,
  welcomeMessage,
  accountDeletedMessage,
  accountExistsMessage,
  confirmEmailChangeMessage,
  type EmailContent,
  emailChangedMessage,
  emailChangeRevertedMessage,
  emailChangeUndoneMessage,
  emailChangeRequestedMessage,
  emailInUseMessage,
  mfaDisabledMessage,
  mfaEnabledMessage,
  newDeviceSignInMessage,
  phoneSignInMessage,
  usageNoticeMessage,
  teamInvitationMessage,
  passkeyAddedMessage,
  passkeyRemovedMessage,
  passwordChangedMessage,
  recoveryCodeUsedMessage,
  resetPasswordMessage,
  type SignedOutScope,
  verifyEmailMessage,
  abuseWarningMessage,
  extensionBlockedMessage,
  recoveryCancelledMessage,
  recoveryConfirmMessage,
  recoveryReleasedMessage,
  recoveryWaitingMessage,
  ticketReceivedMessage,
  ticketReplyMessage,
  weeklySummaryMessage,
} from "./templates.js";
import { createTransport, type EmailTransport, maskEmail } from "./transports.js";

export const EMAIL_TRANSPORT = Symbol.for("brawzer.api.email-transport");

const logger = new Logger("Email");

/** The emails a person may turn off, as the account keeps them; a key left out means yes. */
export function preferencesOf(prefs: Readonly<Record<string, boolean>>): EmailPreferences {
  return { usageNotices: prefs.usageNotices !== false, teamUpdates: prefs.teamUpdates !== false };
}

/**
 * Sends Brawzer's transactional email. Messages go out in the background, so
 * a response never takes longer because an email was (or wasn't) sent: that
 * would reveal whether an account exists. Nothing goes to an address the
 * provider reported as undeliverable, and optional notices respect the
 * account's preferences and carry a one-click way to stop them.
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(EmailDeliveryService) private readonly delivery: EmailDeliveryService,
  ) {
    setMarkUrl(`${config.webOrigin}/brand/mark.png`);
  }

  /** Link into the web app. Tokens travel in the URL fragment, which is never sent to servers or logs. */
  link(path: string, token?: string): string {
    return `${this.config.webOrigin}${path}${token ? `#token=${token}` : ""}`;
  }

  private dispatch(
    to: string,
    content: EmailContent,
    extra: { category: string; headers?: Record<string, string>; idempotencyKey?: string } = {
      category: "account",
    },
  ): void {
    void (async () => {
      if (await this.delivery.isSuppressed(to)) {
        logger.warn(`Not sending "${content.subject}" to ${maskEmail(to)}: address suppressed`);
        return;
      }
      await this.transport.send({
        to,
        ...content,
        tags: { category: extra.category },
        ...(extra.headers ? { headers: extra.headers } : {}),
        ...(extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}),
      });
    })().catch((error: unknown) => {
      logger.error(
        `Could not deliver "${content.subject}" to ${maskEmail(to)}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    });
  }

  // ── Preferences and one-click unsubscribe ────────────────────────────

  async preferences(userId: string): Promise<EmailPreferences> {
    const [row] = await this.database.db
      .select({ prefs: schema.users.emailPrefs })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return preferencesOf(row?.prefs ?? {});
  }

  async setPreferences(
    userId: string,
    patch: Partial<EmailPreferences>,
  ): Promise<EmailPreferences> {
    const current = await this.preferences(userId);
    const next = { ...current, ...patch };
    await this.database.db
      .update(schema.users)
      .set({ emailPrefs: next, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
    return next;
  }

  /**
   * An optional notice for an account: sent only if the account wants that
   * kind, with a footer link and List-Unsubscribe headers that turn it off
   * in one click. The token lives in the database like any email link.
   */
  /** The footer link that turns one kind of email off for the account; the token lives in the database like any email link. */
  async issueUnsubscribeLink(userId: string, category: EmailCategory): Promise<string> {
    const token = generateToken();
    await this.database.db.insert(schema.emailTokens).values({
      userId,
      purpose: "unsubscribe",
      tokenHash: hashToken(token),
      newEmail: category,
      expiresAt: new Date(Date.now() + EMAIL_LINK_LIFETIME_SECONDS.unsubscribe * 1000),
    });
    return this.link("/unsubscribe", token);
  }

  private async optional(
    userId: string,
    to: string,
    category: EmailCategory,
    compose: (unsubscribeUrl: string) => EmailContent,
  ): Promise<void> {
    const prefs = await this.preferences(userId);
    if (!prefs[category]) return;
    const url = await this.issueUnsubscribeLink(userId, category);
    this.dispatch(to, compose(url), {
      category,
      headers: {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  }

  /** Applies a footer link's token: that kind of email is turned off for its account. */
  async unsubscribe(token: string): Promise<{ category: EmailCategory; email: string } | null> {
    if (!isWellFormedToken(token)) return null;
    const [row] = await this.database.db
      .select({ token: schema.emailTokens, user: schema.users })
      .from(schema.emailTokens)
      .innerJoin(schema.users, eq(schema.users.id, schema.emailTokens.userId))
      .where(
        and(
          eq(schema.emailTokens.tokenHash, hashToken(token)),
          eq(schema.emailTokens.purpose, "unsubscribe"),
          isNull(schema.emailTokens.usedAt),
          gt(schema.emailTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) return null;
    const category = emailCategorySchema.safeParse(row.token.newEmail);
    if (!category.success) return null;
    await this.setPreferences(row.user.id, { [category.data]: false });
    await this.database.db
      .update(schema.emailTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.emailTokens.id, row.token.id));
    return { category: category.data, email: maskEmail(row.user.email) };
  }

  // ── The project's own notices, to its administrators ─────────────────

  notifyAdmins(
    kind: "sign-up" | "subscription" | "report" | "quarantine" | "ticket" | "recovery",
    facts: readonly (readonly [string, string])[],
    idempotencyKey?: string,
  ): void {
    if (this.config.email.adminNotifications === "none") return;
    const content = adminNoticeMessage(
      kind,
      facts,
      this.link(
        kind === "ticket" ? "/admin/inbox" : kind === "recovery" ? "/admin/recovery" : "/app/admin",
      ),
    );
    for (const admin of this.config.adminEmails) {
      this.dispatch(admin, content, {
        category: `admin-${kind}`,
        ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}:${admin}` } : {}),
      });
    }
  }

  // ── The weekly founder email ─────────────────────────────────────────

  sendWeeklySummary(
    to: string,
    weekOf: string,
    facts: readonly (readonly [string, string])[],
    needsYou: readonly string[],
  ): void {
    this.dispatch(to, weeklySummaryMessage(weekOf, facts, needsYou, this.link("/admin")), {
      category: "weekly",
    });
  }

  // ── Abuse ────────────────────────────────────────────────────────────

  sendAbuseWarning(to: string, kind: string, note: string): void {
    this.dispatch(to, abuseWarningMessage(kind, note, this.link("/app/shield")));
  }

  // ── Extensions ───────────────────────────────────────────────────────

  sendExtensionBlocked(to: string, name: string, reason: string): void {
    this.dispatch(to, extensionBlockedMessage(name, reason, this.link("/app/extensions")));
  }

  // ── Account recovery ─────────────────────────────────────────────────

  sendRecoveryConfirm(to: string, token: string): void {
    this.dispatch(to, recoveryConfirmMessage(this.link("/recover/confirm", token)));
  }

  sendRecoveryWaiting(to: string, releaseAt: Date, cancelToken: string): void {
    const when = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(releaseAt);
    this.dispatch(
      to,
      recoveryWaitingMessage(`${when} UTC`, this.link("/recover/cancel", cancelToken)),
    );
  }

  sendRecoveryCancelled(to: string): void {
    this.dispatch(to, recoveryCancelledMessage());
  }

  sendRecoveryReleased(to: string, resetToken: string): void {
    this.dispatch(to, recoveryReleasedMessage(this.link("/reset-password", resetToken)));
  }

  // ── Support requests ─────────────────────────────────────────────────

  sendTicketReceived(to: string, number: number, subject: string, ticketId: string): void {
    this.dispatch(
      to,
      ticketReceivedMessage(number, subject, this.link(`/app/help?ticket=${ticketId}`)),
      { category: "support" },
    );
  }

  sendTicketReply(
    to: string,
    number: number,
    subject: string,
    reply: string,
    solved: boolean,
    ticketId: string,
  ): void {
    this.dispatch(
      to,
      ticketReplyMessage(number, subject, reply, solved, this.link(`/app/help?ticket=${ticketId}`)),
      { category: "support" },
    );
  }

  // ── After sign-up, billing, Drive and teams ──────────────────────────

  sendWelcome(to: string, name: string | null = null): void {
    this.dispatch(
      to,
      welcomeMessage(this.link("/app"), `${this.config.webOrigin}/security`, name),
      {
        category: "welcome",
      },
    );
  }

  sendSubscriptionStarted(
    to: string,
    plan: string,
    price: string | null,
    renewsOn: string | null,
    trialEndsOn: string | null,
    eventId: string,
  ): void {
    this.dispatch(
      to,
      subscriptionStartedMessage(plan, price, renewsOn, trialEndsOn, this.link("/app/account")),
      { category: "billing", idempotencyKey: `started:${eventId}` },
    );
  }

  sendSubscriptionChanged(
    to: string,
    plan: string,
    renewsOn: string | null,
    eventId: string,
  ): void {
    this.dispatch(to, subscriptionChangedMessage(plan, renewsOn, this.link("/app/account")), {
      category: "billing",
      idempotencyKey: `changed:${eventId}`,
    });
  }

  sendSubscriptionEnding(to: string, plan: string, endsOn: string, eventId: string): void {
    this.dispatch(to, subscriptionEndingMessage(plan, endsOn, this.link("/app/account")), {
      category: "billing",
      idempotencyKey: `ending:${eventId}`,
    });
  }

  sendSubscriptionEnded(to: string, plan: string, eventId: string): void {
    this.dispatch(to, subscriptionEndedMessage(plan, this.link("/app/account")), {
      category: "billing",
      idempotencyKey: `ended:${eventId}`,
    });
  }

  sendPaymentFailed(
    to: string,
    plan: string,
    amount: string | null,
    retryOn: string | null,
    eventId: string,
  ): void {
    this.dispatch(to, paymentFailedMessage(plan, amount, retryOn, this.link("/app/account")), {
      category: "billing",
      idempotencyKey: `payment-failed:${eventId}`,
    });
  }

  sendTrialEnding(
    to: string,
    plan: string,
    endsOn: string,
    price: string | null,
    eventId: string,
  ): void {
    this.dispatch(to, trialEndingMessage(plan, endsOn, price, this.link("/app/account")), {
      category: "billing",
      idempotencyKey: `trial-ending:${eventId}`,
    });
  }

  sendFileQuarantined(
    to: string,
    name: string,
    threat: string | null,
    source: "upload" | "browser",
    fileId: string,
  ): void {
    this.dispatch(
      to,
      fileQuarantinedMessage(
        name,
        threat,
        source,
        this.now(),
        this.link(`/app/drive?file=${fileId}`),
      ),
      { category: "security" },
    );
  }

  /** To the team's owner and admins, if they want team updates. */
  sendTeamMemberJoined(
    recipients: readonly { id: string; email: string }[],
    team: string,
    who: string,
  ): void {
    for (const recipient of recipients) {
      void this.optional(recipient.id, recipient.email, "teamUpdates", (unsubscribeUrl) =>
        teamMemberJoinedMessage(team, who, this.link("/app/team"), unsubscribeUrl),
      ).catch((error: unknown) => {
        logger.error(`Team notice failed: ${error instanceof Error ? error.message : ""}`);
      });
    }
  }

  sendTeamMemberRemoved(to: string, team: string): void {
    this.dispatch(to, teamMemberRemovedMessage(team, this.link("/app/account")), {
      category: "team",
    });
  }

  sendTeamOwnershipTransferred(to: string, team: string, from: string): void {
    this.dispatch(to, teamOwnershipTransferredMessage(team, from, this.link("/app/team")), {
      category: "team",
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

  sendEmailChangeLink(to: string, token: string): void {
    this.dispatch(to, confirmEmailChangeMessage(this.link("/confirm-email-change", token)));
  }

  /** Sent to the new address instead of a link when another account already uses it. */
  sendEmailInUse(to: string): void {
    this.dispatch(to, emailInUseMessage(this.link("/sign-in")));
  }

  sendEmailChangeRequested(to: string, newEmail: string): void {
    this.dispatch(to, emailChangeRequestedMessage(maskEmail(newEmail), this.now()));
  }

  /** To the old address, with the link that undoes the change. */
  sendEmailChanged(to: string, newEmail: string, undoToken: string): void {
    this.dispatch(
      to,
      emailChangedMessage(
        maskEmail(newEmail),
        this.now(),
        this.link("/undo-email-change", undoToken),
      ),
    );
  }

  sendEmailChangeUndone(to: string): void {
    this.dispatch(to, emailChangeUndoneMessage(this.now(), this.link("/sign-in")));
  }

  /** To the address that was removed by the undo. */
  sendEmailChangeReverted(to: string): void {
    this.dispatch(to, emailChangeRevertedMessage(this.now()));
  }

  sendAccountDeleted(to: string): void {
    this.dispatch(to, accountDeletedMessage(this.now()));
  }

  sendNewDeviceSignIn(to: string, device: string, ip: string | null): void {
    this.dispatch(to, newDeviceSignInMessage(device, ip, this.now(), this.link("/app/sessions")));
  }

  sendUsageNotice(
    to: string,
    kind: "browsing" | "storage" | "files",
    percent: number,
    used: string,
    limit: string,
  ): void {
    this.dispatch(to, usageNoticeMessage(kind, percent, used, limit, this.link("/app/account")));
  }

  /** To an invited address: the Team page, where the verified account with it can join. */
  sendTeamInvitation(to: string, team: string, invitedBy: string): void {
    this.dispatch(to, teamInvitationMessage(team, invitedBy, this.link("/app/team")));
  }

  sendPhoneSignIn(to: string, device: string | null, ip: string | null): void {
    this.dispatch(to, phoneSignInMessage(device, ip, this.now(), this.link("/app/sessions")));
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
  imports: [DatabaseModule],
  providers: [
    {
      provide: EMAIL_TRANSPORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailTransport =>
        createTransport(config.email, (message) => {
          logger.log(message);
        }),
    },
    EmailDeliveryService,
    EmailService,
  ],
  exports: [EmailService, EmailDeliveryService],
})
export class EmailModule {}
