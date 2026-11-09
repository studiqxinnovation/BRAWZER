import {
  type AdminRuntime,
  adminRuntimeSchema,
  type RewrapResult,
  rewrapResultSchema,
  type AdminAccount,
  type AdminAccountList,
  adminAccountListSchema,
  adminAccountQuerySchema,
  adminAccountSchema,
  adminSetPlanRequestSchema,
} from "@brawzer/contracts";
import {
  Delete,
  HttpCode,
  HttpStatus,
  Post,
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
import { BrowserService } from "../browser/browser.service.js";
import { RewrapService } from "../maintenance/rewrap.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

@ApiTags("Admin")
@Controller({ path: "admin", version: "1" })
@UseGuards(SessionGuard, AdminGuard, RecentAuthGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not an administrator, or no recent sign-in." })
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(RewrapService) private readonly rewrap: RewrapService,
    @Inject(BrowserService) private readonly browser: BrowserService,
  ) {}

  @Get("runtime")
  @SerializeOptions({ schema: adminRuntimeSchema })
  @ApiOperation({
    summary: "The cloud browser's hosts, warm pool and live sessions",
    description: "Who has a session, where and since when; never what it browses.",
  })
  @ApiOkResponse({ standardSchema: adminRuntimeSchema })
  runtime(): Promise<AdminRuntime> {
    return this.browser.adminRuntime();
  }

  @Delete("sessions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "End a cloud browser session",
    description:
      "Ends it as its owner's sign-out would: profile data is saved, the containers go, and the owner's security history says an administrator ended it.",
  })
  @ApiNotFoundResponse({ description: "No such session." })
  async endSession(@Param("id", { schema: idSchema }) id: string): Promise<void> {
    await this.browser.endByAdmin(id);
  }

  @Post("maintenance/rewrap")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: rewrapResultSchema })
  @ApiOperation({
    summary: "Re-wrap every secret under the current encryption key",
    description:
      "After rotating the key-encryption key: every sealed value still wrapped by a previous key is re-wrapped now, so the previous key can be retired. Also runs on the maintenance cadence.",
  })
  @ApiOkResponse({ standardSchema: rewrapResultSchema })
  async rewrapSecrets(): Promise<RewrapResult> {
    const result = await this.rewrap.run();
    return result ? { ...result, ran: true } : { rewrapped: {}, failed: 0, ran: false };
  }

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
