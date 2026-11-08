import { type DatabaseExecutor, sql } from "@brawzer/db";

/**
 * Gives a newly confirmed account its first profile, "Personal". Does nothing
 * if the account already has a profile, so it is safe to call from every
 * path that confirms an account.
 */
export async function createDefaultProfile(
  executor: DatabaseExecutor,
  userId: string,
): Promise<void> {
  await executor.execute(sql`
    insert into profiles (user_id, name, color, engine, position)
    select ${userId}, 'Personal', 'indigo', 'bee', 0
    where not exists (select 1 from profiles where user_id = ${userId})
  `);
}
