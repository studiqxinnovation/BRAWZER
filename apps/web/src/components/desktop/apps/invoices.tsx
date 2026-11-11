"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { Building2, FileDown, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { saveToDrive } from "./drive-save";
import { type Business, invoicePdf, totals } from "./invoice-pdf";
import { formatMoney } from "./money-format";
import { RecordStatus } from "./record-status";
import { newId, useAppRecord } from "./use-app-record";

const itemSchema = z.object({ description: z.string(), quantity: z.number(), price: z.number() });
const invoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  kind: z.enum(["invoice", "quote"]),
  status: z.enum(["draft", "sent", "paid"]),
  date: z.string(),
  due: z.string(),
  client: z.object({ name: z.string(), email: z.string(), address: z.string() }),
  items: z.array(itemSchema),
  taxRate: z.number().min(0).max(100),
  notes: z.string(),
  /** The PDF last saved to Drive, replaced on the next save. */
  driveFileId: z.string().nullable(),
});
const stateSchema = z.object({
  business: z.object({
    name: z.string(),
    email: z.string(),
    address: z.string(),
    currency: z.string().max(4),
  }),
  nextNumber: z.number().int().positive(),
  invoices: z.array(invoiceSchema),
});
type StoredInvoice = z.infer<typeof invoiceSchema>;

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (date: Date) =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const CURRENCIES = ["£", "$", "€", "₦", "₹", "R", "KSh", "GH₵"];
const STATUS_LABEL = { draft: "Draft", sent: "Sent", paid: "Paid" } as const;

/** Invoices and quotes for the business, saved to Drive as PDFs. */
export default function InvoicesApp() {
  const toast = useToast();
  const { value, update, loaded, save, retry } = useAppRecord("invoices", "state", stateSchema, {
    business: { name: "", email: "", address: "", currency: "£" },
    nextNumber: 1,
    invoices: [],
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const business: Business = value.business;
  const current = value.invoices.find((invoice) => invoice.id === selected) ?? null;
  const money = (amount: number) => formatMoney(amount, business.currency);

  function create(kind: StoredInvoice["kind"]) {
    const today = new Date();
    const due = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const invoice: StoredInvoice = {
      id: newId(),
      number: `${kind === "quote" ? "QUO" : "INV"}-${String(value.nextNumber).padStart(4, "0")}`,
      kind,
      status: "draft",
      date: iso(today),
      due: iso(due),
      client: { name: "", email: "", address: "" },
      items: [{ description: "", quantity: 1, price: 0 }],
      taxRate: 0,
      notes: kind === "quote" ? "" : "Thank you for your business.",
      driveFileId: null,
    };
    update((state) => ({
      ...state,
      nextNumber: state.nextNumber + 1,
      invoices: [invoice, ...state.invoices],
    }));
    setSelected(invoice.id);
  }

  function change(id: string, patch: (invoice: StoredInvoice) => StoredInvoice) {
    update((state) => ({
      ...state,
      invoices: state.invoices.map((invoice) => (invoice.id === id ? patch(invoice) : invoice)),
    }));
  }

  async function savePdf(invoice: StoredInvoice) {
    setSaving(true);
    const bytes = invoicePdf(invoice, business);
    const result = await saveToDrive({
      name: `${invoice.number}${invoice.client.name ? ` ${invoice.client.name}` : ""}.pdf`.replace(
        /[\\/:*?"<>|]/g,
        "-",
      ),
      content: bytes.slice().buffer,
      type: "application/pdf",
      folder: invoice.kind === "quote" ? "Quotes" : "Invoices",
      replaces: invoice.driveFileId,
    });
    setSaving(false);
    if (result.ok) {
      change(invoice.id, (stored) => ({ ...stored, driveFileId: result.data.id }));
      toast.add({
        type: "success",
        title: "PDF saved in Drive",
        description: `${invoice.kind === "quote" ? "Quotes" : "Invoices"}/${result.data.name}`,
      });
    } else {
      toast.add({
        type: "error",
        title: "Couldn’t save the PDF",
        description: result.error.message,
      });
    }
  }

  const input = (
    label: string,
    valueOf: string | number,
    onChange: (next: string) => void,
    extra: { type?: string; wide?: boolean; multiline?: boolean } = {},
  ) => (
    <label className={extra.wide ? "ap-field ap-span" : "ap-field"}>
      <span>{label}</span>
      {extra.multiline ? (
        <textarea
          className="ap-input"
          rows={3}
          value={valueOf}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : (
        <input
          className="ap-input"
          type={extra.type ?? "text"}
          value={valueOf}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </label>
  );

  return (
    <div className="ap-body">
      <div className="ap-split">
        <nav className="ap-side" aria-label="Invoices and quotes">
          <div className="flex gap-1.5 pb-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                create("invoice");
              }}
            >
              <Plus aria-hidden="true" />
              Invoice
            </Button>
            <Button
              size="sm"
              onClick={() => {
                create("quote");
              }}
            >
              <Plus aria-hidden="true" />
              Quote
            </Button>
          </div>
          <button
            type="button"
            className="ap-side-item"
            aria-current={selected === "business" ? "page" : undefined}
            onClick={() => {
              setSelected("business");
            }}
          >
            <Building2 aria-hidden="true" />
            {business.name || "Your business"}
          </button>
          {value.invoices.map((invoice) => (
            <button
              key={invoice.id}
              type="button"
              className="ap-side-item ap-side-invoice"
              aria-current={selected === invoice.id ? "page" : undefined}
              onClick={() => {
                setSelected(invoice.id);
              }}
            >
              <span>
                <b>{invoice.number}</b>
                <span>{invoice.client.name || "No client yet"}</span>
              </span>
              <span>
                <span>{money(totals(invoice).total)}</span>
                <span className="ap-pill" data-status={invoice.status}>
                  {STATUS_LABEL[invoice.status]}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div className="ap-main">
          {selected === "business" ? (
            <section aria-labelledby="invoice-business" className="ap-grid-form">
              <h2 id="invoice-business" className="ap-section-title ap-span">
                Your business
              </h2>
              <p className="ap-span text-footnote text-ink-secondary">
                Shown at the top of every invoice and quote.
              </p>
              {input(
                "Business name",
                business.name,
                (next) => {
                  update((state) => ({ ...state, business: { ...state.business, name: next } }));
                },
                { wide: true },
              )}
              {input(
                "Email",
                business.email,
                (next) => {
                  update((state) => ({ ...state, business: { ...state.business, email: next } }));
                },
                { type: "email" },
              )}
              <label className="ap-field">
                <span>Currency</span>
                <select
                  className="ap-input"
                  value={business.currency}
                  onChange={(event) => {
                    const next = event.target.value;
                    update((state) => ({
                      ...state,
                      business: { ...state.business, currency: next },
                    }));
                  }}
                >
                  {CURRENCIES.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </label>
              {input(
                "Address",
                business.address,
                (next) => {
                  update((state) => ({ ...state, business: { ...state.business, address: next } }));
                },
                { wide: true, multiline: true },
              )}
            </section>
          ) : current ? (
            <section aria-labelledby="invoice-title" className="ap-grid-form">
              <div className="ap-span ap-row">
                <h2 id="invoice-title" className="ap-section-title">
                  {current.kind === "quote" ? "Quote" : "Invoice"} {current.number}
                </h2>
                <span className="flex-1" />
                <label className="ap-field ap-inline">
                  <span>Status</span>
                  <select
                    className="ap-input"
                    value={current.status}
                    onChange={(event) => {
                      const status = event.target.value as StoredInvoice["status"];
                      change(current.id, (invoice) => ({ ...invoice, status }));
                    }}
                  >
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="paid">Paid</option>
                  </select>
                </label>
              </div>
              {input("Client", current.client.name, (next) => {
                change(current.id, (invoice) => ({
                  ...invoice,
                  client: { ...invoice.client, name: next },
                }));
              })}
              {input(
                "Client’s email",
                current.client.email,
                (next) => {
                  change(current.id, (invoice) => ({
                    ...invoice,
                    client: { ...invoice.client, email: next },
                  }));
                },
                { type: "email" },
              )}
              {input(
                "Client’s address",
                current.client.address,
                (next) => {
                  change(current.id, (invoice) => ({
                    ...invoice,
                    client: { ...invoice.client, address: next },
                  }));
                },
                { wide: true, multiline: true },
              )}
              {input(
                "Date",
                current.date,
                (next) => {
                  change(current.id, (invoice) => ({ ...invoice, date: next }));
                },
                { type: "date" },
              )}
              {input(
                current.kind === "quote" ? "Valid until" : "Due",
                current.due,
                (next) => {
                  change(current.id, (invoice) => ({ ...invoice, due: next }));
                },
                { type: "date" },
              )}

              <table className="ap-table ap-span">
                <thead>
                  <tr>
                    <th scope="col">Description</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Unit price ({business.currency})</th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.items.map((item, index) => {
                    const set = (patch: Partial<typeof item>) => {
                      change(current.id, (invoice) => ({
                        ...invoice,
                        items: invoice.items.map((candidate, at) =>
                          at === index ? { ...candidate, ...patch } : candidate,
                        ),
                      }));
                    };
                    return (
                      <tr key={index}>
                        <td>
                          <input
                            className="ap-input"
                            aria-label={`Item ${String(index + 1)} description`}
                            value={item.description}
                            onChange={(event) => {
                              set({ description: event.target.value });
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="ap-input ap-narrow"
                            aria-label={`Item ${String(index + 1)} quantity`}
                            type="number"
                            min={0}
                            step="any"
                            value={item.quantity}
                            onChange={(event) => {
                              set({ quantity: Math.max(0, Number(event.target.value) || 0) });
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="ap-input ap-narrow"
                            aria-label={`Item ${String(index + 1)} unit price`}
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.price}
                            onChange={(event) => {
                              set({ price: Math.max(0, Number(event.target.value) || 0) });
                            }}
                          />
                        </td>
                        <td className="text-right tabular-nums">
                          {money(item.quantity * item.price)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ap-icon-button"
                            aria-label={`Remove item ${String(index + 1)}`}
                            disabled={current.items.length === 1}
                            onClick={() => {
                              change(current.id, (invoice) => ({
                                ...invoice,
                                items: invoice.items.filter((_, at) => at !== index),
                              }));
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="ap-span ap-row">
                <Button
                  size="sm"
                  onClick={() => {
                    change(current.id, (invoice) => ({
                      ...invoice,
                      items: [...invoice.items, { description: "", quantity: 1, price: 0 }],
                    }));
                  }}
                >
                  <Plus aria-hidden="true" />
                  Add a line
                </Button>
                <span className="flex-1" />
                <label className="ap-field ap-inline">
                  <span>Tax %</span>
                  <input
                    className="ap-input ap-narrow"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={current.taxRate}
                    onChange={(event) => {
                      const taxRate = Math.min(100, Math.max(0, Number(event.target.value) || 0));
                      change(current.id, (invoice) => ({ ...invoice, taxRate }));
                    }}
                  />
                </label>
              </div>
              <dl className="ap-span ap-totals">
                <dt>Subtotal</dt>
                <dd>{money(totals(current).subtotal)}</dd>
                {current.taxRate > 0 && (
                  <>
                    <dt>Tax</dt>
                    <dd>{money(totals(current).tax)}</dd>
                  </>
                )}
                <dt>Total</dt>
                <dd>
                  <b>{money(totals(current).total)}</b>
                </dd>
              </dl>
              {input(
                "Notes",
                current.notes,
                (next) => {
                  change(current.id, (invoice) => ({ ...invoice, notes: next }));
                },
                { wide: true, multiline: true },
              )}
              <div className="ap-span ap-row">
                <Button variant="primary" loading={saving} onClick={() => void savePdf(current)}>
                  <FileDown aria-hidden="true" />
                  Save PDF to Drive
                </Button>
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  onClick={() => {
                    update((state) => ({
                      ...state,
                      invoices: state.invoices.filter((invoice) => invoice.id !== current.id),
                    }));
                    setSelected(null);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Delete {current.kind}
                </Button>
              </div>
            </section>
          ) : (
            loaded !== "loading" && (
              <div className="ap-empty">
                <p>
                  {value.invoices.length === 0
                    ? "Make your first invoice or quote. Add your business’s details first, so they appear at the top."
                    : "Choose an invoice or quote on the left."}
                </p>
              </div>
            )
          )}
        </div>
      </div>
      <RecordStatus save={save} loaded={loaded} onRetry={() => void retry()}>
        {String(
          value.invoices.filter(
            (invoice) => invoice.status !== "paid" && invoice.kind === "invoice",
          ).length,
        )}{" "}
        unpaid
      </RecordStatus>
    </div>
  );
}
