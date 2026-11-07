import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { signInRequired } from "../common/api-exception.js";
import { type AuthContext, SessionService } from "./session.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by {@link SessionGuard} on routes that need a signed-in person. */
    auth?: AuthContext;
  }
}

/** Requires a valid session cookie; otherwise responds 401 and clears a stale cookie. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const token = this.sessions.readToken(request);
    const auth = await this.sessions.validate(token);
    if (!auth) {
      const hadSession = token !== undefined;
      if (hadSession) this.sessions.clearCookie(http.getResponse<FastifyReply>());
      throw signInRequired(hadSession);
    }
    request.auth = auth;
    return true;
  }
}

/** The signed-in person and session. Only valid on routes protected by {@link SessionGuard}. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const auth = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!auth) throw new Error("@CurrentAuth() needs @UseGuards(SessionGuard) on the route");
    return auth;
  },
);
