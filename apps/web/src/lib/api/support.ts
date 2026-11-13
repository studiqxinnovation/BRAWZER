import {
  type CreateTicketRequest,
  type TicketRatingRequest,
  ticketListSchema,
  ticketSchema,
} from "@brawzer/contracts";
import { apiRequest } from "./client";

/** Help: the account's own support requests. */
const ticketPath = (id: string, rest = "") =>
  `/support/tickets/${encodeURIComponent(id)}${rest}` as const;

export const fetchTickets = () => apiRequest("/support/tickets", { schema: ticketListSchema });
export const fetchTicket = (id: string) => apiRequest(ticketPath(id), { schema: ticketSchema });
export const createTicket = (body: CreateTicketRequest) =>
  apiRequest("/support/tickets", { method: "POST", body, schema: ticketSchema });
export const replyToTicket = (id: string, body: string) =>
  apiRequest(ticketPath(id, "/messages"), { method: "POST", body: { body }, schema: ticketSchema });
export const solveTicket = (id: string) =>
  apiRequest(ticketPath(id, "/solve"), { method: "POST", schema: ticketSchema });
export const rateTicket = (id: string, body: TicketRatingRequest) =>
  apiRequest(ticketPath(id, "/rating"), { method: "POST", body, schema: ticketSchema });
