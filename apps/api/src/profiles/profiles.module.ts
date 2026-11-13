import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { StorageModule } from "../storage/storage.module.js";
import { EgressModule } from "../egress/egress.module.js";
import { HistoryModule } from "../history/history.module.js";
import { ProfileDataService } from "./profile-data.service.js";
import { ProfilesController } from "./profiles.controller.js";
import { ProfilesService } from "./profiles.service.js";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    CryptoModule,
    StorageModule,
    SecurityEventsModule,
    BillingModule,
    HistoryModule,
    EgressModule,
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService, ProfileDataService],
  exports: [ProfilesService, ProfileDataService],
})
export class ProfilesModule {}
