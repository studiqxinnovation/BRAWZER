import {
  type CreateProxyRequest,
  proxyListSchema,
  proxySchema,
  proxyTestResultSchema,
  type UpdateProxyRequest,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

export const fetchProxies = () => apiRequest("/proxies", { schema: proxyListSchema });

export const createProxy = (body: CreateProxyRequest) =>
  apiRequest("/proxies", { method: "POST", body, schema: proxySchema });

export const updateProxy = (id: string, body: UpdateProxyRequest) =>
  apiRequest(`/proxies/${encodeURIComponent(id)}`, { method: "PATCH", body, schema: proxySchema });

export const deleteProxy = (id: string) =>
  apiRequest<undefined>(`/proxies/${encodeURIComponent(id)}`, { method: "DELETE" });

export const testProxy = (id: string) =>
  apiRequest(`/proxies/${encodeURIComponent(id)}/test`, {
    method: "POST",
    schema: proxyTestResultSchema,
  });
