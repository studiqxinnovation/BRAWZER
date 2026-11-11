import { formatMoney, sum } from "./money-format";
import { A4, makePdf, type PdfPage, textWidth, wrap } from "./pdf";

export interface InvoiceItem {
  description: string;
  quantity: number;
  price: number;
}

export interface Invoice {
  number: string;
  kind: "invoice" | "quote";
  date: string;
  due: string;
  client: { name: string; email: string; address: string };
  items: InvoiceItem[];
  taxRate: number;
  notes: string;
}

export interface Business {
  name: string;
  email: string;
  address: string;
  currency: string;
}

export function totals(invoice: Pick<Invoice, "items" | "taxRate">) {
  const subtotal = sum(invoice.items.map((item) => item.quantity * item.price));
  const tax = Math.round(subtotal * invoice.taxRate) / 100;
  return { subtotal, tax, total: sum([subtotal, tax]) };
}

const longDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/** The invoice (or quote) as an A4 PDF, laid out as a business would send it. */
export function invoicePdf(invoice: Invoice, business: Business): Uint8Array {
  const pages: PdfPage[] = [];
  const margin = 50;
  const right = A4.width - margin;
  let page: PdfPage = { texts: [], lines: [], boxes: [] };
  let y = A4.height - margin;
  const money = (amount: number) => formatMoney(amount, business.currency);
  const text = (
    x: number,
    size: number,
    value: string,
    options: { bold?: boolean; grey?: boolean; alignRight?: boolean } = {},
  ) => {
    page.texts.push({
      x: options.alignRight ? x - textWidth(value, size, options.bold) : x,
      y,
      size,
      text: value,
      bold: options.bold,
      colour: options.grey ? [107, 114, 128] : undefined,
    });
  };
  const newPage = () => {
    pages.push(page);
    page = { texts: [], lines: [], boxes: [] };
    y = A4.height - margin;
  };

  // Heading: who it's from, and what it is.
  text(margin, 20, business.name || "Your business", { bold: true });
  text(right, 20, invoice.kind === "quote" ? "QUOTE" : "INVOICE", { bold: true, alignRight: true });
  y -= 18;
  for (const line of [...wrap(business.address, 9, 250), business.email].filter(Boolean)) {
    text(margin, 9, line, { grey: true });
    y -= 12;
  }
  y = Math.min(y, A4.height - margin - 60);
  const detailsTop = A4.height - margin - 22;
  [
    ["Number", invoice.number],
    ["Date", longDate(invoice.date)],
    [invoice.kind === "quote" ? "Valid until" : "Due", longDate(invoice.due)],
  ].forEach(([label = "", value = ""], index) => {
    const lineY = detailsTop - index * 13;
    page.texts.push({ x: right - 150, y: lineY, size: 9, text: label, colour: [107, 114, 128] });
    page.texts.push({
      x: right - textWidth(value, 9, true),
      y: lineY,
      size: 9,
      text: value,
      bold: true,
    });
  });

  y -= 24;
  text(margin, 9, invoice.kind === "quote" ? "Quote for" : "Bill to", { grey: true });
  y -= 14;
  text(margin, 11, invoice.client.name || "—", { bold: true });
  y -= 13;
  for (const line of [...wrap(invoice.client.address, 9, 260), invoice.client.email].filter(
    Boolean,
  )) {
    text(margin, 9, line);
    y -= 12;
  }

  // The items.
  y -= 18;
  const columns = { quantity: right - 190, price: right - 95, amount: right };
  const header = () => {
    page.boxes.push({
      x: margin,
      y: y - 6,
      width: right - margin,
      height: 20,
      fill: [243, 244, 246],
    });
    text(margin + 8, 9, "Description", { bold: true });
    text(columns.quantity, 9, "Qty", { bold: true, alignRight: true });
    text(columns.price, 9, "Unit price", { bold: true, alignRight: true });
    text(columns.amount - 8, 9, "Amount", { bold: true, alignRight: true });
    y -= 24;
  };
  header();
  for (const item of invoice.items) {
    const lines = wrap(item.description || "—", 9.5, columns.quantity - margin - 70);
    if (y - lines.length * 12 < margin + 120) {
      newPage();
      header();
    }
    text(columns.quantity, 9.5, String(item.quantity), { alignRight: true });
    text(columns.price, 9.5, money(item.price), { alignRight: true });
    text(columns.amount - 8, 9.5, money(item.quantity * item.price), { alignRight: true });
    for (const line of lines) {
      text(margin + 8, 9.5, line);
      y -= 12;
    }
    y -= 4;
    page.lines.push({ x1: margin, y1: y + 8, x2: right, y2: y + 8 });
  }

  // Totals.
  const { subtotal, tax, total } = totals(invoice);
  y -= 10;
  const totalLine = (label: string, value: string, bold = false) => {
    text(columns.price, bold ? 11 : 9.5, label, { bold, alignRight: true });
    text(columns.amount - 8, bold ? 11 : 9.5, value, { bold, alignRight: true });
    y -= bold ? 18 : 14;
  };
  totalLine("Subtotal", money(subtotal));
  if (invoice.taxRate > 0) totalLine(`Tax (${String(invoice.taxRate)}%)`, money(tax));
  page.lines.push({
    x1: columns.quantity,
    y1: y + 10,
    x2: right,
    y2: y + 10,
    width: 1,
    colour: [17, 24, 39],
  });
  y -= 4;
  totalLine(invoice.kind === "quote" ? "Total" : "Total due", money(total), true);

  if (invoice.notes.trim()) {
    y -= 16;
    text(margin, 9, "Notes", { bold: true });
    y -= 13;
    for (const line of wrap(invoice.notes, 9, right - margin)) {
      if (y < margin) newPage();
      text(margin, 9, line, { grey: true });
      y -= 12;
    }
  }
  pages.push(page);
  return makePdf(pages, `${invoice.kind === "quote" ? "Quote" : "Invoice"} ${invoice.number}`);
}
