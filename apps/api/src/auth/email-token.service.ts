import {
  and,
  type DatabaseExecutor,
  type DatabaseHandle,
  desc,
  type EmailToken,
  type EmailTokenPurpose,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  schema,
  type User,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { DATABASE } from "../database/database.module.js";
import { EMAIL_LINK_LIFETIME_SECONDS } from "./session-policy.js";
import { generateToken, hashToken, isWellFormedToken } from "./tokens.js";

/** Single-use links sent by email. Only token hashes are stored. */
@Injectable()
export class EmailTokenService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  /** Creates a link token; returns the raw token for the email, which is the only place it exists. */
  async issue(
    userId: string,
    purpose: EmailTokenPurpose,
    options: { pendingPasswordHash?: string } = {},
    executor: DatabaseExecutor = this.database.db,
  ): Promise<string> {
    const token = generateToken();
    await executor.insert(schema.emailTokens).values({
      userId,
      purpose,
      tokenHash: hashToken(token),
      pendingPasswordHash: options.pendingPasswordHash ?? null,
      expiresAt: new Date(Date.now() + EMAIL_LINK_LIFETIME_SECONDS[purpose] * 1000),
    });
    return token;
  }

  /** Looks up an unused, unexpired token and its account, without using it up. */
  async find(
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<{ token: EmailToken; user: User } | null> {
    if (!isWellFormedToken(token)) return null;
    const [row] = await this.database.db
      .select({ token: schema.emailTokens, user: schema.users })
      .from(schema.emailTokens)
      .innerJoin(schema.users, eq(schema.users.id, schema.emailTokens.userId))
      .where(
        and(
          eq(schema.emailTokens.tokenHash, hashToken(token)),
          eq(schema.emailTokens.purpose, purpose),
          isNull(schema.emailTokens.usedAt),
          gt(schema.emailTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Marks a token used. False when a concurrent request used it first. */
  async consume(tokenId: string, executor: DatabaseExecutor = this.database.db): Promise<boolean> {
    const used = await executor
      .update(schema.emailTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.emailTokens.id, tokenId), isNull(schema.emailTokens.usedAt)))
      .returning({ id: schema.emailTokens.id });
    return used.length === 1;
  }

  /** Makes every outstanding link of the given kinds unusable. */
  async invalidateAll(
    userId: string,
    purposes: readonly EmailTokenPurpose[],
    executor: DatabaseExecutor = this.database.db,
  ): Promise<void> {
    await executor
      .update(schema.emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.emailTokens.userId, userId),
          inArray(schema.emailTokens.purpose, [...purposes]),
          isNull(schema.emailTokens.usedAt),
        ),
      );
  }

  /** The newest outstanding sign-up for an unconfirmed account, with the password chosen for it. */
  async latestPendingSignUp(userId: string): Promise<EmailToken | null> {
    const [row] = await this.database.db
      .select()
      .from(schema.emailTokens)
      .where(
        and(
          eq(schema.emailTokens.userId, userId),
          eq(schema.emailTokens.purpose, "verify_email"),
          isNull(schema.emailTokens.usedAt),
          isNotNull(schema.emailTokens.pendingPasswordHash),
          gt(schema.emailTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.emailTokens.createdAt))
      .limit(1);
    return row ?? null;
  }
}
