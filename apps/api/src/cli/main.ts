import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { type AppConfig, ConfigError, loadConfig } from "../config/env.js";
import { runCommand, USAGE } from "./commands.js";

// A command-line tool writes its answers to stdout; that is its interface.
const print = (line: string) => process.stdout.write(`${line}\n`);

// An operator's process starts no warm pairs and reconciles no containers.
process.env.BROWSER_WARM_POOL = "0";
process.env.BRAWZER_ROLE = "cli";

// Some runners pass a literal "--" before the arguments.
const given = process.argv.slice(2);
const argv = given[0] === "--" ? given.slice(1) : given;
if (argv.length === 0 || ["help", "--help", "-h"].includes(argv[0] ?? "")) {
  print(USAGE);
  process.exit(argv.length === 0 ? 2 : 0);
}

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : String(error));
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule.register(config), {
  logger: ["error", "warn"],
});
let code = 1;
try {
  code = await runCommand(app, argv, print);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await app.close();
}
process.exit(code);
