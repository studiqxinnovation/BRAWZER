import { Injectable } from "@nestjs/common";

type Labels = Readonly<Record<string, string>>;

interface Counter {
  kind: "counter";
  help: string;
  values: Map<string, { labels: Labels; value: number }>;
}

interface Gauge {
  kind: "gauge";
  help: string;
  /** Read at scrape time: live figures (sessions, viewers), never kept twice. */
  collect: () => Promise<readonly { labels?: Labels; value: number }[]>;
}

interface Summary {
  kind: "summary";
  help: string;
  count: number;
  sum: number;
}

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}="${escapeLabel(labels[key] ?? "")}"`)
    .join(",");
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

/**
 * The figures the runbook's "watch" section asks for, in Prometheus's text
 * format at GET /api/metrics (Phase 8, idea 17). Counters are kept here;
 * gauges are read from their owners when scraped. Nothing here names a
 * person, an address or a page: counts and durations only.
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly summaries = new Map<string, Summary>();

  /** Adds `by` to a counter; the counter and its label set appear on first use. */
  count(name: string, help: string, labels: Labels = {}, by = 1): void {
    if (!NAME.test(name)) throw new Error(`Not a metric name: ${name}`);
    let counter = this.counters.get(name);
    if (!counter) {
      counter = { kind: "counter", help, values: new Map() };
      this.counters.set(name, counter);
    }
    const key = labelKey(labels);
    const entry = counter.values.get(key);
    if (entry) entry.value += by;
    else counter.values.set(key, { labels, value: by });
  }

  /** Registers a gauge read at scrape time. Registering again replaces the reader. */
  gauge(name: string, help: string, collect: Gauge["collect"]): void {
    if (!NAME.test(name)) throw new Error(`Not a metric name: ${name}`);
    this.gauges.set(name, { kind: "gauge", help, collect });
  }

  /** Records one observation (a duration in seconds, a size in bytes). */
  observe(name: string, help: string, value: number): void {
    if (!NAME.test(name)) throw new Error(`Not a metric name: ${name}`);
    let summary = this.summaries.get(name);
    if (!summary) {
      summary = { kind: "summary", help, count: 0, sum: 0 };
      this.summaries.set(name, summary);
    }
    summary.count += 1;
    summary.sum += value;
  }

  /** The exposition text. A gauge whose reader fails is left out of that scrape, never the others. */
  async render(): Promise<string> {
    const lines: string[] = [];
    for (const [name, counter] of [...this.counters].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`# HELP ${name} ${counter.help}`, `# TYPE ${name} counter`);
      for (const { labels, value } of counter.values.values()) {
        const key = labelKey(labels);
        lines.push(`${name}${key ? `{${key}}` : ""} ${String(value)}`);
      }
    }
    for (const [name, summary] of [...this.summaries].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(
        `# HELP ${name} ${summary.help}`,
        `# TYPE ${name} summary`,
        `${name}_sum ${String(summary.sum)}`,
        `${name}_count ${String(summary.count)}`,
      );
    }
    for (const [name, gauge] of [...this.gauges].sort(([a], [b]) => a.localeCompare(b))) {
      let values: readonly { labels?: Labels; value: number }[];
      try {
        values = await gauge.collect();
      } catch {
        continue;
      }
      lines.push(`# HELP ${name} ${gauge.help}`, `# TYPE ${name} gauge`);
      for (const { labels, value } of values) {
        const key = labelKey(labels ?? {});
        lines.push(`${name}${key ? `{${key}}` : ""} ${String(value)}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}
