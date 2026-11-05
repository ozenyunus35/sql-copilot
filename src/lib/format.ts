/** Formatting helpers shared by the UI. */

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const formatNumber = (n: number) => (Number.isInteger(n) ? nf0.format(n) : nf.format(n));
export const formatMoney = (n: number) => money.format(n);
export const formatCompact = (n: number) => compact.format(n);

export function plural(n: number, one: string, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
