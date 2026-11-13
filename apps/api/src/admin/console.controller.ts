import {
  type AdminSettings,
  adminSettingsSchema,
  type CompanyOverview,
  companyOverviewSchema,
  type Customer,
  type CustomerActivity,
  customerActivitySchema,
  type CustomerBilling,
  customerBillingSchema,
  type CustomerBrowsers,
  customerBrowsersSchema,
  type CustomerDrive,
  customerDriveSchema,
  type CustomerList,
  customerListSchema,
  type CustomerPrivacy,
  customerPrivacySchema,
  customerQuerySchema,
  customerSchema,
  type CustomerSignIn,
  customerSignInSchema,
  driveFileSchema,
  type Growth,
  growthSchema,
  type Organisation,
  type OrganisationList,
  organisationListSchema,
  organisationSchema,
  reasonRequestSchema,
  type RevealResponse,
  revealResponseSchema,
  type StaffActionList,
  staffActionListSchema,
  staffActionQuerySchema,
  staffInviteRequestSchema,
  type StaffList,
  staffListSchema,
  type StaffNote,
  staffNoteRequestSchema,
  staffNoteSchema,
  staffRoleRequestSchema,
  adminSetPlanRequestSchema,
  type DriveFile,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
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
import { StaffAuditService } from "./audit.service.js";
import { CompanyService } from "./company.service.js";
import { CustomersService } from "./customers.service.js";
import { Permission, StaffGuard } from "./staff.guard.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });
const notesSchema = z.array(staffNoteSchema);
const refusedPageSchema = z.object({ page: z.string().trim().min(1).max(80) });

/**
 * The admin console's API (Phase 11). Every route needs a signed-in member
 * of staff whose role has the route's permission; the ones that change
 * something also need a recent sign-in, and they write the audit log.
 */
@ApiTags("Console")
@Controller({ path: "console", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class ConsoleController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(CompanyService) private readonly company: CompanyService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  /* ── Company ── */

  @Get("overview")
  @Permission("priceEdit")
  @SerializeOptions({ schema: companyOverviewSchema })
  @ApiOperation({ summary: "The company overview: the founder's page" })
  @ApiOkResponse({ standardSchema: companyOverviewSchema })
  overview(@CurrentAuth() auth: AuthContext): Promise<CompanyOverview> {
    return this.company.overview(auth);
  }

  @Get("growth")
  @Permission("dealEdit")
  @SerializeOptions({ schema: growthSchema })
  @ApiOperation({ summary: "Growth and retention, from the database" })
  @ApiOkResponse({ standardSchema: growthSchema })
  growth(): Promise<Growth> {
    return this.company.growth();
  }

  @Get("settings")
  @Permission("coupon")
  @SerializeOptions({ schema: adminSettingsSchema })
  @ApiOperation({ summary: "Plans as configured, and the connected services" })
  @ApiOkResponse({ standardSchema: adminSettingsSchema })
  settings(): Promise<AdminSettings> {
    return this.company.settings();
  }

  /* ── The team ── */

  @Get("staff")
  @Permission("staff")
  @SerializeOptions({ schema: staffListSchema })
  @ApiOperation({ summary: "The team: every member of staff and their role" })
  @ApiOkResponse({ standardSchema: staffListSchema })
  staff(): Promise<StaffList> {
    return this.company.staff();
  }

  @Post("staff")
  @Permission("staff")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: staffListSchema })
  @ApiOperation({ summary: "Give an existing account a staff role" })
  @ApiOkResponse({ standardSchema: staffListSchema })
  @ApiNotFoundResponse({ description: "No account has that address." })
  invite(
    @Body({ schema: staffInviteRequestSchema }) body: z.output<typeof staffInviteRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffList> {
    return this.company.invite(auth, body.email, body.role, requestMeta(request));
  }

  @Put("staff/:id/role")
  @Permission("staff")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: staffListSchema })
  @ApiOperation({ summary: "Change a staff member's role" })
  @ApiOkResponse({ standardSchema: staffListSchema })
  setRole(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: staffRoleRequestSchema }) body: z.output<typeof staffRoleRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffList> {
    return this.company.setRole(auth, id, body.role, requestMeta(request));
  }

  @Post("staff/:id/remove")
  @Permission("staff")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: staffListSchema })
  @ApiOperation({ summary: "Remove someone from the team: their account becomes a customer's" })
  @ApiOkResponse({ standardSchema: staffListSchema })
  removeStaff(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffList> {
    return this.company.remove(auth, id, body.reason, requestMeta(request));
  }

  /* ── The audit log ── */

  @Post("refused")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "A page this role can't open was tried: logged, as the prototype logs it",
  })
  async refused(
    @Body({ schema: refusedPageSchema }) body: z.output<typeof refusedPageSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.audit.record(auth, {
      action: "Tried to open a page without access",
      target: body.page,
      detail: "Blocked",
      meta: requestMeta(request),
    });
  }

  @Get("audit")
  @Permission("dsar")
  @SerializeOptions({ schema: staffActionListSchema })
  @ApiOperation({ summary: "Every staff action, newest first" })
  @ApiOkResponse({ standardSchema: staffActionListSchema })
  auditLog(
    @Query({ schema: staffActionQuerySchema }) query: z.output<typeof staffActionQuerySchema>,
  ): Promise<StaffActionList> {
    return this.audit.list(query);
  }

  /* ── Organisations ── */

  @Get("organisations")
  @Permission("notes")
  @SerializeOptions({ schema: organisationListSchema })
  @ApiOperation({ summary: "Every team" })
  @ApiOkResponse({ standardSchema: organisationListSchema })
  async organisations(): Promise<OrganisationList> {
    return { organisations: await this.company.organisations() };
  }

  @Get("organisations/:id")
  @Permission("notes")
  @SerializeOptions({ schema: organisationSchema })
  @ApiOperation({ summary: "One team: members and invitations" })
  @ApiOkResponse({ standardSchema: organisationSchema })
  organisation(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Organisation> {
    return this.company.organisation(auth, id);
  }

  /* ── Customers ── */

  @Get("customers")
  @Permission("notes")
  @SerializeOptions({ schema: customerListSchema })
  @ApiOperation({ summary: "Accounts with their plan, status and account check" })
  @ApiOkResponse({ standardSchema: customerListSchema })
  list(
    @Query({ schema: customerQuerySchema }) query: z.output<typeof customerQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CustomerList> {
    return this.customers.list(auth, query);
  }

  @Get("customers/:id")
  @Permission("notes")
  @SerializeOptions({ schema: customerSchema })
  @ApiOperation({ summary: "One account: the 360 view's head and overview" })
  @ApiOkResponse({ standardSchema: customerSchema })
  @ApiNotFoundResponse({ description: "No such account." })
  one(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Customer> {
    return this.customers.one(auth, id);
  }

  @Post("customers/:id/reveal")
  @Permission("reveal")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: revealResponseSchema })
  @ApiOperation({
    summary: "Reveal the account's address, with a reason that goes to the audit log",
  })
  @ApiOkResponse({ standardSchema: revealResponseSchema })
  reveal(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RevealResponse> {
    return this.customers.reveal(auth, id, body.reason, requestMeta(request));
  }

  @Get("customers/:id/sign-in")
  @Permission("notes")
  @SerializeOptions({ schema: customerSignInSchema })
  @ApiOperation({ summary: "Sign-in methods, devices and sign-in history" })
  @ApiOkResponse({ standardSchema: customerSignInSchema })
  signIn(@Param("id", { schema: idSchema }) id: string): Promise<CustomerSignIn> {
    return this.customers.signIn(id);
  }

  @Get("customers/:id/billing")
  @Permission("notes")
  @SerializeOptions({ schema: customerBillingSchema })
  @ApiOperation({ summary: "Plan, subscription, limits and usage" })
  @ApiOkResponse({ standardSchema: customerBillingSchema })
  billing(@Param("id", { schema: idSchema }) id: string): Promise<CustomerBilling> {
    return this.customers.billingOf(id);
  }

  @Get("customers/:id/browsers")
  @Permission("notes")
  @SerializeOptions({ schema: customerBrowsersSchema })
  @ApiOperation({ summary: "Live cloud browser sessions and profiles" })
  @ApiOkResponse({ standardSchema: customerBrowsersSchema })
  browsers(@Param("id", { schema: idSchema }) id: string): Promise<CustomerBrowsers> {
    return this.customers.browsersOf(id);
  }

  @Get("customers/:id/drive")
  @Permission("notes")
  @SerializeOptions({ schema: customerDriveSchema })
  @ApiOperation({ summary: "Drive usage and Trash" })
  @ApiOkResponse({ standardSchema: customerDriveSchema })
  drive(@Param("id", { schema: idSchema }) id: string): Promise<CustomerDrive> {
    return this.customers.driveOf(id);
  }

  @Get("customers/:id/activity")
  @Permission("notes")
  @SerializeOptions({ schema: customerActivitySchema })
  @ApiOperation({ summary: "The account's history, with staff actions on it" })
  @ApiOkResponse({ standardSchema: customerActivitySchema })
  activity(@Param("id", { schema: idSchema }) id: string): Promise<CustomerActivity> {
    return this.customers.activityOf(id);
  }

  @Get("customers/:id/privacy")
  @Permission("notes")
  @SerializeOptions({ schema: customerPrivacySchema })
  @ApiOperation({ summary: "What Brawzer holds about the account" })
  @ApiOkResponse({ standardSchema: customerPrivacySchema })
  privacy(@Param("id", { schema: idSchema }) id: string): Promise<CustomerPrivacy> {
    return this.customers.privacyOf(id);
  }

  /* ── Customer actions ── */

  @Post("customers/:id/notes")
  @Permission("notes")
  @HttpCode(HttpStatus.OK)
  // Nest's serializer runs an array response through the schema item by item.
  @SerializeOptions({ schema: staffNoteSchema })
  @ApiOperation({ summary: "Add an internal note" })
  @ApiOkResponse({ standardSchema: notesSchema })
  addNote(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: staffNoteRequestSchema }) body: z.output<typeof staffNoteRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffNote[]> {
    return this.customers.addNote(auth, id, body.body, body.pinned, requestMeta(request));
  }

  @Delete("customers/:id/notes/:noteId")
  @Permission("notes")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: staffNoteSchema })
  @ApiOperation({ summary: "Delete an internal note" })
  @ApiOkResponse({ standardSchema: notesSchema })
  deleteNote(
    @Param("id", { schema: idSchema }) id: string,
    @Param("noteId", { schema: idSchema }) noteId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffNote[]> {
    return this.customers.deleteNote(auth, id, noteId, requestMeta(request));
  }

  @Post("customers/:id/reset-link")
  @Permission("signout")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Email the account a password reset link" })
  async resetLink(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.sendResetLink(auth, id, requestMeta(request));
  }

  @Post("customers/:id/sign-out")
  @Permission("signout")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Sign the account out everywhere and end its cloud browsers" })
  async signOut(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.signOutEverywhere(auth, id, body.reason, requestMeta(request));
  }

  @Delete("customers/:id/devices/:sessionId")
  @Permission("signout")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Sign one device out" })
  async signOutDevice(
    @Param("id", { schema: idSchema }) id: string,
    @Param("sessionId", { schema: idSchema }) sessionId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.signOutDevice(auth, id, sessionId, requestMeta(request));
  }

  @Post("customers/:id/passkeys/:passkeyId/remove")
  @Permission("twofaReset")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a passkey the customer has lost" })
  async removePasskey(
    @Param("id", { schema: idSchema }) id: string,
    @Param("passkeyId", { schema: idSchema }) passkeyId: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.removePasskey(auth, id, passkeyId, body.reason, requestMeta(request));
  }

  @Post("customers/:id/two-factor/disable")
  @Permission("twofaReset")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Turn the authenticator app off for a customer who lost it" })
  async disableTwoFactor(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.disableTwoFactor(auth, id, body.reason, requestMeta(request));
  }

  @Post("customers/:id/suspend")
  @Permission("suspend")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Suspend the account: sign-in refused, sessions ended, data kept" })
  async suspend(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.suspend(auth, id, body.reason, requestMeta(request));
  }

  @Post("customers/:id/lift-suspension")
  @Permission("suspend")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Lift a suspension" })
  async liftSuspension(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.liftSuspension(auth, id, body.reason, requestMeta(request));
  }

  @Put("customers/:id/plan")
  @Permission("planChange")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set the plan by hand, with a reason" })
  async setPlan(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: adminSetPlanRequestSchema }) body: z.output<typeof adminSetPlanRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.setPlan(auth, id, body.planCode, body.reason, requestMeta(request));
  }

  @Post("customers/:id/trash/:fileId/restore")
  @Permission("driveRestore")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: driveFileSchema })
  @ApiOperation({ summary: "Put a file back from the account's Trash" })
  @ApiOkResponse({ standardSchema: driveFileSchema })
  restore(
    @Param("id", { schema: idSchema }) id: string,
    @Param("fileId", { schema: idSchema }) fileId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<DriveFile> {
    return this.customers.restoreFromTrash(auth, id, fileId, requestMeta(request));
  }

  @Post("customers/:id/sessions/:sessionId/end")
  @Permission("sessionEnd")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "End one of the account's cloud browser sessions" })
  async endSession(
    @Param("id", { schema: idSchema }) id: string,
    @Param("sessionId", { schema: idSchema }) sessionId: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.endBrowserSession(auth, id, sessionId, body.reason, requestMeta(request));
  }

  @Post("customers/:id/delete")
  @Permission("deleteData")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete the account and everything it holds" })
  async deleteAccount(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonRequestSchema }) body: z.output<typeof reasonRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.customers.deleteAccount(auth, id, body.reason, requestMeta(request));
  }
}
