import { describe, it, expect } from "vitest";
import { calcSessionCost, buildInvoice, TIERS, SessionMeter } from "./metering";

describe("calcSessionCost", () => {
  it("charges nothing within free tier base minutes", () => {
    const result = calcSessionCost(30 * 60_000, 0, TIERS.free, 0);
    expect(result.totalCents).toBe(0);
  });

  it("charges overage minutes above base", () => {
    const result = calcSessionCost(10 * 60_000, 0, TIERS.starter, 295);
    expect(result.minuteCents).toBeGreaterThan(0);
  });

  it("charges for data transfer", () => {
    const oneGb = 1_073_741_824;
    const result = calcSessionCost(0, oneGb, TIERS.starter, 0);
    expect(result.dataCents).toBe(TIERS.starter.pricePerGbCents);
  });

  it("free tier never charges", () => {
    const result = calcSessionCost(120 * 60_000, 1_073_741_824 * 10, TIERS.free, 1000);
    expect(result.totalCents).toBe(0);
  });
});

describe("buildInvoice", () => {
  const periodStart = new Date("2026-11-01");
  const periodEnd = new Date("2026-11-30");

  const makeSession = (durationMs: number, bytes = 0): SessionMeter => ({
    sessionId: "s1",
    userId: "u1",
    startedAt: new Date(),
    endedAt: new Date(),
    durationMs,
    bytesTransferred: bytes,
  });

  it("produces zero invoice when within base minutes", () => {
    const meters = [makeSession(30 * 60_000)];
    const invoice = buildInvoice("u1", periodStart, periodEnd, TIERS.starter, meters);
    expect(invoice.subtotalCents).toBe(0);
    expect(invoice.totalCents).toBe(0);
  });

  it("produces overage invoice when exceeding base minutes", () => {
    const meters = [makeSession(400 * 60_000)];
    const invoice = buildInvoice("u1", periodStart, periodEnd, TIERS.starter, meters);
    expect(invoice.subtotalCents).toBeGreaterThan(0);
    expect(invoice.lineItems.some((l) => l.description === "Additional minutes")).toBe(true);
  });

  it("includes data line item when transfer exceeds 0 bytes", () => {
    const meters = [makeSession(10 * 60_000, 1_073_741_824)];
    const invoice = buildInvoice("u1", periodStart, periodEnd, TIERS.starter, meters);
    expect(invoice.lineItems.some((l) => l.description === "Data transfer")).toBe(true);
  });

  it("applies 20% tax on subtotal", () => {
    const meters = [makeSession(400 * 60_000)];
    const invoice = buildInvoice("u1", periodStart, periodEnd, TIERS.starter, meters);
    expect(invoice.taxCents).toBe(Math.ceil(invoice.subtotalCents * 0.2));
    expect(invoice.totalCents).toBe(invoice.subtotalCents + invoice.taxCents);
  });

  it("skips incomplete sessions", () => {
    const incomplete: SessionMeter = {
      sessionId: "s2", userId: "u1",
      startedAt: new Date(), endedAt: null, durationMs: null, bytesTransferred: 0,
    };
    const invoice = buildInvoice("u1", periodStart, periodEnd, TIERS.starter, [incomplete]);
    expect(invoice.subtotalCents).toBe(0);
  });
});
