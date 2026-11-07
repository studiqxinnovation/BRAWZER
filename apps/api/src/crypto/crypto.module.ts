import { Global, Module } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { type KeyProvider, LocalKeyProvider, VaultTransitKeyProvider } from "./key-providers.js";
import { SecretBox } from "./secret-box.js";

export const SECRET_BOX = Symbol.for("brawzer.api.secret-box");

export function createKeyProvider(config: AppConfig["encryption"]): KeyProvider {
  return config.provider === "local"
    ? new LocalKeyProvider(config.keys)
    : new VaultTransitKeyProvider(config.vault);
}

/** Encryption for secrets at rest, available everywhere. */
@Global()
@Module({
  providers: [
    {
      provide: SECRET_BOX,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretBox(createKeyProvider(config.encryption)),
    },
  ],
  exports: [SECRET_BOX],
})
export class CryptoModule {}
