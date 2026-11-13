import { webAppById, webApps } from "@brawzer/contracts";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { type Fetch, fetchSiteIcon, type SiteIcon } from "./site-icon.js";

const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
/** Sites asked at once while warming: polite to them, quick for the first person to ask. */
const WARM_AT_ONCE = 4;

interface Cached {
  icon: SiteIcon | null;
  until: number;
}

/**
 * The web apps' icons, fetched once from each site by the API and kept in
 * memory for a day, so the person's device asks the site for nothing and the
 * site sees one request from Brawzer, not one per person. The cache warms in
 * the background when the API starts, so the App Store opens with them.
 */
@Injectable()
export class WebAppsService implements OnModuleInit {
  private readonly cache = new Map<string, Cached>();
  private readonly inflight = new Map<string, Promise<SiteIcon | null>>();
  /** The fetch used: the platform's, unless a test hands in its own. */
  fetchImpl: Fetch = fetch;

  onModuleInit(): void {
    // Tests boot the API many times and must not reach the internet.
    if (process.env.NODE_ENV === "test") return;
    void this.warm();
  }

  /** Fetches every listed app's icon, a few at a time; failures are just misses. */
  async warm(): Promise<void> {
    const ids = webApps.map((app) => app.id);
    const next = async () => {
      for (let id = ids.shift(); id; id = ids.shift()) await this.icon(id);
    };
    await Promise.all(Array.from({ length: WARM_AT_ONCE }, next));
  }

  /** The icon of one of the listed web apps; null when the site offers none. */
  icon(id: string): Promise<SiteIcon | null> | null {
    const app = webAppById(id);
    if (!app) return null;
    const cached = this.cache.get(id);
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.icon);
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const work = fetchSiteIcon(new URL(app.url), this.fetchImpl)
      .catch(() => null)
      .then((icon) => {
        this.cache.set(id, { icon, until: Date.now() + (icon ? HIT_TTL_MS : MISS_TTL_MS) });
        this.inflight.delete(id);
        return icon;
      });
    this.inflight.set(id, work);
    return work;
  }
}
