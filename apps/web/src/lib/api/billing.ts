import {
  adminAccountListSchema,
  adminAccountSchema,
  type AdminSetPlanRequest,
  billingOverviewSchema,
  checkoutResponseSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const fetchBillingOverview = () => apiRequest("/billing", { schema: billingOverviewSchema });

/** Stripe's hosted checkout for a plan; needs a recent sign-in. */
export const startCheckout = (planCode: string) =>
  apiRequest("/billing/checkout", {
    method: "POST",
    body: { planCode },
    schema: checkoutResponseSchema,
  });

/** Stripe's billing portal (invoices, payment method, cancelling); needs a recent sign-in. */
export const openBillingPortal = () =>
  apiRequest("/billing/portal", { method: "POST", schema: checkoutResponseSchema });

export const listAccounts = (query: { q?: string; before?: string }) => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.before) params.set("before", query.before);
  const search = params.toString();
  return apiRequest(`/admin/accounts${search ? `?${search}` : ""}`, {
    schema: adminAccountListSchema,
  });
};

export const fetchAdminAccount = (id: string) =>
  apiRequest(`/admin/accounts/${encodeURIComponent(id)}`, { schema: adminAccountSchema });

export const setAccountPlan = (id: string, body: AdminSetPlanRequest) =>
  apiRequest(`/admin/accounts/${encodeURIComponent(id)}/plan`, {
    method: "PUT",
    body,
    schema: adminAccountSchema,
  });
