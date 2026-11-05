import type { Db, QueryResult } from "./db";
import type { Model } from "./model";
import type { Filter, Plan } from "./nl/plan";
import { toSql } from "./nl/sql";
import { formatCell, type ColumnFormat } from "./present";

/**
 * Short observations computed from a result, the way an analyst would read it: who dominates,
 * how big the gap is, how the series moved, and how a period compares with the one before it.
 * Pure arithmetic on the rows; nothing is guessed.
 */

export interface Insight {
  tone: "up" | "down" | "neutral";
  en: string;
  tr: string;
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
/** Turkish writes the percent sign first and a decimal comma: +%28,6 */
const pctTr = (x: number) => `${x >= 0 ? "+" : "-"}%${Math.abs(x * 100).toFixed(1).replace(".", ",")}`;

function shortNum(v: number, f: ColumnFormat, lang: "en" | "tr") {
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  if (f === "money") return v.toLocaleString(locale, { style: "currency", currency: "USD", notation: Math.abs(v) >= 1e6 ? "compact" : "standard", maximumFractionDigits: Math.abs(v) >= 1e6 ? 2 : 0 });
  return formatCell(v, f, locale);
}

export function insights(r: QueryResult, formats: ColumnFormat[], plan: Plan | null, model: Model | null): Insight[] {
  const out: Insight[] = [];
  if (r.rows.length < 2) return out;
  const x = formats.findIndex((f) => f === "text" || f === "period" || f === "date");
  const y = formats.findIndex((f, j) => j !== x && ["money", "number", "integer", "days"].includes(f) && !["share_pct", "change_pct"].includes(r.columns[j]));
  if (x < 0 || y < 0) return out;
  const vals = r.rows.map((row) => Number(row[y]) || 0);
  const labels = r.rows.map((row) => String(row[x] ?? "—"));
  const f = formats[y];
  const additive = ["money", "integer"].includes(f) && !r.columns[y].startsWith("avg") && !["aov", "days_to_pay", "margin_pct"].includes(r.columns[y]);
  const time = formats[x] === "period" || (formats[x] === "date" && !!plan?.groups.some((g) => g.kind === "time"));

  if (time && r.rows.length >= 3) {
    // Leave out a period that is still running (it contains today).
    const today = model?.today ?? "";
    let n = vals.length;
    const last = labels[n - 1];
    const running = !!today && (today.startsWith(last) || (/^\d{4}-Q\d$/.test(last) && last === `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) + 2) / 3)}`));
    if (running) n--;
    if (n >= 2) {
      const a = vals[n - 2];
      const b = vals[n - 1];
      if (a) {
        const ch = (b - a) / Math.abs(a);
        out.push({ tone: ch > 0.005 ? "up" : ch < -0.005 ? "down" : "neutral", en: `${labels[n - 1]} vs ${labels[n - 2]}: ${pct(ch)} (${shortNum(b, f, "en")})${running ? `, leaving out ${last}, which is still running` : ""}.`, tr: `${labels[n - 1]} / ${labels[n - 2]}: ${pctTr(ch)} (${shortNum(b, f, "tr")})${running ? `; devam eden ${last} hariç` : ""}.` });
      }
      if (n >= 4 && vals[0]) {
        const ch = (vals[n - 1] - vals[0]) / Math.abs(vals[0]);
        out.push({ tone: ch > 0 ? "up" : ch < 0 ? "down" : "neutral", en: `${pct(ch)} from ${labels[0]} to ${labels[n - 1]}.`, tr: `${labels[0]} ile ${labels[n - 1]} arasında ${pctTr(ch)}.` });
      }
      const slice = vals.slice(0, n);
      const lo = slice.indexOf(Math.min(...slice));
      const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
      out.push({ tone: "neutral", en: `Average ${shortNum(avg, f, "en")} per period; lowest ${labels[lo]} (${shortNum(slice[lo], f, "en")}).`, tr: `Dönem başına ortalama ${shortNum(avg, f, "tr")}; en düşük ${labels[lo]} (${shortNum(slice[lo], f, "tr")}).` });
    }
    return out.slice(0, 3);
  }

  // Categories or entities.
  const total = vals.reduce((s, v) => s + v, 0);
  const order = vals.map((v, i) => [v, i] as const).sort((p, q) => q[0] - p[0]);
  const [top, second] = order;
  const limited = plan?.limit != null && plan.limit <= r.rows.length;
  if (additive && total > 0 && !limited && top[0] > 0) {
    out.push({ tone: "neutral", en: `${labels[top[1]]} is ${((top[0] / total) * 100).toFixed(1)}% of the total (${shortNum(total, f, "en")}).`, tr: `${labels[top[1]]}, toplamın %${((top[0] / total) * 100).toFixed(1)} kadarı (${shortNum(total, f, "tr")}).` });
    if (r.rows.length >= 6) {
      const top3 = order.slice(0, 3).reduce((s, p) => s + p[0], 0);
      out.push({ tone: "neutral", en: `The top 3 make up ${((top3 / total) * 100).toFixed(0)}% across ${r.rows.length} groups.`, tr: `İlk 3, ${r.rows.length} grubun %${((top3 / total) * 100).toFixed(0)} kadarını oluşturuyor.` });
    }
  }
  if (second && second[0] > 0 && top[0] / second[0] >= 1.15) {
    const k = top[0] / second[0];
    out.push({ tone: "up", en: `${labels[top[1]]} is ${k.toFixed(1)}× ${labels[second[1]]}, the next one.`, tr: `${labels[top[1]]}, ikinci sıradaki ${labels[second[1]]} değerinin ${k.toFixed(1).replace(".", ",")} katı.` });
  } else if (second) {
    out.push({ tone: "neutral", en: `${labels[top[1]]} and ${labels[second[1]]} are close: ${shortNum(top[0], f, "en")} vs ${shortNum(second[0], f, "en")}.`, tr: `${labels[top[1]]} ile ${labels[second[1]]} yakın: ${shortNum(top[0], f, "tr")} ve ${shortNum(second[0], f, "tr")}.` });
  }
  const low = order[order.length - 1];
  if (r.rows.length >= 4 && !limited) out.push({ tone: "down", en: `Lowest: ${labels[low[1]]} (${shortNum(low[0], f, "en")}).`, tr: `En düşük: ${labels[low[1]]} (${shortNum(low[0], f, "tr")}).` });
  return out.slice(0, 3);
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * For a single number over a date range ("revenue last quarter"), the same number over the
 * period just before it, so the answer can say "+8% vs the previous quarter".
 */
export function previousPeriod(plan: Plan | null, model: Model, db: Db, current: number): Insight | null {
  if (!plan || plan.kind !== "aggregate" || plan.groups.length || plan.measures.length !== 1 || plan.countGroups || plan.averageGroups) return null;
  const d = plan.filters.find((f): f is Extract<Filter, { kind: "date" }> => f.kind === "date");
  if (!d?.from || !d.to) return null;
  const from = Date.parse(d.from);
  const to = Date.parse(d.to);
  const days = Math.round((to - from) / DAY) + 1;
  // Calendar months, quarters and years compare with the same calendar unit before them.
  const f0 = new Date(from);
  const t0 = new Date(to + DAY);
  const months = (t0.getUTCFullYear() - f0.getUTCFullYear()) * 12 + (t0.getUTCMonth() - f0.getUTCMonth());
  const whole = f0.getUTCDate() === 1 && t0.getUTCDate() === 1 && months > 0;
  // A period that runs to today (this year, this quarter, this month so far) compares with the
  // same days of the period before: year to date against the same dates last year.
  const toDate = !whole && d.to === model.today && f0.getUTCDate() === 1;
  const unit = toDate ? (f0.getUTCMonth() === 0 ? 12 : f0.getUTCMonth() % 3 === 0 ? 3 : 1) : 0;
  const shiftM = (t: number, m: number) => {
    const x = new Date(t);
    return Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - m, Math.min(x.getUTCDate(), new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - m + 1, 0)).getUTCDate()));
  };
  const pf = whole ? Date.UTC(f0.getUTCFullYear(), f0.getUTCMonth() - months, 1) : toDate ? shiftM(from, unit) : from - days * DAY;
  const pt = whole ? from - DAY : toDate ? shiftM(to, unit) : from - DAY;
  const prev = structuredClone(plan);
  const pd = prev.filters.find((f): f is Extract<Filter, { kind: "date" }> => f.kind === "date")!;
  pd.from = iso(pf);
  pd.to = iso(pt);
  try {
    const v = Number(db.run(toSql(model, prev).sql, 2).rows[0]?.[0]);
    if (!Number.isFinite(v) || v === 0) return null;
    const ch = (current - v) / Math.abs(v);
    const span = `${pd.from} → ${pd.to}`;
    const what = toDate ? (unit === 12 ? ["the same dates last year", "geçen yılın aynı dönemine göre"] : unit === 3 ? ["the same days last quarter", "önceki çeyreğin aynı günlerine göre"] : ["the same days last month", "geçen ayın aynı günlerine göre"]) : ["the period before", "önceki döneme göre"];
    return { tone: ch > 0.005 ? "up" : ch < -0.005 ? "down" : "neutral", en: `${pct(ch)} vs ${what[0]} (${span}: ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}).`, tr: `${what[1][0].toLocaleUpperCase("tr")}${what[1].slice(1)} ${pctTr(ch)} (${span}: ${v.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}).` };
  } catch {
    return null;
  }
}
