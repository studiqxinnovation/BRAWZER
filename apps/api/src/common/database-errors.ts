/** The Postgres error code of a failed query, wherever the driver nested the error. */
function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if (
      "code" in current &&
      typeof current.code === "string" &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      return current.code;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** A unique constraint was violated (23505). */
export function isUniqueViolation(error: unknown): boolean {
  return postgresCode(error) === "23505";
}

/** A foreign key pointed at a row that doesn't exist (23503). */
export function isForeignKeyViolation(error: unknown): boolean {
  return postgresCode(error) === "23503";
}
