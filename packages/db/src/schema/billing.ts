import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { id, timestamptz } from "./columns.ts";

/**
 * The account's Stripe subscription, mirrored from webhooks (ADR 0015). One
 * row per account; the plan it grants is copied onto the user row, where
 * every limit check reads it.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text().notNull(),
    stripeSubscriptionId: text(),
    /** Stripe's status, as text: the vocabulary is theirs. */
    status: text().notNull(),
    planCode: text().notNull(),
    currentPeriodEnd: timestamptz(),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_user_unique").on(table.userId),
    uniqueIndex("subscriptions_customer_unique").on(table.stripeCustomerId),
    index("subscriptions_subscription_idx").on(table.stripeSubscriptionId),
  ],
);

/** Every Stripe event handled, so a redelivered one is applied only once. */
export const billingEvents = pgTable("billing_events", {
  stripeEventId: text().primaryKey(),
  type: text().notNull(),
  receivedAt: timestamptz().notNull().defaultNow(),
});

export type SubscriptionRow = typeof subscriptions.$inferSelect;
