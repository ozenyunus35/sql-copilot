import type { QueryResult } from "./db";
import type { Dataset } from "./engine";
import { table as tableOf, type Model } from "./model";
import { parse } from "./nl/parse";
import type { Note, ParseResult, Plan } from "./nl/plan";
import { toSql } from "./nl/sql";
import { fold } from "./nl/text";
import { explainError, type Bi } from "./sql/explain";

/** One question (or SQL run) and its answer, as shown in the Ask thread and on the dashboard. */
export interface Answer {
  id: string;
  question?: string;
  sql: string;
  plan: Plan | null;
  notes: Note[];
  alternatives: ParseResult["alternatives"];
  ignored: string[];
  confidence: number;
  buildNotes: Bi[];
  res?: QueryResult;
  error?: Bi;
  at: string;
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function runSql(ds: Dataset, sql: string): Pick<Answer, "res" | "error"> {
  try {
    return { res: ds.db.run(sql) };
  } catch (e) {
    return { error: explainError((e as Error).message, ds.model) };
  }
}

/** Parses a question (as a follow-up to `base` when it reads like one), builds SQL and runs it. */
export function answerQuestion(ds: Dataset, model: Model, question: string, base?: { plan: Plan; question: string }, prefer?: Record<string, string>): Answer {
  const [text, override] = question.split("\u0000");
  const pref = override ? Object.fromEntries([override.split("=")]) : prefer;
  const r = parse(text, model, { base, prefer: pref });
  const common = { id: uid(), question: text, at: new Date().toISOString(), alternatives: r.alternatives, ignored: r.ignored, confidence: r.confidence };
  if (!r.ok || !r.plan) return { ...common, sql: "", plan: null, notes: [], buildNotes: [], error: r.reason ?? { en: "No answer.", tr: "Cevap yok." } };
  const built = toSql(model, r.plan);
  return { ...common, sql: built.sql, plan: r.plan, notes: r.plan.notes, buildNotes: built.notes, ...runSql(ds, built.sql) };
}

export function answerSql(ds: Dataset, sql: string): Answer {
  return { id: uid(), sql, plan: null, notes: [], alternatives: [], ignored: [], confidence: 1, buildNotes: [], at: new Date().toISOString(), ...runSql(ds, sql) };
}

/** Next questions worth one click, built from what the answer already has. */
export function followUps(a: Answer, model: Model, lang: "en" | "tr"): string[] {
  const p = a.plan;
  if (!p || p.kind !== "aggregate" || !a.res) return [];
  const tr = lang === "tr";
  const out: string[] = [];
  const hasTime = p.groups.some((g) => g.kind === "time" || g.kind === "period");
  const date = p.filters.find((f) => f.kind === "date");
  const m0 = p.measures[0];
  const measureTable = m0.kind === "metric" ? model.metrics.find((m) => m.id === m0.metric)?.table : m0.table;
  const hasDate = m0.kind === "metric" ? !!model.metrics.find((m) => m.id === m0.metric)?.date : !!tableOf(model, m0.table).dateColumn;
  if (!hasTime && hasDate) out.push(tr ? "aylık" : "by month");
  if (!date && hasDate) out.push(tr ? "bu yıl" : "this year");
  else if (date && !/last year|geçen yıl/i.test(date.kind === "date" ? date.label : "")) out.push(tr ? "peki geçen yıl?" : "what about last year?");
  const group = p.groups.find((g) => g.kind === "entity" || g.kind === "column");
  if (group && !p.limit && a.res.rows.length > 6) out.push(tr ? "ilk 5" : "top 5");
  if (group && a.res.rows.length > 1) {
    const first = a.res.rows[0][0];
    if (typeof first === "string" && first.length < 40 && group.kind === "column") out.push(tr ? `sadece ${first}` : `only ${first}`);
  }
  if (!p.groups.length && model.source === "demo" && measureTable && ["invoices", "invoice_lines", "customers"].includes(measureTable)) out.push(tr ? "segmente göre" : "by segment");
  if (!p.groups.length && model.source === "demo" && measureTable === "expenses") out.push(tr ? "gider türüne göre" : "by category");
  if (group && !p.share && a.res.rows.length > 1 && m0.kind !== "count") out.push(tr ? "toplamdaki payı" : "share of total");
  return [...new Set(out)].slice(0, 4);
}

// ---- Words taught by the user ----

export interface Word {
  phrase: string;
  /** "metric:revenue", "table:customers", "column:customers.segment", "value:customers.segment=Retail" */
  target: string;
}

/** A copy of the model that also knows the user's own words. */
export function withWords(model: Model, words: Word[]): Model {
  if (!words.length) return model;
  const m: Model = structuredClone(model);
  for (const w of words) {
    const phrase = fold(w.phrase).trim();
    if (!phrase) continue;
    const cut = w.target.indexOf(":");
    const kind = w.target.slice(0, cut);
    const rest = w.target.slice(cut + 1);
    if (kind === "metric") m.metrics.find((x) => x.id === rest)?.terms.push(phrase);
    else if (kind === "table") m.tables.find((x) => x.name === rest)?.terms.push(phrase);
    else if (kind === "column") {
      const [t, c] = rest.split(".");
      m.tables.find((x) => x.name === t)?.columns.find((x) => x.name === c)?.terms.push(phrase);
    } else if (kind === "value") {
      const eq = rest.indexOf("=");
      const tc = rest.slice(0, eq);
      const v = rest.slice(eq + 1);
      const [t, c] = tc.split(".");
      const col = m.tables.find((x) => x.name === t)?.columns.find((x) => x.name === c);
      if (col) {
        col.valueTerms ??= {};
        (col.valueTerms[v] ??= []).push(phrase);
      }
    }
  }
  return m;
}

/** Everything a word can be taught to mean, for the picker. */
export function wordTargets(model: Model, lang: "en" | "tr"): Array<{ target: string; label: string; group: string }> {
  const tr = lang === "tr";
  const out: Array<{ target: string; label: string; group: string }> = [];
  for (const m of model.metrics) out.push({ target: `metric:${m.id}`, label: tr ? m.labelTr : m.label, group: tr ? "Ölçüler" : "Measures" });
  for (const t of model.tables) out.push({ target: `table:${t.name}`, label: t.name, group: tr ? "Tablolar" : "Tables" });
  for (const t of model.tables)
    for (const c of t.columns) if (!["id"].includes(c.role)) out.push({ target: `column:${t.name}.${c.name}`, label: `${t.name}.${c.name}`, group: tr ? "Sütunlar" : "Columns" });
  for (const t of model.tables)
    for (const c of t.columns)
      if (c.role === "category" && c.values && c.values.length <= 40) for (const v of c.values) out.push({ target: `value:${t.name}.${c.name}=${v}`, label: `${c.name} = ${v}`, group: tr ? "Değerler" : "Values" });
  return out;
}

// ---- Dashboard ----

export interface Pin {
  id: string;
  title: string;
  question?: string;
  sql: string;
  chart: "auto" | "bar" | "hbar" | "line" | "area" | "pie" | "kpi" | "table";
  width: 1 | 2;
}

/** The demo's starting dashboard: the numbers a finance lead looks at first. */
export function defaultPins(model: Model, lang: "en" | "tr"): Pin[] {
  if (model.source !== "demo") return [];
  const tr = lang === "tr";
  const q = (question: string): string => {
    const r = parse(question, model);
    return r.ok && r.plan ? toSql(model, r.plan).sql : "";
  };
  const mk = (title: string, question: string, chart: Pin["chart"], width: Pin["width"] = 1): Pin => ({ id: uid(), title, question, sql: q(question), chart, width });
  return [
    mk(tr ? "Bu yıl ciro" : "Revenue this year", "revenue this year", "kpi"),
    mk(tr ? "Açık bakiye" : "Outstanding", "total outstanding balance", "kpi"),
    mk(tr ? "Vadesi geçmiş tutar" : "Overdue", "overdue amount", "kpi"),
    mk(tr ? "Ortalama ödeme süresi" : "Average days to pay", "average days to pay", "kpi"),
    mk(tr ? "Aylık ciro, son 12 ay" : "Monthly revenue, last 12 months", "monthly revenue last 12 months", "area", 2),
    mk(tr ? "Segmente göre ciro" : "Revenue by segment", "revenue by segment this year", "pie"),
    mk(tr ? "Geçen çeyreğin en büyük müşterileri" : "Top customers last quarter", "top 5 customers by revenue last quarter", "hbar"),
    mk(tr ? "Bu yıl giderler" : "Expenses this year", "expenses by category this year", "hbar"),
    mk(tr ? "Kategoriye göre brüt marj" : "Gross margin by category", "gross margin by category this year", "bar"),
  ];
}

// ---- Storage ----

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}
/** Thread items without their rows: results are re-run on load. */
export const slim = (a: Answer): Answer => ({ ...a, res: undefined });
export { uid };
