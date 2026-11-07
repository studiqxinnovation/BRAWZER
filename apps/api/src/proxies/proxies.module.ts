import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DatabaseModule } from "../database/database.module.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { NetworkController } from "./network.controller.js";
import { PROXY_TESTER, ProxiesService } from "./proxies.service.js";
import { ProxiesController } from "./proxies.controller.js";
import { ProxyTester } from "./proxy-tester.js";

@Module({
  imports: [AuthModule, DatabaseModule, RateLimitModule, SecurityEventsModule],
  controllers: [ProxiesController, NetworkController],
  providers: [
    ProxiesService,
    {
      provide: PROXY_TESTER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new ProxyTester({
          echoUrl: new URL(config.proxyTests.url),
          allowPrivate: config.proxyTests.allowPrivate,
        }),
    },
  ],
  exports: [ProxiesService],
})
export class ProxiesModule {}
