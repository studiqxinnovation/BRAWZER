import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/** Time-ordered UUIDs (PostgreSQL 18's built-in uuidv7) keep indexes compact. */
export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

export const timestamptz = () => timestamp({ withTimezone: true });
