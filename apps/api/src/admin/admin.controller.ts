import {
  type AdminAccount,
  type AdminAccountList,
  adminAccountListSchema,
  adminAccountQuerySchema,
  adminAccountSchema,
  adminSetPlanRequestSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Req,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { RecentAuthGuard } from "../auth/recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

@ApiTags("Admin")
@Controller({ path: "admin", version: "1" })
@UseGuards(SessionGuard, AdminGuard, RecentAuthGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not an administrator, or no recent sign-in." })
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get("accounts")
  @SerializeOptions({ schema: adminAccountListSchema })
  @ApiOperation({ summary: "Accounts, newest first, searchable by email" })
  @ApiOkResponse({ standardSchema: adminAccountListSchema })
  list(
    @Query({ schema: adminAccountQuerySchema }) query: z.output<typeof adminAccountQuerySchema>,
  ): Promise<AdminAccountList> {
    return this.admin.list(query);
  }

  @Get("accounts/:id")
  @SerializeOptions({ schema: adminAccountSchema })
  @ApiOperation({ summary: "One account: plan, limits, usage, subscription" })
  @ApiOkResponse({ standardSchema: adminAccountSchema })
  @ApiNotFoundResponse({ description: "No such account." })
  account(@Param("id", { schema: idSchema }) id: string): Promise<AdminAccount> {
    return this.admin.account(id);
  }

  @Put("accounts/:id/plan")
  @SerializeOptions({ schema: adminAccountSchema })
  @ApiOperation({
    summary: "Set an account's plan by hand",
    description:
      "A granted plan outranks the subscription until it is set back to free, which hands control back to Stripe. Recorded in the account's security history with the reason.",
  })
  @ApiOkResponse({ standardSchema: adminAccountSchema })
  setPlan(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: adminSetPlanRequestSchema }) body: z.output<typeof adminSetPlanRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<AdminAccount> {
    return this.admin.setPlan(auth, id, body.planCode, body.reason, requestMeta(request));
  }
}
