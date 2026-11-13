import Stripe from "stripe";
import type { BillingConfig } from "../config/env.js";

export const STRIPE = Symbol.for("brawzer.api.stripe");

/** Stripe's client, or null when the installation has no key (billing unavailable). */
export function createStripe(config: BillingConfig): Stripe | null {
  if (!config.stripeSecretKey) return null;
  const base = config.stripeApiBase ? new URL(config.stripeApiBase) : null;
  return new Stripe(config.stripeSecretKey, {
    typescript: true,
    maxNetworkRetries: 1,
    timeout: 15_000,
    ...(base
      ? {
          host: base.hostname,
          port: Number(base.port) || (base.protocol === "https:" ? 443 : 80),
          protocol: base.protocol === "https:" ? "https" : "http",
        }
      : {}),
  });
}

export type { Stripe };
