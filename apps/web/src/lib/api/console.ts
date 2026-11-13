import {
  type AdminSetPlanRequest,
  adminSettingsSchema,
  companyOverviewSchema,
  customerActivitySchema,
  customerBillingSchema,
  customerBrowsersSchema,
  customerDriveSchema,
  customerListSchema,
  customerPrivacySchema,
  customerSchema,
  customerSignInSchema,
  type CustomerView,
  driveFileSchema,
  growthSchema,
  organisationListSchema,
  organisationSchema,
  revealResponseSchema,
  staffActionListSchema,
  type StaffInviteRequest,
  staffListSchema,
  type StaffNoteRequest,
  staffNoteSchema,
  type StaffRole,
  type SavedReplyRequest,
  savedReplyListSchema,
  type StaffReplyRequest,
  staffTicketListSchema,
  staffTicketSchema,
  supportStatsSchema,
  type TicketView,
  type UpdateTicketRequest,
  type AnnouncementRequest,
  type DeclareIncidentRequest,
  incidentListSchema,
  incidentSchema,
  type IncidentUpdateRequest,
  publicStatusSchema,
  staffAnnouncementListSchema,
  recoveryCaseListSchema,
  type RecoveryCheckRequest,
  type RecoveryReleaseRequest,
  approvalListSchema,
  couponListSchema,
  couponResultSchema,
  type CreateCouponRequest,
  financeSchema,
  invoiceListSchema,
  type RefundRequest,
  refundResultSchema,
  subscriptionListSchema,
  upgradeSignalListSchema,
} from "@brawzer/contracts";
import { z } from "zod";
import { apiRequest } from "./client";

/** The admin console's API (Phase 11). */

const path = (parts: string[]) =>
  `/console/${parts.map((part) => encodeURIComponent(part)).join("/")}` as const;

export const fetchOverview = () =>
  apiRequest("/console/overview", { schema: companyOverviewSchema });
export const fetchGrowth = () => apiRequest("/console/growth", { schema: growthSchema });
export const fetchSettings = () => apiRequest("/console/settings", { schema: adminSettingsSchema });

export const fetchStaff = () => apiRequest("/console/staff", { schema: staffListSchema });
export const inviteStaff = (body: StaffInviteRequest) =>
  apiRequest("/console/staff", { method: "POST", body, schema: staffListSchema });
export const setStaffRole = (id: string, role: Exclude<StaffRole, "admin">) =>
  apiRequest(path(["staff", id, "role"]), {
    method: "PUT",
    body: { role },
    schema: staffListSchema,
  });
export const removeStaff = (id: string, reason: string) =>
  apiRequest(path(["staff", id, "remove"]), {
    method: "POST",
    body: { reason },
    schema: staffListSchema,
  });

export const fetchAuditLog = (query: { q?: string; role?: StaffRole; before?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.role) params.set("role", query.role);
  if (query.before) params.set("before", query.before);
  const search = params.toString();
  return apiRequest(`/console/audit${search ? `?${search}` : ""}`, {
    schema: staffActionListSchema,
  });
};

export const fetchOrganisations = () =>
  apiRequest("/console/organisations", { schema: organisationListSchema });
export const fetchOrganisation = (id: string) =>
  apiRequest(path(["organisations", id]), { schema: organisationSchema });

export const fetchCustomers = (
  query: { q?: string; view?: CustomerView; before?: string } = {},
) => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.view) params.set("view", query.view);
  if (query.before) params.set("before", query.before);
  const search = params.toString();
  return apiRequest(`/console/customers${search ? `?${search}` : ""}`, {
    schema: customerListSchema,
  });
};
export const fetchCustomer = (id: string) =>
  apiRequest(path(["customers", id]), { schema: customerSchema });
export const revealCustomer = (id: string, reason: string) =>
  apiRequest(path(["customers", id, "reveal"]), {
    method: "POST",
    body: { reason },
    schema: revealResponseSchema,
  });
export const fetchCustomerSignIn = (id: string) =>
  apiRequest(path(["customers", id, "sign-in"]), { schema: customerSignInSchema });
export const fetchCustomerBilling = (id: string) =>
  apiRequest(path(["customers", id, "billing"]), { schema: customerBillingSchema });
export const fetchCustomerBrowsers = (id: string) =>
  apiRequest(path(["customers", id, "browsers"]), { schema: customerBrowsersSchema });
export const fetchCustomerDrive = (id: string) =>
  apiRequest(path(["customers", id, "drive"]), { schema: customerDriveSchema });
export const fetchCustomerActivity = (id: string) =>
  apiRequest(path(["customers", id, "activity"]), { schema: customerActivitySchema });
export const fetchCustomerPrivacy = (id: string) =>
  apiRequest(path(["customers", id, "privacy"]), { schema: customerPrivacySchema });

const notesSchema = z.array(staffNoteSchema);
export const addCustomerNote = (id: string, body: StaffNoteRequest) =>
  apiRequest(path(["customers", id, "notes"]), { method: "POST", body, schema: notesSchema });
export const deleteCustomerNote = (id: string, noteId: string) =>
  apiRequest(path(["customers", id, "notes", noteId]), { method: "DELETE", schema: notesSchema });

export const sendResetLink = (id: string) =>
  apiRequest<undefined>(path(["customers", id, "reset-link"]), { method: "POST" });
export const signOutCustomer = (id: string, reason: string) =>
  apiRequest<undefined>(path(["customers", id, "sign-out"]), { method: "POST", body: { reason } });
export const signOutCustomerDevice = (id: string, sessionId: string) =>
  apiRequest<undefined>(path(["customers", id, "devices", sessionId]), { method: "DELETE" });
export const removeCustomerPasskey = (id: string, passkeyId: string, reason: string) =>
  apiRequest<undefined>(path(["customers", id, "passkeys", passkeyId, "remove"]), {
    method: "POST",
    body: { reason },
  });
export const disableCustomerTwoFactor = (id: string, reason: string) =>
  apiRequest<undefined>(path(["customers", id, "two-factor", "disable"]), {
    method: "POST",
    body: { reason },
  });
export const suspendCustomer = (id: string, reason: string) =>
  apiRequest<undefined>(path(["customers", id, "suspend"]), { method: "POST", body: { reason } });
export const liftCustomerSuspension = (id: string, reason: string) =>
  apiRequest<undefined>(path(["customers", id, "lift-suspension"]), {
    method: "POST",
    body: { reason },
  });
export const setCustomerPlan = (id: string, body: AdminSetPlanRequest) =>
  apiRequest<undefined>(path(["customers", id, "plan"]), { method: "PUT", body });
export const restoreCustomerFile = (id: string, fileId: string) =>
  apiRequest(path(["customers", id, "trash", fileId, "restore"]), {
    method: "POST",
    schema: driveFileSchema,
  });
export const endCustomerSession = (id: string, sessionId: string, reason: string) =>
  apiRequest<undefined>(path(["customers", id, "sessions", sessionId, "end"]), {
    method: "POST",
    body: { reason },
  });
export const deleteCustomer = (id: string, reason: string) =>
  apiRequest<undefined>(path(["customers", id, "delete"]), { method: "POST", body: { reason } });

/* ── Customer care (11.2) ── */

export const fetchInbox = (query: { view?: TicketView; mine?: boolean; q?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.view) params.set("view", query.view);
  if (query.mine) params.set("mine", "true");
  if (query.q) params.set("q", query.q);
  const search = params.toString();
  return apiRequest(`/console/support/tickets${search ? `?${search}` : ""}`, {
    schema: staffTicketListSchema,
  });
};
export const fetchAssignees = () =>
  apiRequest("/console/support/assignees", {
    schema: z.object({ assignees: z.array(z.object({ id: z.uuid(), email: z.string() })) }),
  });
export const fetchStaffTicket = (id: string) =>
  apiRequest(path(["support", "tickets", id]), { schema: staffTicketSchema });
export const updateTicket = (id: string, body: UpdateTicketRequest) =>
  apiRequest(path(["support", "tickets", id]), {
    method: "PATCH",
    body,
    schema: staffTicketSchema,
  });
export const replyAsStaff = (id: string, body: StaffReplyRequest) =>
  apiRequest(path(["support", "tickets", id, "messages"]), {
    method: "POST",
    body,
    schema: staffTicketSchema,
  });
export const fetchSavedReplies = () =>
  apiRequest("/console/support/replies", { schema: savedReplyListSchema });
export const addSavedReply = (body: SavedReplyRequest) =>
  apiRequest("/console/support/replies", { method: "POST", body, schema: savedReplyListSchema });
export const editSavedReply = (id: string, body: SavedReplyRequest) =>
  apiRequest(path(["support", "replies", id]), {
    method: "PUT",
    body,
    schema: savedReplyListSchema,
  });
export const deleteSavedReply = (id: string) =>
  apiRequest(path(["support", "replies", id]), { method: "DELETE", schema: savedReplyListSchema });
export const fetchSupportStats = () =>
  apiRequest("/console/support/stats", { schema: supportStatsSchema });

/* ── Announcements, incidents and status (11.2) ── */

export const fetchAnnouncements = () =>
  apiRequest("/console/announcements", { schema: staffAnnouncementListSchema });
export const publishAnnouncement = (body: AnnouncementRequest) =>
  apiRequest("/console/announcements", {
    method: "POST",
    body,
    schema: staffAnnouncementListSchema,
  });
export const editAnnouncement = (id: string, body: AnnouncementRequest) =>
  apiRequest(path(["announcements", id]), {
    method: "PUT",
    body,
    schema: staffAnnouncementListSchema,
  });
export const toggleAnnouncement = (id: string, on: boolean) =>
  apiRequest(path(["announcements", id]), {
    method: "PATCH",
    body: { on },
    schema: staffAnnouncementListSchema,
  });
export const deleteAnnouncement = (id: string) =>
  apiRequest(path(["announcements", id]), {
    method: "DELETE",
    schema: staffAnnouncementListSchema,
  });
export const fetchIncidents = () =>
  apiRequest("/console/incidents", { schema: incidentListSchema });
export const declareIncident = (body: DeclareIncidentRequest) =>
  apiRequest("/console/incidents", { method: "POST", body, schema: incidentSchema });
export const postIncidentUpdate = (id: string, body: IncidentUpdateRequest) =>
  apiRequest(path(["incidents", id, "updates"]), { method: "POST", body, schema: incidentSchema });
export const fetchPublicStatus = () => apiRequest("/status", { schema: publicStatusSchema });

/* ── Account recovery (11.2) ── */

export const fetchRecoveryCases = () =>
  apiRequest("/console/recovery", { schema: recoveryCaseListSchema });
export const startRecoveryFor = (customerId: string) =>
  apiRequest("/console/recovery", {
    method: "POST",
    body: { customerId },
    schema: recoveryCaseListSchema,
  });
export const recordRecoveryCheck = (id: string, body: RecoveryCheckRequest) =>
  apiRequest(path(["recovery", id, "checks"]), {
    method: "POST",
    body,
    schema: recoveryCaseListSchema,
  });
export const markRecoveryReviewed = (id: string) =>
  apiRequest(path(["recovery", id, "reviewed"]), {
    method: "POST",
    schema: recoveryCaseListSchema,
  });
export const releaseRecovery = (id: string, body: RecoveryReleaseRequest) =>
  apiRequest(path(["recovery", id, "release"]), {
    method: "POST",
    body,
    schema: recoveryCaseListSchema,
  });
export const denyRecovery = (id: string, reason: string) =>
  apiRequest(path(["recovery", id, "deny"]), {
    method: "POST",
    body: { reason },
    schema: recoveryCaseListSchema,
  });

/* ── Money (11.3) ── */

export const fetchSubscriptions = () =>
  apiRequest("/console/billing/subscriptions", { schema: subscriptionListSchema });
export const fetchInvoices = (query: { customer?: string; after?: string } = {}) => {
  const params = new URLSearchParams();
  if (query.customer) params.set("customer", query.customer);
  if (query.after) params.set("after", query.after);
  const search = params.toString();
  return apiRequest(`/console/billing/invoices${search ? `?${search}` : ""}`, {
    schema: invoiceListSchema,
  });
};
export const refundInvoice = (id: string, body: RefundRequest) =>
  apiRequest(`/console/billing/invoices/${encodeURIComponent(id)}/refund`, {
    method: "POST",
    body,
    schema: refundResultSchema,
  });
export const fetchCoupons = () =>
  apiRequest("/console/billing/coupons", { schema: couponListSchema });
export const createCoupon = (body: CreateCouponRequest) =>
  apiRequest("/console/billing/coupons", { method: "POST", body, schema: couponResultSchema });
export const toggleCoupon = (id: string, active: boolean) =>
  apiRequest(`/console/billing/coupons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { active },
    schema: couponListSchema,
  });
export const fetchFinance = () => apiRequest("/console/billing/finance", { schema: financeSchema });
export const fetchApprovals = () =>
  apiRequest("/console/billing/approvals", { schema: approvalListSchema });
export const decideApproval = (id: string, approve: boolean, reason: string) =>
  apiRequest(
    `/console/billing/approvals/${encodeURIComponent(id)}/${approve ? "approve" : "decline"}`,
    {
      method: "POST",
      body: { reason },
      schema: approvalListSchema,
    },
  );
export const fetchUpgradeSignals = () =>
  apiRequest("/console/billing/upgrade-signals", { schema: upgradeSignalListSchema });
