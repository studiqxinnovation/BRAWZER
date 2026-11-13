import { BlockList, isIP } from "node:net";
import { and, type DatabaseHandle, eq, gt, isNull, or, schema } from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DATABASE } from "../database/database.module.js";

type BlockedRow = typeof schema.blockedAddresses.$inferSelect;

const REFRESH_MS = 30_000;
const logger = new Logger("BlockedAddresses");

/** Splits "203.0.113.0/24" into its parts; an address alone is a single host. */
export function parseCidr(
  value: string,
): { address: string; prefix: number; family: 4 | 6 } | null {
  const [address, prefixText] = value.trim().split("/");
  if (!address) return null;
  const family = isIP(address);
  if (family !== 4 && family !== 6) return null;
  const max = family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? max : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { address, prefix, family };
}

/**
 * Addresses and networks refused at sign-in and registration (Phase 11.5).
 * The list is read from the database and kept for 30 seconds, so a block
 * takes effect everywhere within that time without a cache to invalidate.
 */
@Injectable()
export class BlockedAddressesService {
  private list = new BlockList();
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async isBlocked(ip: string | null | undefined): Promise<boolean> {
    if (!ip) return false;
    const family = isIP(ip);
    if (family !== 4 && family !== 6) return false;
    await this.refresh();
    try {
      return this.list.check(ip, family === 4 ? "ipv4" : "ipv6");
    } catch {
      return false;
    }
  }

  /** Every block in force or expired, newest first. */
  async all(): Promise<BlockedRow[]> {
    return this.database.db
      .select()
      .from(schema.blockedAddresses)
      .orderBy(schema.blockedAddresses.createdAt);
  }

  async add(input: {
    cidr: string;
    reason: string;
    createdById: string;
    expiresAt: Date | null;
  }): Promise<BlockedRow> {
    const parsed = parseCidr(input.cidr);
    if (!parsed) throw new Error("not an address");
    const [row] = await this.database.db
      .insert(schema.blockedAddresses)
      .values({
        cidr:
          parsed.prefix === (parsed.family === 4 ? 32 : 128)
            ? parsed.address
            : `${parsed.address}/${String(parsed.prefix)}`,
        reason: input.reason,
        createdById: input.createdById,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error("The block was not created");
    this.loadedAt = 0;
    return row;
  }

  async remove(id: string): Promise<BlockedRow | null> {
    const [row] = await this.database.db
      .delete(schema.blockedAddresses)
      .where(eq(schema.blockedAddresses.id, id))
      .returning();
    this.loadedAt = 0;
    return row ?? null;
  }

  private async refresh(): Promise<void> {
    if (Date.now() - this.loadedAt < REFRESH_MS) return;
    this.loading ??= (async () => {
      try {
        const rows = await this.database.db
          .select({ cidr: schema.blockedAddresses.cidr })
          .from(schema.blockedAddresses)
          .where(
            and(
              or(
                isNull(schema.blockedAddresses.expiresAt),
                gt(schema.blockedAddresses.expiresAt, new Date()),
              ),
            ),
          );
        const next = new BlockList();
        for (const row of rows) {
          const parsed = parseCidr(row.cidr);
          if (!parsed) continue;
          const type = parsed.family === 4 ? "ipv4" : "ipv6";
          if (parsed.prefix === (parsed.family === 4 ? 32 : 128))
            next.addAddress(parsed.address, type);
          else next.addSubnet(parsed.address, parsed.prefix, type);
        }
        this.list = next;
        this.loadedAt = Date.now();
      } catch (error) {
        logger.warn(
          `Could not read blocked addresses: ${error instanceof Error ? error.message : "unknown"}`,
        );
      } finally {
        this.loading = null;
      }
    })();
    await this.loading;
  }
}
