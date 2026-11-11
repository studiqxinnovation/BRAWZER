"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { FileDown, Plus, Trash2 } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { z } from "zod";
import { saveToDrive } from "./drive-save";
import { csvCell, formatMoney, sum } from "./money-format";
import { RecordStatus } from "./record-status";
import { formText, newId, useAppRecord } from "./use-app-record";

const entrySchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["income", "expense"]),
  amount: z.number().nonnegative(),
  category: z.string(),
  note: z.string(),
});
const stateSchema = z.object({ currency: z.string().max(4), entries: z.array(entrySchema) });
type Entry = z.infer<typeof entrySchema>;

const CURRENCIES = ["£", "$", "€", "₦", "₹", "R", "KSh", "GH₵"];
const pad = (value: number) => String(value).padStart(2, "0");
const thisMonth = () => {
  const now = new Date();
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}`;
};
const todayIso = () => {
  const now = new Date();
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const monthName = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(year ?? 1970, (number ?? 1) - 1, 1).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
};

/** Income and expenses, a month at a glance. */
export default function MoneyApp() {
  const toast = useToast();
  const { value, update, loaded, save, retry } = useAppRecord("money", "state", stateSchema, {
    currency: "£",
    entries: [],
  });
  const [month, setMonth] = useState(thisMonth);
  const [kind, setKind] = useState<Entry["kind"]>("expense");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const currency = value.currency;

  const inMonth = value.entries
    .filter((entry) => entry.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));
  const income = sum(
    inMonth.filter((entry) => entry.kind === "income").map((entry) => entry.amount),
  );
  const expenses = sum(
    inMonth.filter((entry) => entry.kind === "expense").map((entry) => entry.amount),
  );
  const byCategory = Object.entries(
    inMonth
      .filter((entry) => entry.kind === "expense")
      .reduce<Record<string, number>>((totals, entry) => {
        const name = entry.category || "Other";
        totals[name] = sum([totals[name] ?? 0, entry.amount]);
        return totals;
      }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const categories = [...new Set(value.entries.map((entry) => entry.category).filter(Boolean))];

  function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(formText(form, "amount").replace(/,/g, ""));
    const date = formText(form, "date");
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Enter an amount above zero and a date.");
      return;
    }
    setError(null);
    const entry: Entry = {
      id: newId(),
      date,
      kind,
      amount: Math.round(amount * 100) / 100,
      category: formText(form, "category").trim(),
      note: formText(form, "note").trim(),
    };
    update((current) => ({ ...current, entries: [...current.entries, entry] }));
    event.currentTarget.reset();
  }

  async function exportMonth() {
    setExporting(true);
    const rows = [
      ["Date", "Type", "Category", "Note", "Amount"],
      ...[...inMonth]
        .reverse()
        .map((entry) => [
          entry.date,
          entry.kind === "income" ? "Income" : "Expense",
          entry.category,
          entry.note,
          (entry.kind === "income" ? entry.amount : -entry.amount).toFixed(2),
        ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const result = await saveToDrive({
      name: `Money ${month}.csv`,
      content: csv,
      type: "text/csv",
      folder: "Money",
    });
    setExporting(false);
    toast.add(
      result.ok
        ? { type: "success", title: "Saved in Drive", description: `Money/${result.data.name}` }
        : { type: "error", title: "Couldn’t save it", description: result.error.message },
    );
  }

  return (
    <div className="ap-body">
      <div className="ap-toolbar">
        <label className="ap-field ap-inline">
          <span>Month</span>
          <input
            className="ap-input"
            type="month"
            value={month}
            onChange={(event) => {
              if (event.target.value) setMonth(event.target.value);
            }}
          />
        </label>
        <label className="ap-field ap-inline">
          <span>Currency</span>
          <select
            className="ap-input"
            value={currency}
            onChange={(event) => {
              const next = event.target.value;
              update((current) => ({ ...current, currency: next }));
            }}
          >
            {CURRENCIES.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        <Button
          size="sm"
          disabled={inMonth.length === 0}
          loading={exporting}
          onClick={() => void exportMonth()}
        >
          <FileDown aria-hidden="true" />
          Save month to Drive (CSV)
        </Button>
      </div>
      <div className="ap-main">
        <div className="ap-stats" aria-label={`${monthName(month)} at a glance`} role="group">
          <div className="ap-stat">
            <span>Income</span>
            <b data-tone="good">{formatMoney(income, currency)}</b>
          </div>
          <div className="ap-stat">
            <span>Expenses</span>
            <b data-tone="bad">{formatMoney(expenses, currency)}</b>
          </div>
          <div className="ap-stat">
            <span>Left over</span>
            <b>{formatMoney(sum([income, -expenses]), currency)}</b>
          </div>
        </div>

        <form
          method="post"
          className="ap-card ap-form-row"
          aria-label="New entry"
          onSubmit={add}
          noValidate
        >
          <div className="ap-segment" role="radiogroup" aria-label="Income or expense">
            {(["expense", "income"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => {
                  setKind(option);
                }}
              >
                {option === "income" ? "Income" : "Expense"}
              </button>
            ))}
          </div>
          <label className="ap-field">
            <span>Amount ({currency})</span>
            <input
              className="ap-input"
              name="amount"
              inputMode="decimal"
              required
              placeholder="0.00"
            />
          </label>
          <label className="ap-field">
            <span>Date</span>
            <input
              className="ap-input"
              name="date"
              type="date"
              defaultValue={todayIso()}
              required
            />
          </label>
          <label className="ap-field">
            <span>Category</span>
            <input
              className="ap-input"
              name="category"
              list="money-categories"
              placeholder="Rent, stock…"
            />
            <datalist id="money-categories">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="ap-field ap-grow">
            <span>Note</span>
            <input className="ap-input" name="note" />
          </label>
          <Button type="submit" variant="primary">
            <Plus aria-hidden="true" />
            Add
          </Button>
          {error && (
            <p className="ap-error" role="alert">
              {error}
            </p>
          )}
        </form>

        {byCategory.length > 0 && (
          <section className="ap-card" aria-labelledby="money-categories-title">
            <h2 id="money-categories-title" className="ap-group-title">
              Where it went
            </h2>
            <ul className="ap-bars">
              {byCategory.map(([name, total]) => (
                <li key={name}>
                  <span>{name}</span>
                  <span className="ap-bar" aria-hidden="true">
                    <i
                      style={{
                        width: `${String(Math.max(4, (total / (byCategory[0]?.[1] ?? 1)) * 100))}%`,
                      }}
                    />
                  </span>
                  <span>{formatMoney(total, currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label={`Entries in ${monthName(month)}`} className="ap-group">
          {loaded !== "loading" && inMonth.length === 0 ? (
            <p className="ap-empty">Nothing in {monthName(month)} yet.</p>
          ) : (
            <table className="ap-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Category</th>
                  <th scope="col">Note</th>
                  <th scope="col" className="text-right">
                    Amount
                  </th>
                  <th scope="col">
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {inMonth.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.date}</td>
                    <td>{entry.category || "—"}</td>
                    <td>{entry.note}</td>
                    <td
                      className="text-right tabular-nums"
                      data-tone={entry.kind === "income" ? "good" : "bad"}
                    >
                      {formatMoney(
                        entry.kind === "income" ? entry.amount : -entry.amount,
                        currency,
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ap-icon-button"
                        aria-label={`Delete ${entry.note || entry.category || "entry"} of ${entry.date}`}
                        onClick={() => {
                          update((current) => ({
                            ...current,
                            entries: current.entries.filter(
                              (candidate) => candidate.id !== entry.id,
                            ),
                          }));
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <RecordStatus save={save} loaded={loaded} onRetry={() => void retry()}>
        {String(inMonth.length)} entries in {monthName(month)}
      </RecordStatus>
    </div>
  );
}
