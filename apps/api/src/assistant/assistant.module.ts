import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { AssistantController } from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";

@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
