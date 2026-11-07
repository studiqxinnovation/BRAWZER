export interface SessionMeter {
  sessionId: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  bytesTransferred: number;
}

export interface ISessionMeterRepository {
  start(sessionId: string, userId: string): Promise<void>;
  end(sessionId: string, bytesTransferred: number): Promise<SessionMeter>;
  findByUser(userId: string): Promise<SessionMeter[]>;
  findBySession(sessionId: string): Promise<SessionMeter | null>;
}

export interface PricingTier {
  name: string;
  monthlyBaseMinutes: number;
  pricePerMinuteCents: number;
  pricePerGbCents: number;
}

export const TIERS: Record<string, PricingTier> = {
  free:    { name: "free",    monthlyBaseMinutes: 60,   pricePerMinuteCents: 0,  pricePerGbCents: 0  },
  starter: { name: "starter", monthlyBaseMinutes: 300,  pricePerMinuteCents: 2,  pricePerGbCents: 10 },
  pro:     { name: "pro",     monthlyBaseMinutes: 1200, pricePerMinuteCents: 1,  pricePerGbCents: 8  },
};

export function calcSessionCost(
  durationMs: number,
  bytesTransferred: number,
  tier: PricingTier,
  minutesUsedThisMonth: number
): { minuteCents: number; dataCents: number; totalCents: number } {
  const minutes = durationMs / 60_000;
  const gb = bytesTransferred / 1_073_741_824;

  const billableMinutes = Math.max(0, minutesUsedThisMonth + minutes - tier.monthlyBaseMinutes);
  const minuteCents = Math.ceil(billableMinutes * tier.pricePerMinuteCents);
  const dataCents = Math.ceil(gb * tier.pricePerGbCents);

  return { minuteCents, dataCents, totalCents: minuteCents + dataCents };
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface Invoice {
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  tier: string;
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function buildInvoice(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  tier: PricingTier,
  meters: SessionMeter[]
): Invoice {
  const completedSessions = meters.filter((m) => m.endedAt !== null && m.durationMs !== null);

  const totalMs = completedSessions.reduce((sum, m) => sum + (m.durationMs ?? 0), 0);
  const totalBytes = completedSessions.reduce((sum, m) => sum + m.bytesTransferred, 0);
  const totalMinutes = totalMs / 60_000;
  const totalGb = totalBytes / 1_073_741_824;

  const billableMinutes = Math.max(0, totalMinutes - tier.monthlyBaseMinutes);
  const minuteCents = Math.ceil(billableMinutes * tier.pricePerMinuteCents);
  const dataCents = Math.ceil(totalGb * tier.pricePerGbCents);

  const lineItems: InvoiceLineItem[] = [];

  if (tier.monthlyBaseMinutes > 0) {
    lineItems.push({
      description: `${tier.name} plan — ${tier.monthlyBaseMinutes} included minutes`,
      quantity: 1,
      unitCents: 0,
      totalCents: 0,
    });
  }

  if (billableMinutes > 0) {
    lineItems.push({
      description: "Additional minutes",
      quantity: Math.ceil(billableMinutes),
      unitCents: tier.pricePerMinuteCents,
      totalCents: minuteCents,
    });
  }

  if (dataCents > 0) {
    lineItems.push({
      description: "Data transfer",
      quantity: parseFloat(totalGb.toFixed(4)),
      unitCents: tier.pricePerGbCents,
      totalCents: dataCents,
    });
  }

  const subtotalCents = minuteCents + dataCents;
  const taxCents = Math.ceil(subtotalCents * 0.2);

  return {
    userId,
    periodStart,
    periodEnd,
    tier: tier.name,
    lineItems,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}
