/** £1,250.50 */
export function formatMoney(amount: number, currency: string): string {
  const sign = amount < 0 ? "−" : "";
  return `${sign}${currency}${Math.abs(amount).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Pennies, so sums don't drift: 0.1 + 0.2 is 0.3. */
export const sum = (amounts: readonly number[]) =>
  amounts.reduce((total, amount) => total + Math.round(amount * 100), 0) / 100;

/** A CSV cell: quoted when it needs to be, and never read as a formula by a spreadsheet. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
