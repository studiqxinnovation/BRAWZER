import { z } from "zod";

/**
 * The admin console (Phase 11): who works at the company running Brawzer,
 * what each role may do, and which pages each role sees. One table, read
 * by the API's guard and by the console's pages, so a button a role can't
 * use is disabled and the API refuses it anyway.
 */

/** Staff roles. `admin` is the founder: everything, final approvals. */
export const staffRoles = ["admin", "care", "billing", "sales", "technical", "security"] as const;
export type StaffRole = (typeof staffRoles)[number];
export const staffRoleSchema = z.enum(staffRoles);

/** Every account role: a customer, or a member of staff. Must match the database enum. */
export const accountRoles = ["user", ...staffRoles] as const;
export type AccountRole = (typeof accountRoles)[number];
export const accountRoleSchema = z.enum(accountRoles);

export const isStaffRole = (role: string): role is StaffRole =>
  (staffRoles as readonly string[]).includes(role);

export const staffRoleNames: Readonly<Record<StaffRole, string>> = {
  admin: "Founder",
  care: "Customer Care",
  billing: "Billing",
  sales: "Sales",
  technical: "Technical",
  security: "Security & Compliance",
};

export const staffRoleDescriptions: Readonly<Record<StaffRole, string>> = {
  admin: "Everything, final approvals",
  care: "Support, recovery, customer fixes",
  billing: "Subscriptions, payments, refunds",
  sales: "Pipeline, organisations, renewals",
  technical: "Fleet, browsers, releases, incidents",
  security: "Threats, abuse, privacy, audit",
};

/** What staff may do, by role. The prototype's permission table, as it stands. */
export const staffPermissions = {
  reveal: ["admin", "care", "billing", "security"],
  refund: ["admin", "care", "billing"],
  credit: ["admin", "care", "billing"],
  planChange: ["admin", "care", "billing"],
  cancelSub: ["admin", "care", "billing"],
  sessionEnd: ["admin", "care", "technical", "security"],
  suspend: ["admin", "security"],
  lock: ["admin", "care", "security"],
  signout: ["admin", "care", "security"],
  driveRestore: ["admin", "care"],
  driveQuota: ["admin", "care", "billing"],
  browserReset: ["admin", "care", "technical"],
  extRemove: ["admin", "care", "technical", "security"],
  regionChange: ["admin", "care", "technical"],
  impersonate: ["admin", "care"],
  twofaReset: ["admin", "care", "security"],
  emailChange: ["admin", "care"],
  recoveryApprove: ["admin", "security"],
  /** Account recovery cases: start one, record checks, deny. Releasing needs recoveryApprove. */
  recovery: ["admin", "care", "security"],
  orgPolicy: ["admin", "sales"],
  seats: ["admin", "sales", "billing"],
  sso: ["admin", "sales", "technical"],
  dealEdit: ["admin", "sales"],
  scale: ["admin", "technical"],
  release: ["admin", "technical"],
  flags: ["admin", "technical"],
  image: ["admin", "technical"],
  extModerate: ["admin", "technical", "security"],
  blockIp: ["admin", "security"],
  abuse: ["admin", "security"],
  dsar: ["admin", "security"],
  legal: ["admin", "security"],
  priceEdit: ["admin"],
  /** Support requests: answer, assign, set priority and status. */
  tickets: ["admin", "care"],
  /** Saved replies the team shares. */
  replies: ["admin", "care"],
  staff: ["admin"],
  announce: ["admin", "care", "technical"],
  coupon: ["admin", "billing"],
  incident: ["admin", "technical"],
  deleteData: ["admin", "security"],
  notes: ["admin", "care", "billing", "sales", "technical", "security"],
} as const satisfies Readonly<Record<string, readonly StaffRole[]>>;

export type StaffPermission = keyof typeof staffPermissions;

/** Whether this role may do this. A customer may do nothing here. */
export function can(role: string, permission: StaffPermission): boolean {
  return (staffPermissions[permission] as readonly string[]).includes(role);
}

/** The console's pages, grouped as the prototype's sidebar has them, and who sees each. */
export interface AdminPage {
  key: string;
  title: string;
  group: string;
  roles: readonly StaffRole[];
  /** Where it lives under /admin. */
  path: string;
}

const CUSTOMER_FACING: readonly StaffRole[] = ["admin", "care", "billing", "sales", "security"];

export const adminPages: readonly AdminPage[] = [
  { key: "overview", title: "Company overview", group: "Company", roles: ["admin"], path: "" },
  {
    key: "growth",
    title: "Growth & retention",
    group: "Company",
    roles: ["admin", "sales"],
    path: "growth",
  },
  {
    key: "team",
    title: "Team & access",
    group: "Company",
    roles: ["admin", "security"],
    path: "team",
  },
  {
    key: "settings",
    title: "Plans & settings",
    group: "Company",
    roles: ["admin", "billing"],
    path: "settings",
  },
  {
    key: "customers",
    title: "Customers",
    group: "Customers",
    roles: CUSTOMER_FACING,
    path: "customers",
  },
  { key: "orgs", title: "Organisations", group: "Customers", roles: CUSTOMER_FACING, path: "orgs" },
  {
    key: "inbox",
    title: "Support inbox",
    group: "Customer care",
    roles: ["admin", "care"],
    path: "inbox",
  },
  {
    key: "replies",
    title: "Saved replies",
    group: "Customer care",
    roles: ["admin", "care"],
    path: "replies",
  },
  {
    key: "carestats",
    title: "Support performance",
    group: "Customer care",
    roles: ["admin", "care"],
    path: "carestats",
  },
  {
    key: "recovery",
    title: "Account recovery",
    group: "Customer care",
    roles: ["admin", "care", "security"],
    path: "recovery",
  },
  {
    key: "announce",
    title: "In-app announcements",
    group: "Customer care",
    roles: ["admin", "care", "technical"],
    path: "announce",
  },
  {
    key: "incidents",
    title: "Incidents & status",
    group: "Technical",
    roles: ["admin", "technical", "care"],
    path: "incidents",
  },
  {
    key: "audit",
    title: "Audit log",
    group: "Compliance",
    roles: ["admin", "security"],
    path: "audit",
  },
];

export const adminPageByKey = (key: string): AdminPage | undefined =>
  adminPages.find((page) => page.key === key);

/** Whether this role sees this page. */
export function canSee(role: string, key: string): boolean {
  const page = adminPageByKey(key);
  return page !== undefined && (page.roles as readonly string[]).includes(role);
}

/** Where a role lands when it opens the console: its first page. */
export function homeOf(role: StaffRole): string {
  return adminPages.find((page) => (page.roles as readonly string[]).includes(role))?.path ?? "";
}

/* ── The audit log ── */

export const staffActionSchema = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  actorId: z.uuid().nullable(),
  actorEmail: z.string().nullable(),
  actorRole: z.string(),
  action: z.string(),
  target: z.string(),
  detail: z.string(),
  ipAddress: z.string().nullable(),
});
export type StaffAction = z.infer<typeof staffActionSchema>;

export const staffActionListSchema = z.object({
  actions: z.array(staffActionSchema),
  nextCursor: z.string().nullable(),
});
export type StaffActionList = z.infer<typeof staffActionListSchema>;

export const staffActionQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  role: staffRoleSchema.optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** The reason every risky action asks for, saved to the audit log. */
export const reasonSchema = z
  .string()
  .trim()
  .min(4, { error: "Please give a reason." })
  .max(500, { error: "Keep the reason under 500 characters." });

export const reasonRequestSchema = z.object({ reason: reasonSchema });
export type ReasonRequest = z.infer<typeof reasonRequestSchema>;

/* ── The team ── */

export const staffMemberSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: staffRoleSchema,
  /** A passkey or an authenticator app is on: what the console requires of staff in production. */
  secondFactor: z.enum(["passkey", "authenticator", "none"]),
  lastSignInAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffListSchema = z.object({
  staff: z.array(staffMemberSchema),
  /** Whether this installation turns staff without a second factor away. */
  secondFactorRequired: z.boolean(),
});
export type StaffList = z.infer<typeof staffListSchema>;

export const staffInviteRequestSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }).trim().toLowerCase(),
  role: staffRoleSchema.exclude(["admin"]),
});
export type StaffInviteRequest = z.infer<typeof staffInviteRequestSchema>;

export const staffRoleRequestSchema = z.object({
  role: staffRoleSchema.exclude(["admin"]),
});

/* ── Customers ── */

export const customerStatuses = [
  "active",
  "past_due",
  "locked",
  "suspended",
  "unverified",
] as const;
export type CustomerStatus = (typeof customerStatuses)[number];
export const customerStatusSchema = z.enum(customerStatuses);

export const customerIssueSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  detail: z.string(),
  /** A fix the console offers, when there is one. */
  fix: z.enum(["reset_link", "resend_verification", "lift_suspension"]).nullable(),
});
export type CustomerIssue = z.infer<typeof customerIssueSchema>;

/** One account as the Customers list shows it. */
export const customerSummarySchema = z.object({
  id: z.uuid(),
  /** Masked unless the viewer may see it (a founder) or revealed it. */
  email: z.string(),
  /** The address's own part, for a display name: "amara.okafor". */
  handle: z.string(),
  planCode: z.string(),
  planName: z.string(),
  source: z.enum(["free", "stripe", "admin"]),
  status: customerStatusSchema,
  role: accountRoleSchema,
  teamId: z.uuid().nullable(),
  teamName: z.string().nullable(),
  teamRole: z.enum(["owner", "admin", "member"]).nullable(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime().nullable(),
  /** Account check: what needs looking at, worst first. */
  issues: z.array(customerIssueSchema),
  /** Monthly recurring revenue from this account in the price's minor units; 0 when nothing is paid. */
  mrr: z.number().int().nonnegative(),
  currency: z.string(),
});
export type CustomerSummary = z.infer<typeof customerSummarySchema>;

export const customerViews = [
  "all",
  "attention",
  "past_due",
  "locked",
  "drive_full",
  "no_2fa",
  "staff",
] as const;
export type CustomerView = (typeof customerViews)[number];

export const customerQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  view: z.enum(customerViews).default("all"),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const customerListSchema = z.object({
  customers: z.array(customerSummarySchema),
  nextCursor: z.string().nullable(),
  counts: z.object({
    accounts: z.number().int(),
    joined30d: z.number().int(),
    active7d: z.number().int(),
    attention: z.number().int(),
    views: z.record(z.enum(customerViews), z.number().int()),
  }),
});
export type CustomerList = z.infer<typeof customerListSchema>;

export const staffNoteSchema = z.object({
  id: z.uuid(),
  authorEmail: z.string().nullable(),
  body: z.string(),
  pinned: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type StaffNote = z.infer<typeof staffNoteSchema>;

export const staffNoteRequestSchema = z.object({
  body: z.string().trim().min(1, { error: "Write the note first." }).max(4000),
  pinned: z.boolean().default(false),
});
export type StaffNoteRequest = z.infer<typeof staffNoteRequestSchema>;

/** The 360 view's head and overview tab. */
export const customerSchema = customerSummarySchema.extend({
  liveSessions: z.number().int(),
  sessionLimit: z.number().int(),
  browsingMinutesThisMonth: z.number().int(),
  driveBytes: z.number().int(),
  driveLimitBytes: z.number().int(),
  driveFiles: z.number().int(),
  notes: z.array(staffNoteSchema),
  suspendedAt: z.iso.datetime().nullable(),
  suspendedReason: z.string().nullable(),
  /** Staff may reveal the address with a reason; a founder sees it anyway. */
  revealed: z.boolean(),
});
export type Customer = z.infer<typeof customerSchema>;

export const revealResponseSchema = z.object({ email: z.string() });
export type RevealResponse = z.infer<typeof revealResponseSchema>;

/** Sign-in & security. */
export const customerSignInSchema = z.object({
  passwordSet: z.boolean(),
  emailVerified: z.boolean(),
  passkeys: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      createdAt: z.iso.datetime(),
      lastUsedAt: z.iso.datetime().nullable(),
    }),
  ),
  authenticatorOn: z.boolean(),
  recoveryCodesLeft: z.number().int(),
  failedSignIns24h: z.number().int(),
  /** Active sessions: the devices signed in. */
  devices: z.array(
    z.object({
      id: z.uuid(),
      device: z.string(),
      ipAddress: z.string().nullable(),
      authMethod: z.string(),
      persistent: z.boolean(),
      createdAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
      locked: z.boolean(),
    }),
  ),
  signIns: z.array(
    z.object({
      at: z.iso.datetime(),
      type: z.string(),
      ok: z.boolean(),
      ipAddress: z.string().nullable(),
      device: z.string(),
      newDevice: z.boolean(),
    }),
  ),
});
export type CustomerSignIn = z.infer<typeof customerSignInSchema>;

export const planLimitsViewSchema = z.object({
  profiles: z.number().int(),
  proxies: z.number().int(),
  driveBytes: z.number().int(),
  driveFiles: z.number().int(),
  browsingMinutesPerMonth: z.number().int().nullable(),
  liveSessions: z.number().int(),
  teamMembers: z.number().int(),
});

export const planPriceViewSchema = z.object({
  amount: z.number().int(),
  currency: z.string(),
  interval: z.string(),
});

/** Subscription & billing. */
export const customerBillingSchema = z.object({
  planCode: z.string(),
  planName: z.string(),
  source: z.enum(["free", "stripe", "admin"]),
  planNote: z.string().nullable(),
  price: planPriceViewSchema.nullable(),
  subscription: z
    .object({
      status: z.string(),
      planCode: z.string(),
      currentPeriodEnd: z.iso.datetime().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  /** The team whose plan covers this account, if any. */
  coveredBy: z.object({ teamId: z.uuid(), teamName: z.string() }).nullable(),
  limits: planLimitsViewSchema,
  usage: z.object({
    profiles: z.number().int(),
    proxies: z.number().int(),
    driveBytes: z.number().int(),
    driveFiles: z.number().int(),
    browsingMinutesThisMonth: z.number().int(),
  }),
  stripeConfigured: z.boolean(),
  /** The plans staff may set by hand. */
  plans: z.array(z.object({ code: z.string(), name: z.string() })),
});
export type CustomerBilling = z.infer<typeof customerBillingSchema>;

/** Browsers & sessions. */
export const customerBrowsersSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.uuid(),
      engine: z.string(),
      engineName: z.string(),
      profileName: z.string().nullable(),
      runtimeHost: z.string().nullable(),
      startedAt: z.iso.datetime().nullable(),
      lastViewedAt: z.iso.datetime().nullable(),
      status: z.string(),
    }),
  ),
  profiles: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      engine: z.string(),
      engineName: z.string(),
      keepData: z.boolean(),
      dataBytes: z.number().int(),
      dataSavedAt: z.iso.datetime().nullable(),
      extensions: z.array(z.string()),
      proxyName: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  sessionLimit: z.number().int(),
});
export type CustomerBrowsers = z.infer<typeof customerBrowsersSchema>;

/** Drive. */
export const customerDriveSchema = z.object({
  usedBytes: z.number().int(),
  limitBytes: z.number().int(),
  files: z.number().int(),
  folders: z.number().int(),
  quarantined: z.number().int(),
  trash: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      size: z.number().int(),
      trashedAt: z.iso.datetime(),
    }),
  ),
  trashBytes: z.number().int(),
});
export type CustomerDrive = z.infer<typeof customerDriveSchema>;

/** Activity: the account's security history, newest first, with staff actions on it. */
export const customerActivitySchema = z.object({
  events: z.array(
    z.object({
      at: z.iso.datetime(),
      type: z.string(),
      ipAddress: z.string().nullable(),
      device: z.string(),
      /** A staff action on this account, from the audit log: who did it. */
      staff: z.string().nullable(),
      detail: z.string(),
    }),
  ),
});
export type CustomerActivity = z.infer<typeof customerActivitySchema>;

/** Privacy & data. */
export const customerPrivacySchema = z.object({
  held: z.array(z.object({ what: z.string(), detail: z.string() })),
  marketingEmails: z.boolean(),
  exports: z.array(z.object({ at: z.iso.datetime() })),
});
export type CustomerPrivacy = z.infer<typeof customerPrivacySchema>;

/* ── Organisations ── */

export const organisationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  ownerEmail: z.string(),
  members: z.number().int(),
  memberLimit: z.number().int(),
  invitations: z.number().int(),
  planCode: z.string(),
  planName: z.string(),
  renewsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime().nullable(),
  proxies: z.number().int(),
});
export type OrganisationSummary = z.infer<typeof organisationSummarySchema>;

export const organisationListSchema = z.object({
  organisations: z.array(organisationSummarySchema),
});
export type OrganisationList = z.infer<typeof organisationListSchema>;

export const organisationSchema = organisationSummarySchema.extend({
  memberList: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      role: z.enum(["owner", "admin", "member"]),
      joinedAt: z.iso.datetime(),
      lastActiveAt: z.iso.datetime().nullable(),
      secondFactor: z.boolean(),
      status: customerStatusSchema,
    }),
  ),
  invitationList: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  ),
});
export type Organisation = z.infer<typeof organisationSchema>;

/* ── Company ── */

export const moneySchema = z.object({ currency: z.string(), amount: z.number().int() });

export const companyOverviewSchema = z.object({
  accounts: z.number().int(),
  joined30d: z.number().int(),
  active7d: z.number().int(),
  payingAccounts: z.number().int(),
  teams: z.number().int(),
  /** Monthly recurring revenue in minor units, by currency; empty without Stripe prices. */
  mrr: z.array(moneySchema),
  mrrLastMonth: z.array(moneySchema),
  stripeConfigured: z.boolean(),
  liveSessions: z.number().int(),
  liveSessionLimit: z.number().int(),
  attention: z.number().int(),
  pastDue: z.number().int(),
  openReports: z.number().int(),
  staffWithoutSecondFactor: z.number().int(),
  staleStaff: z.number().int(),
  /** Revenue by month for the last twelve months (minor units, the installation's first currency). */
  revenueByMonth: z.array(z.object({ month: z.string(), amount: z.number().int() })),
  currency: z.string(),
  recentActions: z.array(staffActionSchema),
  largestTeams: z.array(organisationSummarySchema),
});
export type CompanyOverview = z.infer<typeof companyOverviewSchema>;

export const growthSchema = z.object({
  months: z.array(
    z.object({
      month: z.string(),
      signUps: z.number().int(),
      /** Opened a cloud browser within a day of signing up. */
      activated: z.number().int(),
      /** Started paying within the month. */
      converted: z.number().int(),
      /** Subscriptions that ended in the month. */
      churned: z.number().int(),
    }),
  ),
  funnel: z.object({
    signedUp: z.number().int(),
    verified: z.number().int(),
    openedBrowser: z.number().int(),
    usedThreeDays: z.number().int(),
    paying: z.number().int(),
  }),
  /** Of accounts that signed up in each month, the share (0 to 100) still active n months on. */
  retention: z.array(z.object({ month: z.string(), kept: z.array(z.number().int()) })),
  byPlan: z.array(
    z.object({
      planCode: z.string(),
      planName: z.string(),
      accounts: z.number().int(),
      mrr: z.number().int(),
    }),
  ),
  currency: z.string(),
});
export type Growth = z.infer<typeof growthSchema>;

/* ── Settings ── */

export const adminSettingsSchema = z.object({
  plans: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      price: planPriceViewSchema.nullable(),
      limits: planLimitsViewSchema,
      accounts: z.number().int(),
    }),
  ),
  services: z.array(
    z.object({
      name: z.string(),
      purpose: z.string(),
      state: z.enum(["configured", "off", "development"]),
      detail: z.string(),
    }),
  ),
  adminEmails: z.array(z.string()),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;
