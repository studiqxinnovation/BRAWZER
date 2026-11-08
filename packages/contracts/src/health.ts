import { z } from "zod";

/** Reachability of one backing service, measured by the API. */
export const dependencyCheckSchema = z.object({
  status: z.enum(["up", "down"]),
  /** Round-trip time of the probe in milliseconds; null when the probe failed. */
  latencyMs: z.number().nonnegative().nullable(),
});

export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

/**
 * Response of `GET /api/v1/health`.
 *
 * `checks` is only included outside production, so that a public health
 * endpoint never describes the platform's internal topology.
 */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("brawzer-api"),
  version: z.string().min(1),
  environment: z.enum(["development", "test", "production"]),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
  checks: z
    .object({
      database: dependencyCheckSchema,
      redis: dependencyCheckSchema,
      /** Drive's object store. */
      storage: dependencyCheckSchema,
      /** The malware scanner that every Drive upload goes through. */
      scanner: dependencyCheckSchema,
      /** The container engine that runs cloud browsers, with the runtime image present. */
      runtime: dependencyCheckSchema,
    })
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
