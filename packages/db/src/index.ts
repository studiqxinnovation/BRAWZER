export {
  createDatabase,
  type Database,
  type DatabaseExecutor,
  type DatabaseHandle,
  type DatabaseOptions,
  type DatabaseTransaction,
} from "./client.ts";
export { hasMigrations, migrationsFolder } from "./migrations-state.ts";
export { runMigrations } from "./migrator.ts";
export * as schema from "./schema/index.ts";
export type {
  AuthChallenge,
  AuthChallengePurpose,
  AuthSession,
  DriveFileRow,
  DriveFolderRow,
  EmailToken,
  EmailTokenPurpose,
  ProfileRow,
  ProxyRow,
  SecurityEventType,
  StoredProxyTest,
  TotpFactor,
  User,
  WebauthnCredential,
} from "./schema/index.ts";
// Query operators, re-exported so every service builds queries with the same
// drizzle-orm instance as the schema (two copies would not type-check together).
export {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
