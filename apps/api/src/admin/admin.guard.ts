import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiException } from "../common/api-exception.js";

/** After SessionGuard: only administrators. Everyone else gets a plain 403. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const auth = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!auth) throw new Error("AdminGuard must run after SessionGuard");
    if (auth.user.role !== "admin") {
      throw new ApiException("forbidden", 403, "This needs an administrator.");
    }
    return true;
  }
}
