import {
  type BillingOverview,
  billingOverviewSchema,
  checkoutRequestSchema,
  checkoutResponseSchema,
  publicPlansSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { RecentAuthGuard } from "../auth/recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { BillingService } from "./billing.service.js";

@ApiTags("Billing")
@Controller({ path: "billing", version: "1" })
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get("plans")
  @SerializeOptions({ schema: publicPlansSchema })
  @ApiOperation({
    summary: "The plans this installation offers",
    description: "Prices come from Stripe and are absent until it is configured.",
  })
  @ApiOkResponse({ standardSchema: publicPlansSchema })
  async plans(): Promise<z.infer<typeof publicPlansSchema>> {
    return { plans: await this.billing.publicPlans() };
  }

  @Get()
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiUnauthorizedResponse({ description: "No valid session." })
  @SerializeOptions({ schema: billingOverviewSchema })
  @ApiOperation({ summary: "The account's plan, limits, usage and subscription" })
  @ApiOkResponse({ standardSchema: billingOverviewSchema })
  overview(@CurrentAuth() auth: AuthContext): Promise<BillingOverview> {
    return this.billing.overview(auth.user.id);
  }

  @Post("checkout")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: checkoutResponseSchema })
  @ApiOperation({
    summary: "Start paying for a plan",
    description: "Returns Stripe's hosted checkout URL. Needs a recent sign-in.",
  })
  @ApiOkResponse({ standardSchema: checkoutResponseSchema })
  @ApiServiceUnavailableResponse({ description: "Billing isn't configured here." })
  async checkout(
    @Body({ schema: checkoutRequestSchema }) body: z.output<typeof checkoutRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<z.infer<typeof checkoutResponseSchema>> {
    return { url: await this.billing.checkout(auth, body.planCode) };
  }

  @Post("portal")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: checkoutResponseSchema })
  @ApiOperation({
    summary: "Manage the subscription",
    description:
      "Returns Stripe's billing portal URL (invoices, payment method, cancelling). Needs a recent sign-in.",
  })
  @ApiOkResponse({ standardSchema: checkoutResponseSchema })
  async portal(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof checkoutResponseSchema>> {
    return { url: await this.billing.portal(auth) };
  }
}
