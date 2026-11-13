import { count, type DatabaseHandle, eq, schema } from "@brawzer/db";
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiException } from "../common/api-exception.js";
import { DATABASE } from "../database/database.module.js";

/** How recently the owner must have proved who they are for sensitive changes. */
export const RECENT_AUTH_SECONDS = 10 * 60;

/**
 * For sensitive changes (passkeys, two-factor, email, deleting the account,
 * signing devices out): requires that the session's owner proved who they
 * are within the last 10 minutes. Otherwise responds 403
 * `reauthentication_required`, and the page asks them to confirm and retries.
 * Use after SessionGuard: `@UseGuards(SessionGuard, RecentAuthGuard)`.
 */
@Injectable()
export class RecentAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!auth) throw new Error("RecentAuthGuard must run after SessionGuard");
    assertRecentAuth(auth);
    return true;
  }
}

/** The guard's check, for routes where only some requests are sensitive. */
export function assertRecentAuth(auth: { session: { reauthenticatedAt: Date } }): void {
  const age = Date.now() - auth.session.reauthenticatedAt.getTime();
  if (age > RECENT_AUTH_SECONDS * 1000) {
    throw new ApiException("reauthentication_required", 403, "Confirm it’s you to continue.");
  }
}

/**
 * Like RecentAuthGuard, but the confirmation must have been a passkey
 * whenever the account has one: the phone's approval of a sign-in (Phase 8,
 * idea 11) is the one step where a password typed on a phone would still
 * matter. An account with no passkey can only confirm with its password.
 */
@Injectable()
export class RecentPasskeyAuthGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const auth = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!auth) throw new Error("RecentPasskeyAuthGuard must run after SessionGuard");
    assertRecentAuth(auth);
    if (auth.session.reauthMethod === "passkey") return true;
    const [row] = await this.database.db
      .select({ passkeys: count() })
      .from(schema.webauthnCredentials)
      .where(eq(schema.webauthnCredentials.userId, auth.user.id));
    if ((row?.passkeys ?? 0) === 0) return true;
    throw new ApiException(
      "reauthentication_required",
      403,
      "Confirm it’s you with your passkey to approve a sign-in.",
      { details: ["method: passkey"] },
    );
  }
}
