import { type DatabaseExecutor, eq, schema } from "@brawzer/db";

/**
 * Locks the account's row until the transaction ends. Changes that depend on
 * how many of something an account has (limits, "keep at least one") take
 * this first, so two requests at once can't both pass the check.
 */
export async function lockAccount(tx: DatabaseExecutor, userId: string): Promise<void> {
  await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .for("update");
}
