import type { Cell, QueryResult } from "./db";
import type { Model } from "./model";
import type { Plan } from "./nl/plan";

/** How a result column should be shown. */
export type ColumnFormat = "money" | "number" | "percent" | "days" | "date" | "period" | "text" | "integer";

const MONEY_NAMES = /^(revenue|total|amount|outstanding|overdue_amount|credit_limit|unit_price|unit_cost|price|cost|collected|expense_total|gross_profit|aov|line_total|line_revenue|subtotal|tax|total_amount|total_total|total_tax|total_subtotal|total_credit_limit|avg_.*(revenue|amount|total|price|cost|limit|profit)|total_.*(amount|price|cost|total|revenue)|.*_(amount|price|cost|revenue|total|balance))$/;
const PERIOD = /^(\d{4}(-\d{2}(-\d{2})?)?|\d{4}-Q[1-4])$/;

/** Picks a display format per column from its name, the model and the values. */
export function columnFormats(r: QueryResult, model: Model | null, plan: Plan | null): ColumnFormat[] {
  return r.columns.map((name, j) => {
    const vals = r.rows.map((row) => row[j]).filter((v) => v !== null);
    const n = name.toLowerCase();
    if (n === "share_pct" || n === "change_pct" || n.endsWith("_pct") || n === "margin_pct") return "percent";
    if (n === "days_to_pay") return "days";
    if (vals.length && vals.every((v) => typeof v === "string" && PERIOD.test(v))) return /^\d{4}-\d{2}-\d{2}$/.test(String(vals[0])) ? "date" : "period";
    if (vals.length && vals.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v))) return "date";
    if (!vals.length || vals.some((v) => typeof v !== "number")) return "text";
    const metric = model?.metrics.find((m) => m.id === n);
    if (metric) return metric.unit === "money" && model?.source === "demo" ? "money" : metric.unit === "percent" ? "percent" : metric.unit === "days" ? "days" : metric.unit === "count" ? "integer" : "number";
    const col = model?.tables.flatMap((t) => t.columns).find((c) => c.name === n || `total_${c.name}` === n || `avg_${c.name}` === n);
    if (col?.role === "money" && model?.source === "demo") return "money";
    if (model?.source === "demo" && MONEY_NAMES.test(n)) return "money";
    if (col?.role === "percent") return "percent";
    if (vals.every((v) => Number.isInteger(v))) return n === "id" || n.endsWith("_id") || n === "year" ? "text" : "integer";
    void plan;
    return "number";
  });
}

export function formatCell(v: Cell, f: ColumnFormat, locale = "en-US"): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Uint8Array) return `[${v.length} bytes]`;
  if (typeof v !== "number") return String(v);
  switch (f) {
    case "money":
      return v.toLocaleString(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "percent":
      return `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
    case "days":
      return `${v.toLocaleString(locale, { maximumFractionDigits: 1 })} ${locale.startsWith("tr") ? "gün" : "days"}`;
    case "integer":
      return v.toLocaleString(locale, { maximumFractionDigits: 0 });
    case "number":
      return v.toLocaleString(locale, { maximumFractionDigits: 2 });
    default:
      return String(v);
  }
}

const short = (v: number, f: ColumnFormat, locale: string) => {
  if (f === "money") return v.toLocaleString(locale, { style: "currency", currency: "USD", notation: Math.abs(v) >= 1e6 ? "compact" : "standard", maximumFractionDigits: Math.abs(v) >= 1e6 ? 2 : Math.abs(v) >= 1000 ? 0 : 2 });
  if (f === "percent") return `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  if (f === "days") return `${v.toLocaleString(locale, { maximumFractionDigits: 1 })} ${locale.startsWith("tr") ? "gün" : "days"}`;
  return v.toLocaleString(locale, { notation: Math.abs(v) >= 1e6 ? "compact" : "standard", maximumFractionDigits: 1 });
};

/** One sentence that answers the question from the result: "Willow Labs leads with $371K." */
export function answerSentence(r: QueryResult, formats: ColumnFormat[], plan: Plan | null, model: Model | null, lang: "en" | "tr"): string | null {
  const tr = lang === "tr";
  const locale = tr ? "tr-TR" : "en-US";
  if (!r.columns.length) return r.changes ? (tr ? `${r.changes} satır değişti.` : `${r.changes} row${r.changes === 1 ? "" : "s"} changed.`) : null;
  if (!r.rows.length) return tr ? "Bu koşullara uyan satır yok." : "No rows match.";
  const numIdx = formats.map((f, j) => (["money", "number", "integer", "percent", "days"].includes(f) && typeof r.rows[0][j] === "number" ? j : -1)).filter((j) => j >= 0);
  const label = (j: number) => {
    const n = r.columns[j];
    const m = model?.metrics.find((x) => x.id === n);
    if (m) return tr ? m.labelTr.toLocaleLowerCase("tr") : m.label.toLowerCase();
    const t = model?.tables.find((x) => x.plural.replace(/\s+/g, "_") === n);
    if (t) return tr ? `${t.labelTr} sayısı` : `number of ${t.plural}`;
    return n.replace(/_/g, " ");
  };
  // A single number.
  if (r.rows.length === 1 && r.columns.length === 1 && numIdx.length === 1) {
    const l = label(0);
    return `${l.charAt(0).toLocaleUpperCase(locale) + l.slice(1)}: ${short(r.rows[0][0] as number, formats[0], locale)}${plan?.filters.some((f) => f.kind === "date") ? ` (${plan.filters.filter((f) => f.kind === "date").map((f) => (f as { label: string }).label).join(", ")})` : ""}.`;
  }
  const first = formats.findIndex((f) => f === "text" || f === "period" || f === "date");
  const y = numIdx.find((j) => !["share_pct", "change_pct"].includes(r.columns[j]));
  if (first >= 0 && y !== undefined) {
    const isTime = formats[first] === "period" || (formats[first] === "date" && plan?.groups.some((g) => g.kind === "time"));
    if (isTime && r.rows.length > 2) {
      let peak = 0;
      r.rows.forEach((row, i) => {
        if ((row[y] as number) > (r.rows[peak][y] as number)) peak = i;
      });
      const last = r.rows[r.rows.length - 1];
      // The period that contains today is still filling up; say so instead of letting it read as a drop.
      const today = model?.today ?? "";
      const lastLabel = String(last[first]);
      const open = !!today && (today.startsWith(lastLabel) || (/^\d{4}-Q\d$/.test(lastLabel) && lastLabel === `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) + 2) / 3)}`));
      return tr
        ? `${r.rows.length} dönem. En yüksek: ${r.rows[peak][first]} (${short(r.rows[peak][y] as number, formats[y], locale)}). Son: ${last[first]}${open ? " (devam ediyor)" : ""} (${short(last[y] as number, formats[y], locale)}).`
        : `${r.rows.length} periods. Peak: ${r.rows[peak][first]} (${short(r.rows[peak][y] as number, formats[y], locale)}). Latest: ${last[first]}${open ? " so far" : ""} (${short(last[y] as number, formats[y], locale)}).`;
    }
    const sortedDesc = plan?.order?.dir !== "asc";
    const top = r.rows[0];
    if (r.rows.length === 1) return tr ? `${top[first]}: ${label(y)} ${short(top[y] as number, formats[y], locale)}.` : `${top[first]}, with ${label(y)} of ${short(top[y] as number, formats[y], locale)}.`;
    if (plan?.order?.by === "measure")
      return tr
        ? `${sortedDesc ? "En yüksek" : "En düşük"} ${label(y)}: ${top[first]} (${short(top[y] as number, formats[y], locale)}).`
        : `${top[first]} has the ${sortedDesc ? "highest" : "lowest"} ${label(y)}: ${short(top[y] as number, formats[y], locale)}.`;
    const total = r.rows.reduce((a, row) => a + (Number(row[y]) || 0), 0);
    if (formats[y] === "money" || formats[y] === "integer")
      return tr ? `${r.rows.length} grup, toplam ${label(y)} ${short(total, formats[y], locale)}.` : `${r.rows.length} groups, ${label(y)} adding up to ${short(total, formats[y], locale)}.`;
  }
  const t = plan && model?.tables.find((x) => x.name === plan.subject);
  const what = plan?.kind !== "aggregate" && t ? (tr ? `${t.labelTr} kaydı` : r.rows.length === 1 ? t.label : t.plural) : tr ? "satır" : r.rows.length === 1 ? "row" : "rows";
  return `${r.truncated ? (tr ? "İlk " : "First ") : ""}${r.rows.length.toLocaleString(locale)} ${what}.`;
}
