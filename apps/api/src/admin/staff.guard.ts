import { can, isStaffRole, type StaffPermission } from "@brawzer/contracts";
import { and, count, type DatabaseHandle, eq, isNotNull, schema } from "@brawzer/db";
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ApiException } from "../common/api-exception.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { requestMeta } from "../common/request-meta.js";
import { StaffAuditService } from "./audit.service.js";

const PERMISSION = "brawzer:staff-permission";

/** The permission a console route needs, from the one table in the contracts. */
export const Permission = (permission: StaffPermission) => SetMetadata(PERMISSION, permission);

/**
 * After SessionGuard: only staff, and only staff whose role has the route's
 * permission. In production, staff must also have a passkey or an
 * authenticator app, as the console's security rules say. A refusal is
 * written to the audit log, so a role that tries a page it can't open is
 * seen trying.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = request.auth;
    if (!auth) throw new Error("StaffGuard must run after SessionGuard");
    const role = auth.user.role;
    if (!isStaffRole(role)) {
      throw new ApiException("forbidden", 403, "This needs a member of staff.");
    }
    if (this.config.staffSecondFactorRequired && !(await this.hasSecondFactor(auth.user.id))) {
      throw new ApiException(
        "forbidden",
        403,
        "Staff need a passkey or an authenticator app on their account before they can use the console.",
        { details: ["second_factor_required"] },
      );
    }
    const permission = this.reflector.getAllAndOverride<StaffPermission | undefined>(PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permission && !can(role, permission)) {
      await this.audit.record(auth, {
        action: "Tried something without access",
        target: `${request.method} ${request.url.split("?")[0] ?? ""}`,
        detail: `Needs: ${permission}. Blocked.`,
        meta: requestMeta(request),
      });
      throw new ApiException("forbidden", 403, "Your role can’t do this.");
    }
    return true;
  }

  async hasSecondFactor(userId: string): Promise<boolean> {
    const [[passkeys], [factors]] = await Promise.all([
      this.database.db
        .select({ count: count() })
        .from(schema.webauthnCredentials)
        .where(eq(schema.webauthnCredentials.userId, userId)),
      this.database.db
        .select({ count: count() })
        .from(schema.totpFactors)
        .where(
          and(eq(schema.totpFactors.userId, userId), isNotNull(schema.totpFactors.confirmedAt)),
        ),
    ]);
    return (passkeys?.count ?? 0) > 0 || (factors?.count ?? 0) > 0;
  }
}
