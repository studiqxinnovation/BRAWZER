import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { ConfigError, loadConfig } from "./config/env.js";

function readConfig() {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`${error.message}\n\nCopy .env.example to .env for local development.`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const app = await createApp(config);
await app.listen(config.apiPort, config.apiHost);

const logger = new Logger("Bootstrap");
const origin = `http://${config.apiHost}:${String(config.apiPort)}`;
logger.log(`Brawzer API ${config.version} listening on ${origin}/api/v1`);
if (config.apiDocsEnabled) logger.log(`API docs: ${origin}/api/docs`);
