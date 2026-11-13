import {
  type ComponentState,
  type DeclareIncidentRequest,
  type Incident,
  type IncidentUpdateRequest,
  type PublicStatus,
  type StatusComponent,
  statusComponentNames,
  statusComponents,
} from "@brawzer/contracts";
import { and, type DatabaseHandle, desc, eq, gte, inArray, or, schema } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { ApiException } from "../common/api-exception.js";
import { DATABASE } from "../database/database.module.js";
import { HealthService } from "../health/health.service.js";
import { AnnouncementsService } from "./announcements.service.js";

type IncidentRow = typeof schema.incidents.$inferSelect;
type UpdateRow = typeof schema.incidentUpdates.$inferSelect;

const DAY = 86_400_000;
const notFound = () => new ApiException("not_found", 404, "That incident doesn’t exist.");

const isComponent = (value: string): value is StatusComponent =>
  (statusComponents as readonly string[]).includes(value);

/**
 * Incidents and the status page (Phase 11.2). The team declares what is
 * wrong and posts updates; a public incident shows on /status and as a
 * banner inside Brawzer until it is resolved. Component states come from the
 * same health checks the API runs on itself.
 */
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(HealthService) private readonly health: HealthService,
    @Inject(AnnouncementsService) private readonly announcements: AnnouncementsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(): Promise<Incident[]> {
    const rows = await this.database.db
      .select({ incident: schema.incidents, owner: schema.users.email })
      .from(schema.incidents)
      .leftJoin(schema.users, eq(schema.users.id, schema.incidents.ownerId))
      .orderBy(desc(schema.incidents.startedAt))
      .limit(100);
    return this.withUpdates(rows);
  }

  async declare(
    actor: { id: string; email: string },
    body: DeclareIncidentRequest,
  ): Promise<Incident> {
    const id = await this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.incidents)
        .values({
          title: body.title,
          severity: body.severity,
          isPublic: body.isPublic,
          components: body.components,
          ownerId: actor.id,
        })
        .returning({ id: schema.incidents.id });
      if (!created) throw new Error("The incident was not created");
      await tx.insert(schema.incidentUpdates).values({
        incidentId: created.id,
        status: "investigating",
        body: body.body,
        authorId: actor.id,
      });
      return created.id;
    });
    if (body.isPublic) {
      await this.announcements.create(
        actor.id,
        {
          title: body.title,
          body: `${body.body} Updates on the status page.`,
          kind: "incident",
          audience: "everyone",
          link: "/status",
        },
        id,
      );
    }
    return this.one(id);
  }

  async postUpdate(
    actor: { id: string },
    id: string,
    body: IncidentUpdateRequest,
  ): Promise<Incident> {
    const [row] = await this.database.db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, id))
      .limit(1);
    if (!row) throw notFound();
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx.insert(schema.incidentUpdates).values({
        incidentId: id,
        status: body.status,
        body: body.body,
        authorId: actor.id,
      });
      await tx
        .update(schema.incidents)
        .set({
          status: body.status,
          updatedAt: now,
          resolvedAt: body.status === "resolved" ? now : null,
        })
        .where(eq(schema.incidents.id, id));
    });
    if (body.status === "resolved") await this.announcements.turnOffForIncident(id);
    return this.one(id);
  }

  async one(id: string): Promise<Incident> {
    const rows = await this.database.db
      .select({ incident: schema.incidents, owner: schema.users.email })
      .from(schema.incidents)
      .leftJoin(schema.users, eq(schema.users.id, schema.incidents.ownerId))
      .where(eq(schema.incidents.id, id))
      .limit(1);
    const [incident] = await this.withUpdates(rows);
    if (!incident) throw notFound();
    return incident;
  }

  /** The public status page: nothing personal, nothing internal. */
  async publicStatus(): Promise<PublicStatus> {
    const weekAgo = new Date(Date.now() - 7 * DAY);
    const [checks, rows, maintenance] = await Promise.all([
      this.health.probeAll(),
      this.database.db
        .select({ incident: schema.incidents, owner: schema.users.email })
        .from(schema.incidents)
        .leftJoin(schema.users, eq(schema.users.id, schema.incidents.ownerId))
        .where(
          and(
            eq(schema.incidents.isPublic, true),
            or(
              inArray(schema.incidents.status, ["investigating", "identified", "monitoring"]),
              gte(schema.incidents.resolvedAt, weekAgo),
            ),
          ),
        )
        .orderBy(desc(schema.incidents.startedAt))
        .limit(20),
      this.announcements.maintenance(),
    ]);
    const incidents = await this.withUpdates(rows);
    const open = incidents.filter((incident) => incident.status !== "resolved");
    const up = (...keys: (keyof typeof checks)[]) =>
      keys.every((key) => checks[key].status === "up");
    // In production only a real sender counts; in development the local inbox is the sender.
    const emailOn = this.config.email.transport === "resend" || !this.config.isProduction;
    const measured: Record<StatusComponent, ComponentState> = {
      cloud_browsers: up("runtime", "redis") ? "operational" : "degraded",
      sign_in: up("database", "redis") ? "operational" : "down",
      drive: up("storage", "database") ? (up("scanner") ? "operational" : "degraded") : "down",
      email: emailOn ? "operational" : "degraded",
      billing: up("database") ? "operational" : "degraded",
    };
    const components = statusComponents.map((key) => {
      const hit = open.some((incident) => incident.components.includes(key));
      return {
        key,
        name: statusComponentNames[key],
        state: hit && measured[key] === "operational" ? ("incident" as const) : measured[key],
      };
    });
    const rank: Record<ComponentState, number> = {
      operational: 0,
      incident: 1,
      degraded: 2,
      down: 3,
    };
    const overall = components.reduce<ComponentState>(
      (worst, component) => (rank[component.state] > rank[worst] ? component.state : worst),
      open.length ? "incident" : "operational",
    );
    return {
      overall,
      components,
      // Nothing personal leaves: no owner, no update authors.
      incidents: incidents.map(({ isPublic: _public, owner: _owner, ...rest }) => ({
        ...rest,
        updates: rest.updates.map((update) => ({ ...update, author: null })),
      })),
      maintenance: maintenance.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  private async withUpdates(
    rows: { incident: IncidentRow; owner: string | null }[],
  ): Promise<Incident[]> {
    if (rows.length === 0) return [];
    const updates = await this.database.db
      .select({ update: schema.incidentUpdates, author: schema.users.email })
      .from(schema.incidentUpdates)
      .leftJoin(schema.users, eq(schema.users.id, schema.incidentUpdates.authorId))
      .where(
        inArray(
          schema.incidentUpdates.incidentId,
          rows.map((row) => row.incident.id),
        ),
      )
      .orderBy(schema.incidentUpdates.createdAt);
    const byIncident = new Map<string, { update: UpdateRow; author: string | null }[]>();
    for (const entry of updates) {
      const list = byIncident.get(entry.update.incidentId) ?? [];
      list.push(entry);
      byIncident.set(entry.update.incidentId, list);
    }
    return rows.map(({ incident, owner }) => ({
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      isPublic: incident.isPublic,
      components: incident.components.filter(isComponent),
      owner,
      startedAt: incident.startedAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      updates: (byIncident.get(incident.id) ?? []).map(({ update, author }) => ({
        id: update.id,
        status: update.status,
        body: update.body,
        author,
        at: update.createdAt.toISOString(),
      })),
    }));
  }
}
