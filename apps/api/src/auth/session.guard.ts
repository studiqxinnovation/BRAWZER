import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { signInRequired } from "../common/api-exception.js";
import { type AuthContext, SessionService } from "./session.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by {@link SessionGuard} on routes that need a signed-in person. */
    auth?: AuthContext;
  }
}

const PASSIVE_SESSION = "brawzer:passive-session";

/**
 * Marks a route whose calls must not count as activity, such as the
 * background check that notices a session was ended elsewhere. Otherwise
 * that check would keep an abandoned session alive forever.
 */
export const PassiveSession = () => SetMetadata(PASSIVE_SESSION, true);

/** Requires a valid session cookie; otherwise responds 401 and clears a stale cookie. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const token = this.sessions.readToken(request);
    const passive = this.reflector.getAllAndOverride<boolean | undefined>(PASSIVE_SESSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    const auth = await this.sessions.validate(token, { recordActivity: passive !== true });
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
