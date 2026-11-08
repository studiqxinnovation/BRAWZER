import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiException } from "../common/api-exception.js";

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
