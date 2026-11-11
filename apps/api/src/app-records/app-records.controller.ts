import {
  type AppRecord,
  type AppRecordApp,
  type AppRecordList,
  appRecordAppSchema,
  appRecordKeySchema,
  appRecordListSchema,
  appRecordSchema,
  putAppRecordRequestSchema,
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
  Put,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { ApiException } from "../common/api-exception.js";
import { AppRecordsService } from "./app-records.service.js";

@ApiTags("App records")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "apps", version: "1" })
export class AppRecordsController {
  constructor(@Inject(AppRecordsService) private readonly records: AppRecordsService) {}

  @Get(":app/records")
  @SerializeOptions({ schema: appRecordListSchema })
  @ApiOperation({
    summary: "An app's records",
    description: "What one of the desktop's apps keeps for this account, opened.",
  })
  @ApiOkResponse({ description: "The records.", standardSchema: appRecordListSchema })
  async list(
    @Param("app", { schema: appRecordAppSchema }) app: AppRecordApp,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AppRecordList> {
    return { records: await this.records.list(auth.user.id, app) };
  }

  @Put(":app/records/:key")
  @SerializeOptions({ schema: appRecordSchema })
  @ApiOperation({
    summary: "Keep a record",
    description: "Creates or replaces the record, sealed with its own key. Up to 256 KB of JSON.",
  })
  @ApiOkResponse({ description: "Kept.", standardSchema: appRecordSchema })
  put(
    @Param("app", { schema: appRecordAppSchema }) app: AppRecordApp,
    @Param("key", { schema: appRecordKeySchema }) key: string,
    @Body({ schema: putAppRecordRequestSchema }) body: z.output<typeof putAppRecordRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AppRecord> {
    return this.records.put(auth.user.id, app, key, body.data);
  }

  @Delete(":app/records/:key")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a record" })
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiNotFoundResponse({ description: "There's no such record." })
  async remove(
    @Param("app", { schema: appRecordAppSchema }) app: AppRecordApp,
    @Param("key", { schema: appRecordKeySchema }) key: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    if (!(await this.records.remove(auth.user.id, app, key))) {
      throw new ApiException("not_found", 404, "That record doesn’t exist.");
    }
  }
}
