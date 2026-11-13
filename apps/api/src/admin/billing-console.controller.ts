import {
  type ApprovalList,
  approvalDecisionSchema,
  approvalListSchema,
  type CouponList,
  type CouponResult,
  couponListSchema,
  couponResultSchema,
  couponToggleSchema,
  createCouponRequestSchema,
  type Finance,
  financeSchema,
  type InvoiceList,
  invoiceListSchema,
  invoiceQuerySchema,
  type RefundResult,
  refundRequestSchema,
  refundResultSchema,
  type SubscriptionList,
  subscriptionListSchema,
  type UpgradeSignalList,
  upgradeSignalListSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
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
import { StaffAuditService } from "./audit.service.js";
import { BillingConsoleService } from "./billing-console.service.js";
import { Permission, StaffGuard } from "./staff.guard.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });
const stripeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{3,80}$/, { error: "That isn’t a valid ID." });
const money = (amount: number, currency: string) =>
  `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** The console's money pages (Phase 11.3): Brawzer's records, and Stripe's where Stripe is configured. */
@ApiTags("Console")
@Controller({ path: "console/billing", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class BillingConsoleController {
  constructor(
    @Inject(BillingConsoleService) private readonly billing: BillingConsoleService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  @Get("subscriptions")
  @Permission("finance")
  @SerializeOptions({ schema: subscriptionListSchema })
  @ApiOperation({ summary: "Subscriptions as Brawzer last heard from Stripe" })
  @ApiOkResponse({ standardSchema: subscriptionListSchema })
  subscriptions(@CurrentAuth() auth: AuthContext): Promise<SubscriptionList> {
    return this.billing.subscriptions(auth);
  }

  @Get("invoices")
  @Permission("refund")
  @SerializeOptions({ schema: invoiceListSchema })
  @ApiOperation({ summary: "Invoices, read live from Stripe" })
  @ApiOkResponse({ standardSchema: invoiceListSchema })
  invoices(
    @Query({ schema: invoiceQuerySchema }) query: z.output<typeof invoiceQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<InvoiceList> {
    return this.billing.invoices(auth, query);
  }

  @Post("invoices/:id/refund")
  @Permission("refund")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: refundResultSchema })
  @ApiOperation({
    summary: "Refund part or all of an invoice; over the role's limit it waits for a founder",
  })
  @ApiOkResponse({ standardSchema: refundResultSchema })
  async refund(
    @Param("id", { schema: stripeIdSchema }) id: string,
    @Body({ schema: refundRequestSchema }) body: z.output<typeof refundRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RefundResult> {
    const result = await this.billing.refund(auth, id, body.amount, body.reason);
    await this.audit.record(auth, {
      action: result.outcome === "refunded" ? "Refunded an invoice" : "Requested approval: refund",
      target: id,
      detail: `${money(body.amount, result.currency)} · ${body.reason}`,
      meta: requestMeta(request),
    });
    return { outcome: result.outcome, approvalId: result.approvalId };
  }

  @Get("coupons")
  @Permission("coupon")
  @SerializeOptions({ schema: couponListSchema })
  @ApiOperation({ summary: "Promotion codes, read live from Stripe" })
  @ApiOkResponse({ standardSchema: couponListSchema })
  coupons(): Promise<CouponList> {
    return this.billing.coupons();
  }

  @Post("coupons")
  @Permission("coupon")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: couponResultSchema })
  @ApiOperation({ summary: "Create a promotion code; discounts over 15% wait for a founder" })
  @ApiOkResponse({ standardSchema: couponResultSchema })
  async createCoupon(
    @Body({ schema: createCouponRequestSchema }) body: z.output<typeof createCouponRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CouponResult> {
    const result = await this.billing.createCoupon(auth, body);
    await this.audit.record(auth, {
      action: result.outcome === "created" ? "Created a coupon" : "Requested approval: coupon",
      target: body.code,
      detail:
        body.percentOff !== undefined
          ? `${String(body.percentOff)}% off, ${body.duration}`
          : `${money(body.amountOff ?? 0, body.currency ?? "")} off, ${body.duration}`,
      meta: requestMeta(request),
    });
    return result;
  }

  @Patch("coupons/:id")
  @Permission("coupon")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: couponListSchema })
  @ApiOperation({ summary: "Turn a promotion code on or off" })
  @ApiOkResponse({ standardSchema: couponListSchema })
  async toggleCoupon(
    @Param("id", { schema: stripeIdSchema }) id: string,
    @Body({ schema: couponToggleSchema }) body: z.output<typeof couponToggleSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<CouponList> {
    const code = await this.billing.toggleCoupon(id, body.active);
    await this.audit.record(auth, {
      action: body.active ? "Turned on a coupon" : "Turned off a coupon",
      target: code,
      meta: requestMeta(request),
    });
    return this.billing.coupons();
  }

  @Get("finance")
  @Permission("finance")
  @SerializeOptions({ schema: financeSchema })
  @ApiOperation({ summary: "Monthly revenue movements from Brawzer's subscription records" })
  @ApiOkResponse({ standardSchema: financeSchema })
  finance(): Promise<Finance> {
    return this.billing.finance();
  }

  @Get("approvals")
  @Permission("approve")
  @SerializeOptions({ schema: approvalListSchema })
  @ApiOperation({ summary: "Requests waiting for a second person, and past decisions" })
  @ApiOkResponse({ standardSchema: approvalListSchema })
  approvals(): Promise<ApprovalList> {
    return this.billing.approvals();
  }

  @Post("approvals/:id/approve")
  @Permission("approve")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: approvalListSchema })
  @ApiOperation({ summary: "Approve and carry out; never your own request" })
  @ApiOkResponse({ standardSchema: approvalListSchema })
  async approve(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: approvalDecisionSchema }) body: z.output<typeof approvalDecisionSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ApprovalList> {
    const approval = await this.billing.decide(auth, id, true, body.reason);
    await this.audit.record(auth, {
      action: `Approved ${approval.kind}`,
      target: approval.target,
      detail: `${approval.what}${body.reason ? ` · ${body.reason}` : ""}`,
      meta: requestMeta(request),
    });
    return this.billing.approvals();
  }

  @Post("approvals/:id/decline")
  @Permission("approve")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: approvalListSchema })
  @ApiOperation({ summary: "Decline with a reason" })
  @ApiOkResponse({ standardSchema: approvalListSchema })
  async decline(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: approvalDecisionSchema }) body: z.output<typeof approvalDecisionSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ApprovalList> {
    const approval = await this.billing.decide(auth, id, false, body.reason);
    await this.audit.record(auth, {
      action: `Declined ${approval.kind}`,
      target: approval.target,
      detail: `${approval.what}${body.reason ? ` · ${body.reason}` : ""}`,
      meta: requestMeta(request),
    });
    return this.billing.approvals();
  }

  @Get("upgrade-signals")
  @Permission("dealEdit")
  @SerializeOptions({ schema: upgradeSignalListSchema })
  @ApiOperation({ summary: "Free accounts by what they do: the ones most likely to upgrade" })
  @ApiOkResponse({ standardSchema: upgradeSignalListSchema })
  upgradeSignals(@CurrentAuth() auth: AuthContext): Promise<UpgradeSignalList> {
    return this.billing.upgradeSignals(auth);
  }
}
