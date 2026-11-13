import {
  createProxyRequestSchema,
  MAX_PROXIES,
  type ProxyList,
  proxyListSchema,
  proxySchema,
  type ProxyTestResult,
  proxyTestResultSchema,
  type SavedProxy,
  updateProxyRequestSchema,
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
  Patch,
  Post,
  Req,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { ProxiesService } from "./proxies.service.js";

const proxyIdSchema = z.uuid({ error: "That isn’t a proxy ID." });

@ApiTags("Proxies")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "proxies", version: "1" })
export class ProxiesController {
  constructor(@Inject(ProxiesService) private readonly proxies: ProxiesService) {}

  @Get()
  @SerializeOptions({ schema: proxyListSchema })
  @ApiOperation({
    summary: "This account's proxies, and its team's",
    description:
      "Credentials are never returned, only whether some are saved. A team's proxies are listed to every member; its owner and admins change them.",
  })
  @ApiOkResponse({
    description: "Proxies and the account's limit.",
    standardSchema: proxyListSchema,
  })
  async list(@CurrentAuth() auth: AuthContext): Promise<ProxyList> {
    return this.proxies.listFor(auth.user.id, MAX_PROXIES);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: proxySchema })
  @ApiOperation({
    summary: "Add a proxy",
    description: "Private, local and reserved addresses are refused. Credentials are encrypted.",
  })
  @ApiCreatedResponse({ description: "The saved proxy.", standardSchema: proxySchema })
  @ApiConflictResponse({ description: "The name is taken, or the account has reached its limit." })
  create(
    @Body({ schema: createProxyRequestSchema }) body: z.output<typeof createProxyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<SavedProxy> {
    return this.proxies.create(auth, body, requestMeta(request));
  }

  @Patch(":id")
  @SerializeOptions({ schema: proxySchema })
  @ApiOperation({
    summary: "Change a proxy",
    description:
      "Omit `credentials` to keep the saved ones, send null to remove them, or send new ones.",
  })
  @ApiOkResponse({ description: "The updated proxy.", standardSchema: proxySchema })
  @ApiNotFoundResponse({ description: "No such proxy on this account." })
  update(
    @Param("id", { schema: proxyIdSchema }) id: string,
    @Body({ schema: updateProxyRequestSchema }) body: z.output<typeof updateProxyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<SavedProxy> {
    return this.proxies.update(auth, id, body, requestMeta(request));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Delete a proxy",
    description: "Profiles that used it go back to no proxy.",
  })
  @ApiNoContentResponse({ description: "Deleted." })
  async remove(
    @Param("id", { schema: proxyIdSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.proxies.remove(auth, id, requestMeta(request));
  }

  @Post(":id/test")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: proxyTestResultSchema })
  @ApiOperation({
    summary: "Test a proxy",
    description:
      "Connects through the proxy to a fixed test address and reports whether it worked, how long it took and the address websites would see.",
  })
  @ApiOkResponse({
    description: "The test result (also when the proxy failed).",
    standardSchema: proxyTestResultSchema,
  })
  @ApiTooManyRequestsResponse({ description: "Too many tests, or one is still running." })
  test(
    @Param("id", { schema: proxyIdSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ProxyTestResult> {
    return this.proxies.test(auth, id);
  }
}
