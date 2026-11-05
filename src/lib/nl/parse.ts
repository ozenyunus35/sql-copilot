import { table as tableOf, type ColumnModel, type MetricModel, type Model } from "../model";
import { findDateRanges, type DateRange } from "./dates";
import { buildLexicon, typoMatch, wordMatches, type Agg, type Grain, type Lexicon, type Op, type Sense } from "./lexicon";
import type { Filter, Group, Having, Measure, Note, ParseResult, Plan } from "./plan";
import { detectLanguage, fold, numberWord, tokenize, type Token } from "./text";

/** A run of tokens and what it can mean. */
interface Span {
  start: number;
  end: number;
  senses: Sense[];
  quality: "exact" | "inflected" | "typo";
  text: string;
}

const lexicons = new WeakMap<Model, Lexicon>();
export const lexiconFor = (m: Model) => {
  let l = lexicons.get(m);
  if (!l) lexicons.set(m, (l = buildLexicon(m)));
  return l;
};

const NUMERIC_ROLES = new Set(["money", "quantity", "percent", "number"]);
const isNumeric = (c: ColumnModel) => NUMERIC_ROLES.has(c.role) || (c.type !== "text" && c.type !== "date" && !["id", "fk", "flag", "category", "code"].includes(c.role));

/** Finds the phrase spans in the tokens, longest match first. */
function tag(ts: Token[], lex: Lexicon, skip: Set<number>): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < ts.length) {
    if (skip.has(i) || ts[i].kind !== "word") {
      i++;
      continue;
    }
    let best: { len: number; quality: Span["quality"]; senses: Sense[] } | null = null;
    const rank = { exact: 3, inflected: 2, typo: 1 } as const;
    for (const e of lex.entries) {
      const n = e.words.length;
      if (best && n < best.len) continue;
      if (i + n > ts.length) continue;
      let quality: Span["quality"] = "exact";
      let ok = true;
      for (let k = 0; k < n; k++) {
        const tok = ts[i + k];
        if (skip.has(i + k) || (tok.kind !== "word" && tok.kind !== "symbol")) {
          ok = false;
          break;
        }
        const m = wordMatches(e.words[k], tok, k === n - 1, e.lang);
        if (m === "exact") continue;
        if (m === "inflected") {
          quality = quality === "typo" ? "typo" : "inflected";
          continue;
        }
        // A typo is allowed on longer data words, never on question words like "not" or "top".
        const questionWord = ["neg", "cmp", "group", "top", "bottom", "count", "without", "which", "who", "write"].includes(e.sense.k);
        // Typos are allowed on data words, and on longer question words like "bazında".
        if (e.sense.k !== "stop" && (!questionWord || (e.words[k].length >= 6 && e.sense.k !== "neg" && e.sense.k !== "write")) && typoMatch(e.words[k], tok.t)) {
          quality = "typo";
          continue;
        }
        ok = false;
        break;
      }
      if (!ok) continue;
      if (!best || n > best.len || (n === best.len && rank[quality] > rank[best.quality])) best = { len: n, quality, senses: [e.sense] };
      else if (n === best.len && quality === best.quality && !best.senses.some((s) => JSON.stringify(s) === JSON.stringify(e.sense))) best.senses.push(e.sense);
    }
    if (best) {
      spans.push({ start: i, end: i + best.len, senses: best.senses, quality: best.quality, text: ts.slice(i, i + best.len).map((t) => t.raw).join(" ") });
      i += best.len;
    } else i++;
  }
  return spans;
}

/**
 * Partial names: "coffee beans" for "Coffee beans, 6 kg", "Silverline" for the Silverline
 * companies. Two or more words that start a name, or one long word that no dictionary word covers.
 */
function nameSpans(ts: Token[], model: Model, skip: Set<number>): Span[] {
  const names: Array<{ table: string; column: string; value: string; words: string[] }> = [];
  for (const t of model.tables)
    for (const c of t.columns)
      if ((c.role === "name" || (c.role === "category" && (c.distinct ?? 0) > 12)) && c.values)
        for (const v of c.values) names.push({ table: t.name, column: c.name, value: v, words: fold(v).replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter(Boolean) });
  const out: Span[] = [];
  for (let i = 0; i < ts.length; i++) {
    for (let n = Math.min(4, ts.length - i); n >= 1; n--) {
      const win = ts.slice(i, i + n);
      if (win.some((t, k) => skip.has(i + k) || t.kind !== "word")) continue;
      const words = win.map((t) => t.t);
      if (n === 1 && (words[0].length < 5 || COMMON.has(words[0]))) continue;
      const hits = names.filter((x) => x.words.length > n && words.every((w, k) => x.words[k] === w));
      if (!hits.length) continue;
      const cols = new Set(hits.map((h) => `${h.table}.${h.column}`));
      if (cols.size !== 1) continue;
      const h = hits[0];
      out.push({ start: i, end: i + n, senses: [{ k: "value", table: h.table, column: h.column, values: hits.map((x) => x.value) }], quality: "exact", text: win.map((t) => t.raw).join(" ") });
      i += n - 1;
      break;
    }
  }
  return out;
}
// Words too common to stand for a name on their own.
const COMMON = new Set(["harbor", "summit", "market", "trading", "partners", "consulting", "hotel", "school", "college", "clinic", "dental", "group", "labs", "kitchen", "goods", "office", "paper", "boxes", "chair", "table"]);

/** Name spans win over shorter dictionary spans they overlap. */
function mergeNames(spans: Span[], names: Span[]): Span[] {
  const keep = spans.filter((s) => !names.some((n) => n.start < s.end && s.start < n.end && n.end - n.start > s.end - s.start));
  const add = names.filter((n) => !keep.some((s) => n.start < s.end && s.start < n.end));
  return [...keep, ...add].sort((a, b) => a.start - b.start);
}

const has = (s: Span, k: Sense["k"]) => s.senses.some((x) => x.k === k);
const get = <K extends Sense["k"]>(s: Span, k: K) => s.senses.find((x) => x.k === k) as Extract<Sense, { k: K }> | undefined;
const all = <K extends Sense["k"]>(s: Span, k: K) => s.senses.filter((x) => x.k === k) as Array<Extract<Sense, { k: K }>>;

interface Num {
  idx: number;
  n: number;
  amount: boolean;
  used: boolean;
}

const AMOUNT_BEFORE = new Set(["over", "above", "under", "below", "exceeding", "than", "least", "most", "upwards", "beyond", "$", "€", "£"]);
const TR_CMP_AFTER = /^(fazla|uzeri|uzerinde|ustu|ustunde|buyuk|yuksek|az|alti|altinda|kucuk|dusuk|asagi|asan|gecen|cok)/;
const CURRENCY = /^(dollar|dollars|usd|bucks|eur|euro|euros|dolar|dolarlik|lira|tl|try|bin|milyon|thousand|million|k)$/;

export interface ParseOptions {
  /** The previous question and its plan, for follow-ups like "now by month" or "peki Almanya?". */
  base?: { plan: Plan; question: string };
  /** Pick a different reading for a phrase: { "sales": "metric:units" }. */
  prefer?: Record<string, string>;
}

const senseKey = (s: Sense) => (s.k === "metric" ? `metric:${s.metric}` : s.k === "table" ? `table:${s.table}` : s.k === "column" ? `column:${s.table}.${s.column}` : s.k === "value" ? `value:${s.table}.${s.column}` : s.k);

/** Turns a question into a query plan. */
export function parse(question: string, model: Model, opts: ParseOptions = {}): ParseResult {
  const lex = lexiconFor(model);
  const lang = detectLanguage(question);
  const ts = tokenize(question);
  const notes: Note[] = [];
  const fail = (en: string, tr: string, ignored: string[] = []): ParseResult => ({ ok: false, reason: { en, tr }, ignored, confidence: 0, alternatives: [] });
  if (!ts.length) return fail("Type a question about the data.", "Veriyle ilgili bir soru yazın.");

  // Numbers that are money or counts, not years: "over 2000", "2000 dollars", "2.000'den fazla".
  const amountIdx = new Set<number>();
  ts.forEach((t, i) => {
    if (t.kind !== "number") return;
    const prev = ts[i - 1]?.t ?? "";
    const next = ts[i + 1]?.t ?? "";
    if (/[$€£₺%]|[.,]\d{3}|[kmb]$/i.test(t.raw) || AMOUNT_BEFORE.has(prev) || CURRENCY.test(next) || (t.suffix || TR_CMP_AFTER.test(next)) && TR_CMP_AFTER.test(next) || /^(den|dan|ten|tan)$/.test(t.suffix) && TR_CMP_AFTER.test(next)) amountIdx.add(i);
    if (t.raw.includes("'") || /^(den|dan|ten|tan)$/.test(t.suffix ?? "")) if (TR_CMP_AFTER.test(next)) amountIdx.add(i);
  });
  // A number glued to a Turkish suffix comes through as a word: "5000'den" -> number + suffix.
  ts.forEach((t, i) => {
    if (t.kind === "word" && /^\d/.test(t.t)) {
      const m = /^(\d[\d.,]*)(k|m)?$/.exec(t.t);
      if (m) {
        ts[i] = { ...t, kind: "number", n: Number(m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1) };
        if (TR_CMP_AFTER.test(ts[i + 1]?.t ?? "")) amountIdx.add(i);
      }
    }
  });
  // "between 1000 and 5000": both amounts if either cannot be a year.
  ts.forEach((t, i) => {
    if (t.kind === "number" && ["and", "ile", "ve", "-", "to"].includes(ts[i + 1]?.t ?? "") && ts[i + 2]?.kind === "number") {
      const a = t.n!, b = ts[i + 2].n!;
      const year = (x: number) => Number.isInteger(x) && x >= 1990 && x <= 2100;
      if (!year(a) || !year(b) || amountIdx.has(i) || amountIdx.has(i + 2)) {
        amountIdx.add(i);
        amountIdx.add(i + 2);
      }
    }
  });
  const forDates = ts.map((t, i) => (amountIdx.has(i) ? { ...t, kind: "symbol" as const, t: "#" } : t));
  const ranges: DateRange[] = findDateRanges(forDates, model.today);
  const skip = new Set<number>();
  for (const r of ranges) for (let k = r.start; k < r.end; k++) skip.add(k);

  const spans = mergeNames(tag(ts, lex, skip), nameSpans(ts, model, skip));
  const spanAt = (i: number) => spans.find((s) => s.start <= i && i < s.end);

  // Numbers, with scale words: "5 bin" = 5000, "2 million".
  const nums: Num[] = [];
  ts.forEach((t, i) => {
    if (skip.has(i)) return;
    let n: number | null = t.kind === "number" ? t.n! : null;
    if (n === null && t.kind === "word") {
      const w = numberWord(t.t);
      // Number words count only next to something they can count: "top five", "son on gün".
      const sp = spanAt(i);
      if (w !== null && !sp) n = w;
    }
    if (n === null) return;
    const next = spanAt(i + 1);
    const scale = next && get(next, "scale");
    if (scale) {
      n *= scale.n;
      amountIdx.add(i);
    }
    nums.push({ idx: i, n, amount: amountIdx.has(i), used: false });
  });

  // ---- Resolve what each span means, using what else is in the question ----
  const tablesMentioned = new Set<string>();
  const explicitTables = new Set<string>();
  for (const s of spans) if (s.senses.length === 1 && s.senses[0].k === "table") explicitTables.add(s.senses[0].table);
  // Context: tables a phrase can only be about ("expenses", "revenue", "Germany").
  for (const s of spans) {
    if (s.senses.some((x) => !["table", "column", "value", "metric"].includes(x.k))) continue;
    const ts2 = new Set<string>();
    for (const x of s.senses) {
      if (x.k === "table" || x.k === "column" || x.k === "value") ts2.add(x.table);
      else if (x.k === "metric") ts2.add(model.metrics.find((m) => m.id === x.metric)!.table);
    }
    if (ts2.size === 1) tablesMentioned.add([...ts2][0]);
  }
  const prefer = opts.prefer ?? {};
  const chosen = new Map<Span, Sense>();
  const alternatives: ParseResult["alternatives"] = [];
  const near = (s: Span, k: Sense["k"], dist = 2) => spans.some((o) => o !== s && has(o, k) && Math.min(Math.abs(o.start - s.end), Math.abs(s.start - o.end)) <= dist);
  const valueColumnsMentioned = new Set<string>();
  for (const s of spans) for (const c of all(s, "column")) valueColumnsMentioned.add(`${c.table}.${c.column}`);

  const customerContext = () => tablesMentioned.has("customers") || spans.some((s) => s.senses.some((x) => x.k === "value" && x.table === "customers")) || question.match(/\b(who|kim|hangi müşteri|which customer|customer)/i) !== null;

  // Values resolve last, so they can lean on the tables the rest of the question settled on.
  const valueOnly = (s: Span) => s.senses.every((x) => x.k === "value");
  const implied = new Map<Span, Extract<Sense, { k: "value" }>>();
  for (const s of [...spans.filter((x) => !valueOnly(x)), ...spans.filter(valueOnly)]) {
    resolve(s);
    const c = chosen.get(s);
    if (c && (c.k === "table" || c.k === "column")) tablesMentioned.add(c.table);
    else if (c && c.k === "metric") tablesMentioned.add(model.metrics.find((m) => m.id === c.metric)!.table);
  }
  function resolve(s: Span) {
    const keys = s.senses.map(senseKey);
    const forced = prefer[s.text.toLowerCase()];
    if (forced) {
      const f = s.senses.find((x) => senseKey(x) === forced);
      if (f) {
        chosen.set(s, f);
        return;
      }
    }
    if (s.senses.length === 1) {
      chosen.set(s, s.senses[0]);
      return;
    }
    const data = s.senses.filter((x) => ["table", "column", "metric", "value"].includes(x.k));
    // A data meaning beats a question word ("most" can be top or a stop word; "last" can be latest).
    let pick: Sense | undefined;
    const metrics = all(s, "metric");
    const values = all(s, "value");
    const columns = all(s, "column");
    const tables = all(s, "table");
    const nextSpan = spans.find((o) => o.start === s.end);
    if (has(s, "agg") && (columns.length || tables.length) && nextSpan && nextSpan.senses.some((x) => x.k === "column" || x.k === "metric")) {
      // "total tax", "average discount": the aggregate, not the column called "total".
      pick = get(s, "agg");
    } else if (tables.length === 1 && values.some((v) => v.table === tables[0].table) && !metrics.length) {
      // "sales reps", "satış temsilcileri": employees whose role is Sales rep.
      pick = tables[0];
      implied.set(s, values.find((v) => v.table === tables[0].table)!);
    } else if (metrics.length > 1) {
      // "spend": what customers spend is revenue; otherwise it is our expenses.
      const revenue = metrics.find((m) => m.metric === "revenue");
      const expense = metrics.find((m) => m.metric === "expense_total");
      if (revenue && expense) pick = customerContext() ? revenue : expense;
      else pick = metrics[0];
    } else if (metrics.length === 1 && values.length && !columns.length && values.some((v) => explicitTables.has(v.table)) && !spans.some((o) => has(o, "agg"))) {
      // "unpaid invoices": a status of the invoices being listed, not the outstanding measure.
      pick = values.find((v) => explicitTables.has(v.table));
    } else if (metrics.length === 1 && values.length && !columns.length) {
      // "sales": the Sales department only when departments or roles are being talked about.
      const v = values.find((x) => valueColumnsMentioned.has(`${x.table}.${x.column}`) || tablesMentioned.has(x.table) && x.table !== tableOf(model, metrics[0].metric === "revenue" ? "invoices" : "invoices").name);
      pick = v && near(s, "column", 2) ? v : metrics[0];
    } else if (metrics.length === 1 && tables.length) {
      // "expenses" / "giderler": a table to list or count, otherwise the measure.
      const noAgg = !spans.some((o) => (has(o, "agg") && get(o, "agg")!.agg !== "count") || has(o, "howmuch"));
      const cmpNear = spans.some((o) => has(o, "cmp")) && nums.some((n) => n.amount || n.n >= 100);
      const listy = (spans.some((o) => has(o, "count") || has(o, "list") || has(o, "latest") || has(o, "earliest")) || cmpNear) && noAgg;
      // Only the table's own noun ("expenses", "giderler") lists rows; "costs" or "tahsilat" stay a measure.
      const tm = tableOf(model, tables[0].table);
      const own = [tm.name, tm.label, tm.plural, tm.labelTr].map((x) => fold(x));
      const word = fold(s.text);
      const isOwn = own.some((o) => word === o || word.startsWith(o));
      pick = listy && (isOwn || cmpNear || spans.some((o) => has(o, "count"))) ? tables[0] : metrics[0];
    } else if (metrics.length === 1 && columns.length) {
      // "cost": a product's unit cost when products are in the question, else expenses.
      const mt = model.metrics.find((m) => m.id === metrics[0].metric)!.table;
      const c = columns.find((x) => tablesMentioned.has(x.table) && x.table !== mt);
      pick = c ?? metrics[0];
    } else if (columns.length > 1 || (columns.length && tables.length)) {
      const c = columns.find((x) => tablesMentioned.has(x.table)) ?? (tables.length && !columns.some((x) => tablesMentioned.has(x.table)) ? tables[0] : columns[0]);
      pick = c;
    } else if (values.length > 1) {
      pick = values.find((x) => valueColumnsMentioned.has(`${x.table}.${x.column}`)) ?? values.find((x) => tablesMentioned.has(x.table)) ?? values.find((x) => x.table === "customers") ?? values[0];
    } else if (values.length && tables.length) {
      pick = tablesMentioned.size && !tablesMentioned.has(tables[0].table) ? values[0] : tables[0];
    } else if (values.length && columns.length) {
      pick = near(s, "table") ? columns[0] : values[0];
    } else if (data.length) pick = data[0];
    else {
      // Question words: prefer the meaning that fits the neighbours.
      const moneyNear = nums.some((n) => (n.amount || n.n >= 1000) && n.idx >= s.end && n.idx - s.end <= 1);
      const anyNear = nums.some((n) => Math.abs(n.idx - s.start) <= 2 || Math.abs(n.idx - (s.end - 1)) <= 2);
      if (has(s, "cmp") && (has(s, "top") || has(s, "bottom")) ? moneyNear : has(s, "cmp") && anyNear) pick = get(s, "cmp");
      else if (has(s, "top") && !has(s, "agg")) pick = get(s, "top");
      else if (has(s, "bottom") && !has(s, "agg")) pick = get(s, "bottom");
      else if (has(s, "without") && fold(s.text) === "no" && !spans.some((o) => o.start === s.end && o.senses.some((x) => ["table", "metric", "column"].includes(x.k)))) pick = { k: "stop" };
      else if (has(s, "without") && has(s, "neg")) pick = spans.filter((o) => has(o, "table") || has(o, "metric")).length >= 2 || spans.some((o) => has(o, "metric")) ? get(s, "without") : get(s, "neg");
      else if (has(s, "relative") && (has(s, "stop") || (has(s, "who") && spans.some((o) => o.end === s.start && o.senses.some((x) => x.k === "table"))))) pick = get(s, "relative");
      else pick = s.senses.find((x) => x.k !== "stop") ?? s.senses[0];
    }
    chosen.set(s, pick ?? s.senses[0]);
    // Offer the other data readings.
    for (const other of data) {
      if (other === pick || keys.filter((k) => k === senseKey(other)).length > 1) continue;
      const label = describeSense(model, other);
      if (label) alternatives.push({ en: `“${s.text}” as ${label.en}`, tr: `“${s.text}” = ${label.tr}`, question: `${question}\u0000${s.text.toLowerCase()}=${senseKey(other)}` });
    }
  }

  // "customer segment", "product category", "müşteri segmentine": the table only names whose column it is.
  for (const sp of spans) {
    const c = chosen.get(sp);
    const next = spans.find((o) => o.start === sp.end);
    const n = next && chosen.get(next);
    if (c?.k === "table" && n?.k === "column" && n.table === c.table) chosen.set(sp, { k: "stop" });
  }
  const C = (s: Span) => chosen.get(s)!;
  const of = <K extends Sense["k"]>(k: K) => spans.filter((s) => C(s).k === k) as Span[];
  const sense = <K extends Sense["k"]>(s: Span) => C(s) as Extract<Sense, { k: K }>;

  if (of("write").length && !of("metric").length) return fail("Questions here only read data. To change rows, write the SQL yourself in the editor; it runs on your copy in this browser.", "Buradaki sorular yalnızca veri okur. Satırları değiştirmek için SQL'i editöre kendiniz yazın; değişiklik bu tarayıcıdaki kopyada kalır.");

  // ---- Data pieces ----
  const tableSpans = of("table");
  const metricSpans = of("metric");
  const columnSpans = of("column");
  const valueSpans = of("value");
  const quoted = ts.map((t, i) => ({ t, i })).filter((x) => x.t.kind === "quoted" && !skip.has(x.i));
  for (const t of tableSpans) tablesMentioned.add(sense<"table">(t).table);

  const anyData = tableSpans.length + metricSpans.length + columnSpans.length + valueSpans.length + quoted.length;
  const ignored = ts
    .filter((t, i) => t.kind === "word" && !skip.has(i) && !spanAt(i) && t.t.length > 1 && numberWord(t.t) === null && !/^\d/.test(t.t))
    .map((t) => t.raw);
  // Follow-ups: a question with no measure or table of its own builds on the previous answer.
  const fq = fold(question).trim();
  const cue = /^(what about|how about|and |now |only |just |same |instead|but |also |then |what if|peki|ya |simdi|sadece|yalnizca|bir de|ayni|bunun yerine|onu |bunu |bunlari)/.test(fq) || /\b(instead|as well)\b/.test(fq);
  const prev = opts.base;
  const shapeOnly = !tableSpans.length && !metricSpans.length && !spans.some((x) => has(x, "count"));
  const followUp = !!prev && (cue || shapeOnly) && (prev.plan.kind !== "anti" || shapeOnly);
  const followUpHasContent = followUp && (ranges.length > 0 || spans.some((x) => ["grain", "group", "top", "bottom", "trend", "share", "growth", "value", "column", "cmp", "agg"].includes(x.senses[0].k)) || nums.length > 0);
  if (!anyData && !followUpHasContent) {
    return fail(
      "I couldn't connect this to the data. Ask about customers, invoices, payments, products or expenses, for example “revenue by month this year”.",
      "Bunu verideki bir şeyle eşleştiremedim. Müşteriler, faturalar, ödemeler, ürünler ya da giderler hakkında sorun; örneğin “bu yıl aylık ciro”.",
      ignored,
    );
  }

  const isPlural = (s: Span) => {
    const last = ts[s.end - 1];
    const tb = C(s).k === "table" ? tableOf(model, sense<"table">(s).table) : null;
    if (!tb) return true;
    const w = last.t;
    if (/(ler|lar)/.test(w.slice(3)) && lang === "tr") return true;
    if (lang === "tr") return false;
    return w !== tb.label.split(" ").at(-1) && (w.endsWith("s") || w === "people" || w === "staff");
  };

  // Superlatives and counts.
  // "most expensive" / "cheapest": a superlative carried by a column word; "best selling": by a measure.
  const superMetric = spans.find((s) => C(s).k === "metric" && /^(best|top|most|highest|en )/.test(fold(s.text)));
  // "ilk 5 segment" / "first 10 customers" next to a measure: a ranking, like "top".
  const firstN = spans.find((s) => C(s).k === "earliest" && ts[s.end]?.kind === "number" && (of("metric").length > 0 || of("group").length > 0));
  const topSpan =
    spans.find((s) => C(s).k === "top" || C(s).k === "bottom") ?? spans.find((s) => C(s).k === "column" && (has(s, "top") || has(s, "bottom"))) ?? superMetric ?? firstN;
  const dir: "asc" | "desc" | null = topSpan ? (topSpan !== firstN && (C(topSpan).k === "bottom" || (C(topSpan).k === "column" && has(topSpan, "bottom") && !has(topSpan, "top"))) ? "asc" : "desc") : null;
  const countSpan = of("count")[0];
  const aggSpans = of("agg");
  const groupSpans = of("group");
  const grainSpan = of("grain")[0];
  const trend = of("trend").length > 0;
  const negIdx = of("neg").map((s) => s.start);
  const withoutSpan = of("without")[0];
  // "which country" asks for a group; "what share", "what is" don't.
  const whichSpan = of("which").find((w) => spans.some((o) => o.start >= w.end && o.start - w.end <= 1 && ["table", "column"].includes(C(o).k)));
  const whoSpan = of("who")[0];
  const latest = of("latest")[0];
  const earliest = of("earliest").find((s) => s !== firstN);
  const share = of("share").length > 0;
  const growth = of("growth").length > 0;
  const compare = of("compare").length > 0;
  const explicitAsc = of("asc").length > 0;
  const explicitDesc = of("desc").length > 0;

  // Comparators: "over 5000", "5000'den fazla", "between 100 and 500".
  interface Cmp {
    op: Op;
    value: number;
    value2?: number;
    at: number;
  }
  const cmps: Cmp[] = [];
  for (const s of of("cmp")) {
    const c = sense<"cmp">(s);
    const after = c.after || ts[s.start]?.t === "or" || ts[s.start]?.t === "and";
    const n = after ? [...nums].reverse().find((x) => x.idx < s.start && s.start - x.idx <= 3 && !x.used) : nums.find((x) => x.idx >= s.end && x.idx - s.end <= 2 && !x.used);
    if (n) {
      n.used = true;
      cmps.push({ op: c.op, value: n.n, at: Math.min(n.idx, s.start) });
    }
  }
  // "between 1000 and 5000" / "1000 ile 5000 arasında"
  for (let i = 0; i < nums.length - 1; i++) {
    const a = nums[i], b = nums[i + 1];
    if (a.used || b.used || !a.amount || !b.amount || b.idx - a.idx !== 2) continue;
    a.used = b.used = true;
    cmps.push({ op: ">=", value: Math.min(a.n, b.n), value2: Math.max(a.n, b.n), at: a.idx });
  }
  // "en çok 5000" reads as "at most 5000" when the number is money.
  if (topSpan) {
    const n = nums.find((x) => x.idx === topSpan.end && !x.used);
    if (n && (n.amount || n.n >= 1000) && lang === "tr") {
      n.used = true;
      cmps.push({ op: C(topSpan).k === "top" ? "<=" : ">=", value: n.n, at: topSpan.start });
    }
  }

  // Limits: "top 5", "5 customers", "ilk 10", "son 3 fatura".
  let limit: number | null = null;
  for (const n of nums) {
    if (n.used || n.amount) continue;
    const prev = spans.find((s) => s.end === n.idx || s.end === n.idx - 1);
    const next = spanAt(n.idx + 1) ?? spanAt(n.idx + 2);
    const prevOk = prev && ["top", "bottom", "latest", "earliest", "list"].includes(C(prev).k);
    const nextOk = next && ["table", "column", "value", "metric"].includes(C(next).k);
    if ((prevOk || nextOk) && n.n >= 1 && n.n <= 1000 && Number.isInteger(n.n)) {
      limit = n.n;
      n.used = true;
      break;
    }
  }

  // ---- Measures ----
  const measures: Measure[] = [];
  let averageGroups = false;
  const metricOf = (id: string) => model.metrics.find((m) => m.id === id)!;
  const usedSpans = new Set<Span>();

  // agg + column: "average credit limit", "kredi limiti ortalaması", "total tax"
  for (const a of aggSpans) {
    const agg = sense<"agg">(a).agg as Agg;
    // What the aggregate applies to: a number column or a measure, the nearest one (after it first).
    const fits = (s: Span) => {
      const c = C(s);
      if (c.k === "metric" || c.k === "table") return true;
      if (c.k !== "column") return false;
      const cm = tableOf(model, c.table).columns.find((x) => x.name === c.column)!;
      return isNumeric(cm) || (cm.role === "date" && (agg === "max" || agg === "min"));
    };
    const target = [...columnSpans, ...metricSpans, ...tableSpans]
      .filter((s) => !usedSpans.has(s) && fits(s))
      .map((s) => ({ s, d: s.start >= a.end ? s.start - a.end : (a.start - s.end) * (lang === "tr" ? 1.2 : 2.5) + 0.5 }))
      .filter((x) => x.d <= 3.5)
      .sort((x, y) => x.d - y.d)[0]?.s;
    if (!target) continue;
    const t = C(target);
    if (t.k === "column") {
      const col = tableOf(model, t.table).columns.find((c) => c.name === t.column)!;
      if (isNumeric(col) && agg !== "count") {
        const mapped = (agg === "sum" || agg === "avg") && col.metricFor?.[agg];
        measures.push(mapped ? { kind: "metric", metric: mapped } : { kind: "agg", agg, table: t.table, column: t.column });
        usedSpans.add(target).add(a);
      } else if (col.role === "date" && (agg === "max" || agg === "min")) {
        measures.push({ kind: "agg", agg, table: t.table, column: t.column });
        usedSpans.add(target).add(a);
      }
    } else if (t.k === "metric") {
      const m = metricOf(t.metric);
      if (agg === "avg" && m.sql.startsWith("SUM(")) {
        // "average revenue": per group if there is one, else per invoice.
        averageGroups = true;
      }
      usedSpans.add(a);
    } else if (t.k === "table" && agg === "sum") {
      // "total customers" = how many customers
      usedSpans.add(a);
    }
  }
  for (const s of metricSpans) {
    const id = sense<"metric">(s).metric;
    if (!measures.some((m) => m.kind === "metric" && m.metric === id)) measures.push({ kind: "metric", metric: id });
  }
  // Counting: "how many customers", "fatura sayısı", "total customers"
  const sumBeforeTable = aggSpans.find((a) => sense<"agg">(a).agg === "sum" && tableSpans.some((t) => t.start - a.end <= 1 && t.start >= a.end));
  let countTable: string | null = null;
  if (countSpan || sumBeforeTable) {
    const at = (countSpan ?? sumBeforeTable)!;
    const t =
      tableSpans.map((s) => ({ s, d: s.start >= at.end ? s.start - at.end : (at.start - s.end) * (lang === "tr" ? 1 : 3) + 0.5 })).sort((a, b) => a.d - b.d)[0]?.s ??
      null;
    if (t) countTable = sense<"table">(t).table;
    else if (!metricSpans.length && valueSpans.length) countTable = sense<"value">(valueSpans[0]).table;
    else if (!metricSpans.length && columnSpans.length) countTable = sense<"column">(columnSpans[0]).table;
    // "how many units" is a measure already; "how many customers" is a count.
    // "number of units sold": the measure is units, not a count of rows.
    const countMetricNext = metricSpans.find((m) => m.start >= at.end && m.start - at.end <= 1 && metricOf(sense<"metric">(m).metric).unit === "count");
    if (countTable && !countMetricNext && !(metricSpans.length && metricOf(sense<"metric">(metricSpans[0]).metric).unit === "count" && !t)) {
      const countMetric = metricSpans.find((m) => metricOf(sense<"metric">(m).metric).table === countTable && metricOf(sense<"metric">(m).metric).unit === "count");
      if (!countMetric) measures.unshift({ kind: "count", table: countTable });
    }
  }
  // "kaç adet elektronik ürün sattık", "how many items did we sell": units sold, not a count of products.
  if (measures[0]?.kind === "count" && model.metrics.some((m) => m.id === "units") && /\b(sat|sold|sell|selling)/i.test(fold(question)) && (measures[0].table === "products" || valueSpans.some((v) => sense<"value">(v).table === "products"))) {
    measures[0] = { kind: "metric", metric: "units" };
  }
  // "average revenue" without a group: average invoice.
  if (averageGroups && measures[0]?.kind === "metric" && measures[0].metric === "revenue" && !groupSpans.length && !grainSpan && !tableSpans.some((t) => sense<"table">(t).table !== "invoices")) {
    measures[0] = { kind: "metric", metric: "aov" };
    averageGroups = false;
  }

  // "payments received in September": the rows of the named table, not their total.
  const aggregateCue = aggSpans.length || howMuch_() || countSpan || groupSpans.length || grainSpan || trend || topSpan || share || growth || compare;
  function howMuch_() {
    return spans.some((x) => C(x).k === "howmuch");
  }
  if (!aggregateCue && measures.length && measures.every((m) => m.kind === "metric" && explicitTables.has(metricOf(m.metric).table)) && tableSpans.some((t) => explicitTables.has(sense<"table">(t).table))) {
    measures.length = 0;
  }
  // "total tax collected": the column total; "collected" only describes it.
  if (measures.some((m) => m.kind === "agg")) {
    for (let k = measures.length - 1; k >= 0; k--) {
      const m = measures[k];
      if (m.kind !== "metric") continue;
      const sp = metricSpans.find((x) => sense<"metric">(x).metric === m.metric);
      if (sp && columnSpans.some((c) => c.end === sp.start && usedSpans.has(c))) measures.splice(k, 1);
    }
  }

  // "how much did we invoice", "ne kadar harcadık": the table's money measure.
  const howMuch = of("howmuch").length > 0;
  const tableForMeasure = () => {
    const t = (lang === "tr" ? [...tableSpans].reverse() : tableSpans)[0];
    if (t) return sense<"table">(t).table;
    if (valueSpans.length) return sense<"value">(valueSpans[0]).table;
    return null;
  };
  if (!measures.length && howMuch) {
    const t = tableForMeasure();
    if (t) {
      const m = model.metrics.find((x) => x.table === t && x.unit === "money");
      const tm = tableOf(model, t);
      if (m) measures.push({ kind: "metric", metric: m.id });
      else if (tm.amountColumn) measures.push({ kind: "agg", agg: "sum", table: t, column: tm.amountColumn });
    }
  }
  // "top customers", "en iyi 5 ürün": rank by the table's usual measure unless a column is named.
  if (!measures.length && topSpan && C(topSpan).k !== "column" && !withoutSpan) {
    const t = tableForMeasure();
    const tm = t ? tableOf(model, t) : null;
    const namedNumeric = columnSpans.some((s) => {
      const c = sense<"column">(s);
      const cm = tableOf(model, c.table).columns.find((x) => x.name === c.column);
      return cm && (isNumeric(cm) || cm.role === "date");
    });
    if (tm?.rankMetric && !namedNumeric && !latest && !earliest) measures.push({ kind: "metric", metric: tm.rankMetric });
  }

  if (followUp && prev && !measures.length && prev.plan.kind === "aggregate" && !(aggSpans.length && columnSpans.length)) measures.push(...structuredClone(prev.plan.measures));

  // ---- What the rows are about ----
  const headTable = (() => {
    const cands = tableSpans.filter((s) => !(countTable && sense<"table">(s).table === countTable && measures[0]?.kind === "count" && tableSpans.length > 1));
    if (!cands.length) return null;
    return lang === "tr" ? cands[cands.length - 1] : cands[0];
  })();

  const measureTable = (m: Measure) => (m.kind === "metric" ? metricOf(m.metric).table : m.table);
  const measureDate = (m: Measure): string | null => {
    if (m.kind === "metric") return metricOf(m.metric).date;
    const t = tableOf(model, m.table);
    return t.dateColumn ? `${t.name}.${t.dateColumn}` : null;
  };

  const grouping: Group[] = [];
  // anti: "customers with no invoices", "products never sold", "hiç sipariş vermemiş müşteriler"
  if (withoutSpan && headTable) {
    const head = sense<"table">(headTable).table;
    // The related rows that must be missing: a named table, the measure's, or the head's child table.
    const child = model.relations.find((r) => r.to.table === head)?.from.table ?? null;
    const otherTable = tableSpans.map((s) => sense<"table">(s).table).find((t) => t !== head) ?? (measures[0] && measureTable(measures[0]) !== head ? measureTable(measures[0]) : child);
    if (otherTable && otherTable !== head && pathBetween(model, head, otherTable)) {
      measures.length = 0;
      return finish({
        kind: "anti",
        subject: head,
        anti: { table: otherTable, filters: [] },
      });
    }
  }

  let kind: Plan["kind"] = measures.length ? "aggregate" : "list";
  const subject = measures.length ? measureTable(measures[0]) : followUp && prev && !headTable ? prev.plan.subject : headTable ? sense<"table">(headTable).table : valueSpans.length ? sense<"value">(valueSpans[0]).table : columnSpans.length ? sense<"column">(columnSpans[0]).table : quoted.length ? model.tables[0].name : metricSpans.length ? metricOf(sense<"metric">(metricSpans[0]).metric).table : model.tables[0].name;

  // A list question that names a numeric column with a superlative: "top 5 invoices by total", "most expensive products".
  if (kind === "list" && aggSpans.length) {
    const a = aggSpans.find((x) => !usedSpans.has(x));
    if (a && (sense<"agg">(a).agg === "max" || sense<"agg">(a).agg === "min") && !headTable) {
      const t = tableOf(model, subject);
      if (t.amountColumn) {
        measures.push({ kind: "agg", agg: sense<"agg">(a).agg as "max" | "min", table: t.name, column: t.amountColumn });
        kind = "aggregate";
      }
    }
  }

  const groupTargetAt = (g: Span): Span | undefined => {
    const word = ts[g.start].t;
    // Turkish markers follow their noun ("ülkelere göre"); "her" and the English ones precede it.
    const after = lang === "en" || word === "her" || word === "per" || word === "by" || word === "each";
    const pool = spans.filter((s) => ["table", "column", "value"].includes(C(s).k) && !usedSpans.has(s));
    if (after) return pool.filter((s) => s.start >= g.end && s.start - g.end <= 2).sort((a, b) => a.start - b.start)[0];
    return pool.filter((s) => s.end <= g.start && g.start - s.end <= 1).sort((a, b) => b.end - a.end)[0];
  };

  // "payments by method", "müşteriler ülkelere göre": count (and total) per group.
  if (kind === "list" && (groupSpans.length || grainSpan || trend) && !withoutSpan) {
    // A numeric column named in the question is what to add up: "goals by team", "total by country".
    const named = columnSpans
      .map((sp) => ({ sp, c: sense<"column">(sp) }))
      .map((x) => ({ ...x, cm: tableOf(model, x.c.table).columns.find((y) => y.name === x.c.column)! }))
      .find((x) => isNumeric(x.cm) && !groupSpans.some((g) => groupTargetAt(g) === x.sp));
    if (named) {
      measures.push({ kind: "agg", agg: "sum", table: named.c.table, column: named.c.column });
      usedSpans.add(named.sp);
    } else {
      const t = tableOf(model, subject);
      measures.push({ kind: "count", table: subject });
      if (t.amountColumn && t.columns.find((c) => c.name === t.amountColumn)?.role === "money" && subject !== "customers") measures.push({ kind: "agg", agg: "sum", table: subject, column: t.amountColumn });
    }
    kind = "aggregate";
  }


  if (kind === "aggregate") {
    const m0 = measures[0];
    const dateCol = measureDate(m0);
    const addTime = (grain: Grain) => {
      if (!dateCol) return;
      const [t, c] = dateCol.split(".");
      if (!grouping.some((g) => g.kind === "time")) grouping.push({ kind: "time", table: t, column: c, grain });
    };
    // "revenue by month", "aylık ciro", "trend"
    if (grainSpan) addTime(sense<"grain">(grainSpan).grain);
    // "5 ülke", "the 10 countries", "3 bölge" with a ranking: rank that column's values.
    if (topSpan && limit) {
      const n = nums.find((x) => x.used && x.n === limit && !x.amount);
      const col = n && columnSpans.find((sp) => sp.start === n.idx + 1 && !usedSpans.has(sp));
      if (col) {
        const c = sense<"column">(col);
        const cm = tableOf(model, c.table).columns.find((x) => x.name === c.column)!;
        if (cm.role === "category") {
          grouping.push({ kind: "column", table: c.table, column: c.column });
          usedSpans.add(col);
          if (headTable) usedSpans.add(headTable);
        }
      }
    }
    // Explicit group markers.
    for (const g of groupSpans) {
      const target = groupTargetAt(g);
      if (!target) continue;
      const t = C(target);
      if (t.k === "table") {
        if (!grouping.some((x) => x.kind === "entity" && x.table === t.table)) grouping.push({ kind: "entity", table: t.table });
        usedSpans.add(target);
      } else if (t.k === "column") {
        const col = tableOf(model, t.table).columns.find((c) => c.name === t.column)!;
        if (col.role === "date") grouping.push({ kind: "time", table: t.table, column: t.column, grain: "month" });
        else if (col.role === "fk" && col.ref) grouping.push({ kind: "entity", table: col.ref.table });
        else if (col.role === "name") grouping.push({ kind: "entity", table: t.table });
        else grouping.push({ kind: "column", table: t.table, column: t.column });
        usedSpans.add(target);
      }
    }
    // "which customer", "hangi ülke", "who" + superlative or measure: group by it.
    const asker = whichSpan ?? whoSpan;
    if (asker) {
      let next = spans.find((s) => s.start >= asker.end && s.start - asker.end <= 1 && ["table", "column"].includes(C(s).k));
      // "hangi ürün kategorisi", "which product category": the column, not the table.
      const after2 = next && spans.find((s) => s.start === next!.end && C(s).k === "column");
      if (next && after2 && C(next).k === "table" && sense<"column">(after2).table === sense<"table">(next).table) {
        usedSpans.add(next);
        next = after2;
      }
      if (next && !usedSpans.has(next)) {
        const t = C(next);
        if (t.k === "table" && t.table !== measureTable(m0)) grouping.push({ kind: "entity", table: t.table });
        else if (t.k === "table" && m0.kind !== "count") grouping.push({ kind: "entity", table: t.table });
        else if (t.k === "column") {
          const col = tableOf(model, t.table).columns.find((c) => c.name === t.column)!;
          if (col.role === "date") addTime(/month|ay/.test(next.text.toLowerCase()) ? "month" : "month");
          else if (col.role === "name") grouping.push({ kind: "entity", table: t.table });
          else grouping.push({ kind: "column", table: t.table, column: t.column });
        }
        usedSpans.add(next);
      } else if (whoSpan && !grouping.length) {
        const sold = /\b(sold|sell|sells|seller|rep|reps|sattı|satan|satış temsilcisi|satis temsilcisi|sattigi)\b/i.test(question);
        const exp = m0.kind === "metric" && metricOf(m0.metric).table === "expenses";
        const who = model.source === "demo" ? (sold || exp ? "employees" : "customers") : null;
        if (who) grouping.push({ kind: "entity", table: who });
      }
      // "which month", "hangi ay": a time question.
      const unitWord = ts[asker.end]?.t ?? "";
      if (!grouping.length && /^(month|ay|year|yil|quarter|ceyrek|week|hafta|day|gun)/.test(unitWord)) addTime(unitWord.startsWith("month") || unitWord.startsWith("ay") ? "month" : unitWord.startsWith("year") || unitWord.startsWith("yil") ? "year" : unitWord.startsWith("quarter") || unitWord.startsWith("ceyrek") ? "quarter" : unitWord.startsWith("week") || unitWord.startsWith("hafta") ? "week" : "day");
    }
    // "top 5 customers by revenue", "en çok harcayan müşteriler", "customers who spent more than 10k"
    // "how many customers spent over 100k": count customers whose revenue passes the bar.
    if (headTable && m0.kind === "count" && cmps.length && measures.some((m) => m.kind === "metric")) {
      const t = sense<"table">(headTable).table;
      const mi = measures.findIndex((m) => m.kind === "metric");
      if (m0.table === t && measureTable(measures[mi]) !== t) {
        const [mm] = measures.splice(mi, 1);
        for (let k = measures.length - 1; k >= 0; k--) if (measures[k].kind === "count") measures.splice(k, 1);
        measures.unshift(mm);
        grouping.push({ kind: "entity", table: t });
        usedSpans.add(headTable);
      }
    }
    if (headTable && !usedSpans.has(headTable)) {
      const t = sense<"table">(headTable).table;
      const isMeasureTable = t === measureTable(m0) && m0.kind === "count";
      const measureSpan = metricSpans[0] ?? countSpan;
      const headFirst = measureSpan ? (lang === "tr" ? headTable.start > measureSpan.start : headTable.start < measureSpan.start) : false;
      const asksTotal = howMuch || !!countSpan || aggSpans.some((x) => sense<"agg">(x).agg === "sum");
      const ranking = topSpan || (!asksTotal && (cmps.length || headFirst || of("relative").length));
      if (!isMeasureTable && ranking && !grouping.some((g) => g.kind === "entity" && g.table === t)) {
        // "revenue from customers in Germany" stays one number; "customers by revenue" is a ranking.
        const filterOnly = !topSpan && !cmps.length && !headFirst;
        if (!filterOnly) grouping.push({ kind: "entity", table: t });
      }
    }
    // A superlative on a value's column: "best selling category", "en çok satan kategori"
    if (topSpan && !grouping.length) {
      const c = columnSpans.find((s) => !usedSpans.has(s) && (Math.abs(s.start - topSpan.end) <= 3 || (topSpan.start - s.end >= 0 && topSpan.start - s.end <= 4)));
      if (c) {
        const t = sense<"column">(c);
        const col = tableOf(model, t.table).columns.find((x) => x.name === t.column)!;
        if (col.role === "category") grouping.push({ kind: "column", table: t.table, column: t.column });
        else if (col.role === "name") grouping.push({ kind: "entity", table: t.table });
        else if (col.role === "date") addTime("month");
        if (grouping.length) usedSpans.add(c);
      }
    }
    if ((trend || growth) && !grouping.some((g) => g.kind === "time")) {
      const r = ranges[0];
      const days = r?.from && r?.to ? (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 : 9999;
      addTime(days <= 45 ? "day" : "month");
    }
    // Two periods side by side: "this year vs last year"
    if ((compare || ranges.length >= 2) && ranges.length >= 2 && dateCol) {
      const [t, c] = dateCol.split(".");
      grouping.unshift({ kind: "period", table: t, column: c, ranges: ranges.map((r) => ({ from: r.from, to: r.to, label: lang === "tr" ? r.labelTr : r.label })) });
    }
  }

  return finish({ kind, subject });

  // ---- Assemble the plan ----
  function finish(base: { kind: Plan["kind"]; subject: string; anti?: Plan["anti"] }): ParseResult {
    const plan: Plan = {
      lang,
      kind: base.kind,
      subject: base.subject,
      measures,
      groups: grouping,
      filters: [],
      having: null,
      anti: base.anti,
      order: null,
      limit: null,
      share: share && grouping.length > 0,
      growth: growth && grouping.some((g) => g.kind === "time"),
      countGroups: false,
      averageGroups: averageGroups && grouping.length > 0,
      columns: [],
      notes,
    };
    const subjectTable = tableOf(model, plan.subject);

    // Value filters: "Germany", "overdue", "not Retail", "Almanya hariç"
    for (const v of valueSpans) {
      if (usedSpans.has(v)) continue;
      const s = sense<"value">(v);
      const negate = negIdx.some((n) => (n < v.start && v.start - n <= 3) || (lang === "tr" && n >= v.end && n - v.end <= 1)) || (lang === "tr" && /^(haric|disinda)/.test(ts[v.end]?.t ?? ""));
      const existing = plan.filters.find((f) => f.kind === "value" && f.table === s.table && f.column === s.column && f.negate === negate);
      if (existing && existing.kind === "value") existing.values.push(...s.values.filter((x) => !existing.values.includes(x)));
      else plan.filters.push({ kind: "value", table: s.table, column: s.column, values: [...s.values], negate });
    }
    // Filters a table word carries: "sales reps" -> role is Sales rep.
    for (const [sp, v] of implied) {
      if (C(sp).k !== "table") continue;
      if (!plan.filters.some((f) => f.kind === "value" && f.table === v.table && f.column === v.column)) plan.filters.push({ kind: "value", table: v.table, column: v.column, values: [...v.values], negate: false });
    }
    // "Harbor Market" in quotes: a name match.
    for (const q of quoted) {
      const t = subjectTable.nameColumn ? subjectTable : model.tables.find((x) => x.nameColumn) ?? subjectTable;
      const col = t.nameColumn ?? t.columns.find((c) => c.type === "text")?.name;
      if (col) plan.filters.push({ kind: "like", table: t.name, column: col, text: q.t.raw.replace(/^["']|["']$/g, ""), negate: false });
    }
    // Dates
    const dateTarget = (() => {
      // "due in March" / "vadesi mart" points at a named date column.
      const named = columnSpans.find((s) => {
        const c = sense<"column">(s);
        return tableOf(model, c.table).columns.find((x) => x.name === c.column)?.role === "date";
      });
      if (named) {
        const c = sense<"column">(named);
        return `${c.table}.${c.column}`;
      }
      if (plan.kind === "anti" && plan.anti) {
        const t = tableOf(model, plan.anti.table);
        return t.dateColumn ? `${t.name}.${t.dateColumn}` : null;
      }
      if (plan.measures[0]) return measureDate(plan.measures[0]);
      return subjectTable.dateColumn ? `${subjectTable.name}.${subjectTable.dateColumn}` : null;
    })();
    if (ranges.length && !plan.groups.some((g) => g.kind === "period")) {
      if (dateTarget) {
        const [t, c] = dateTarget.split(".");
        const r = ranges[0];
        const f: Filter = { kind: "date", table: t, column: c, from: r.from, to: r.to, label: lang === "tr" ? r.labelTr : r.label };
        if (plan.kind === "anti") plan.anti!.filters.push(f);
        else plan.filters.push(f);
      } else notes.push({ kind: "ignored", en: `No date column to apply “${ranges[0].label}” to`, tr: `“${ranges[0].labelTr}” için tarih sütunu yok` });
    } else if (plan.groups.some((g) => g.kind === "period")) {
      const p = plan.groups.find((g) => g.kind === "period")!;
      if (p.kind === "period") {
        const from = p.ranges.map((r) => r.from).filter(Boolean).sort()[0] ?? null;
        const to = p.ranges.map((r) => r.to).filter(Boolean).sort().at(-1) ?? null;
        plan.filters.push({ kind: "date", table: p.table, column: p.column, from, to, label: p.ranges.map((r) => r.label).join(" + ") });
      }
    }

    // Comparisons: on a measure (HAVING) when rows are grouped, else on a column.
    for (const c of cmps) {
      const before = spans.filter((s) => s.end <= c.at && c.at - s.end <= 4 && ["column", "metric"].includes(C(s).k)).sort((a, b) => b.end - a.end)[0];
      const after = spans.filter((s) => s.start > c.at && s.start - c.at <= 4 && ["column", "metric"].includes(C(s).k)).sort((a, b) => a.start - b.start)[0];
      const target = lang === "tr" ? (before ?? after) : (before ?? after);
      const t = target ? C(target) : null;
      const grouped = plan.groups.length > 0;
      if (t?.k === "column") {
        const col = tableOf(model, t.table).columns.find((x) => x.name === t.column)!;
        if (isNumeric(col)) {
          plan.filters.push({ kind: "compare", table: t.table, column: t.column, op: c.op, value: c.value, value2: c.value2 });
          continue;
        }
      }
      if ((t?.k === "metric" || !t) && grouped && plan.kind === "aggregate") {
        plan.having = { op: c.op, value: c.value, value2: c.value2 };
        continue;
      }
      // "invoices over 5000", "how many invoices over 5000": the table's amount.
      const tb = plan.kind === "aggregate" && plan.measures[0] ? tableOf(model, measureTable(plan.measures[0])) : subjectTable;
      const amountTable = tb.amountColumn ? tb : subjectTable.amountColumn ? subjectTable : null;
      if (amountTable?.amountColumn) plan.filters.push({ kind: "compare", table: amountTable.name, column: amountTable.amountColumn, op: c.op, value: c.value, value2: c.value2 });
    }

    // Follow-up: keep what the new words don't change.
    if (followUp && prev) {
      const b = prev.plan;
      const additive = /\b(also|as well|too|and also)\b|\b(de|da)\b|bir de/.test(fq);
      const total = /\b(in total|overall|altogether|toplamda|genel toplam)\b/.test(fq);
      const clearAll = /(without filters|no filters|remove (the )?filters|filtresiz|filtreleri kaldir|tum filtreleri)/.test(fq);
      const cleared = new Set<string>();
      // "all countries", "tüm ülkeler": drop that filter.
      spans.forEach((sp, k) => {
        if (/^(all|every|tum|butun|her)$/.test(fold(sp.text))) {
          const next = spans[k + 1];
          if (next && C(next).k === "column") cleared.add(`${sense<"column">(next).table}.${sense<"column">(next).column}`);
        }
      });
      if (!clearAll) {
        for (const f of b.filters) {
          if (f.kind === "date") {
            if (!plan.filters.some((x) => x.kind === "date")) plan.filters.push(structuredClone(f));
            continue;
          }
          if (cleared.has(`${f.table}.${f.column}`)) continue;
          const same = plan.filters.find((x) => x.kind !== "date" && x.table === f.table && x.column === f.column);
          if (same) {
            if (additive && same.kind === "value" && f.kind === "value" && same.negate === f.negate) same.values = [...new Set([...f.values, ...same.values])];
            continue;
          }
          plan.filters.push(structuredClone(f));
        }
      }
      if (!plan.groups.length && !total && b.kind === "aggregate" && plan.kind === "aggregate") {
        plan.groups = structuredClone(b.groups);
        if (!topSpan && !limit) {
          plan.order = b.order && structuredClone(b.order);
          plan.limit = b.limit;
        }
        plan.share = plan.share || b.share;
        plan.growth = plan.growth || b.growth;
      }
      if (!plan.having && b.having && plan.groups.length) plan.having = structuredClone(b.having);
      notes.unshift({ kind: "shape", en: `Follow-up to “${prev.question}”`, tr: `“${prev.question}” sorusunun devamı` });
    }

    // "how many customers spent over 10k": count the groups.
    if (countSpan && plan.having && plan.groups.some((g) => g.kind === "entity")) {
      plan.countGroups = true;
      const ent = plan.groups.find((g) => g.kind === "entity")!;
      if (ent.kind === "entity") plan.measures = plan.measures.filter((m, k) => k === 0 || !(m.kind === "count" && m.table === ent.table));
    }

    // Order and limit.
    const singular = topSpan ? !(() => {
      const nounAfter = spans.find((s) => s.start >= topSpan.end && ["table", "column", "value"].includes(C(s).k));
      const nounBefore = [...spans].reverse().find((s) => s.end <= topSpan.start && ["table", "column"].includes(C(s).k));
      const noun = lang === "tr" ? (spans.find((s) => s.start > topSpan.start && C(s).k === "table") ?? nounAfter) : (nounAfter ?? nounBefore);
      return noun ? isPlural(noun) : false;
    })() : false;
    if (plan.kind === "aggregate" && plan.groups.length && !plan.countGroups && !plan.averageGroups) {
      if (topSpan) {
        plan.order = { by: "measure", dir: dir! };
        plan.limit = limit ?? (singular || whichSpan || whoSpan ? 1 : 10);
      } else if (whichSpan || whoSpan) {
        plan.order = { by: "measure", dir: "desc" };
        plan.limit = limit ?? 1;
      } else if (plan.groups.some((g) => g.kind === "time" || g.kind === "period")) {
        plan.order = { by: "group", dir: explicitDesc || latest ? "desc" : "asc" };
        if (limit) plan.limit = limit;
      } else {
        plan.order = { by: "measure", dir: explicitAsc ? "asc" : "desc" };
        if (limit) plan.limit = limit;
      }
    } else if (plan.kind === "list") {
      const col = columnSpans.map((s) => sense<"column">(s)).find((c) => {
        const cm = tableOf(model, c.table).columns.find((x) => x.name === c.column);
        return cm && (isNumeric(cm) || cm.role === "date") && c.table === plan.subject;
      });
      if (topSpan) {
        const target = col?.column ?? subjectTable.amountColumn;
        if (target) plan.order = { by: "column", table: plan.subject, column: target, dir: dir! };
        plan.limit = limit ?? (singular ? 1 : 10);
      } else if (latest || earliest) {
        const target = (col && tableOf(model, col.table).columns.find((x) => x.name === col.column)?.role === "date" ? col.column : null) ?? subjectTable.dateColumn;
        if (target) plan.order = { by: "column", table: plan.subject, column: target, dir: latest ? "desc" : "asc" };
        plan.limit = limit ?? (latest && isPlural(headTable ?? tableSpans[0] ?? spans[0]) ? 10 : 1);
      } else {
        if (col) plan.order = { by: "column", table: plan.subject, column: col.column, dir: explicitAsc ? "asc" : "desc" };
        else if (subjectTable.dateColumn) plan.order = { by: "column", table: plan.subject, column: subjectTable.dateColumn, dir: explicitAsc ? "asc" : "desc" };
        else if (subjectTable.nameColumn) plan.order = { by: "column", table: plan.subject, column: subjectTable.nameColumn, dir: explicitDesc ? "desc" : "asc" };
        if (limit) plan.limit = limit;
      }
      // Columns asked for by name: "emails of customers", "invoice due dates".
      for (const s of columnSpans) {
        const c = sense<"column">(s);
        if (!plan.columns.some((x) => x.table === c.table && x.column === c.column)) plan.columns.push({ table: c.table, column: c.column });
      }
    } else if (plan.kind === "anti") {
      if (subjectTable.nameColumn) plan.order = { by: "column", table: plan.subject, column: subjectTable.nameColumn, dir: "asc" };
      if (limit) plan.limit = limit;
    }

    // A follow-up that didn't ask for a new ranking keeps the previous one ("top 5 ... / what about last year").
    if (followUp && prev && !topSpan && !limit && prev.plan.limit && JSON.stringify(plan.groups) === JSON.stringify(prev.plan.groups)) {
      plan.order = structuredClone(prev.plan.order);
      plan.limit = prev.plan.limit;
    }
    // Notes, in both languages.
    describe(model, plan, ranges);
    if (ignored.length) notes.push({ kind: "ignored", en: `Not used: ${ignored.join(", ")}`, tr: `Kullanılmayan: ${ignored.join(", ")}` });

    const content = ts.filter((t, i) => (t.kind === "word" || t.kind === "number" || t.kind === "quoted") && !skip.has(i)).length || 1;
    const typos = spans.filter((s) => s.quality === "typo").length;
    const confidence = Math.max(0.05, Math.min(1, 1 - ignored.length / content - typos * 0.08 - (plan.kind === "aggregate" && !plan.measures.length ? 0.4 : 0)));
    return { ok: true, plan, ignored, confidence: Math.round(confidence * 100) / 100, alternatives: dedupe(alternatives) };
  }
}

const dedupe = <T extends { question: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => y.question === x.question) === i).slice(0, 4);

function describeSense(model: Model, s: Sense): { en: string; tr: string } | null {
  if (s.k === "metric") {
    const m = model.metrics.find((x) => x.id === s.metric)!;
    return { en: m.label.toLowerCase(), tr: m.labelTr.toLowerCase() };
  }
  if (s.k === "table") {
    const t = tableOf(model, s.table);
    return { en: `the ${t.plural} table`, tr: `${t.labelTr} tablosu` };
  }
  if (s.k === "column") {
    const c = tableOf(model, s.table).columns.find((x) => x.name === s.column)!;
    return { en: `${c.label.toLowerCase()} (${s.table})`, tr: `${c.labelTr.toLowerCase()} (${s.table})` };
  }
  if (s.k === "value") {
    const c = tableOf(model, s.table).columns.find((x) => x.name === s.column)!;
    return { en: `${c.label.toLowerCase()} = ${s.values.join(" or ")}`, tr: `${c.labelTr.toLowerCase()} = ${s.values.join(" veya ")}` };
  }
  return null;
}

/** Path of relations between two tables, or null when they don't connect. */
export function pathBetween(model: Model, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, ""]]);
  const queue = [from];
  while (queue.length) {
    const t = queue.shift()!;
    for (const r of model.relations) {
      const next = r.from.table === t ? r.to.table : r.to.table === t ? r.from.table : null;
      if (!next || prev.has(next)) continue;
      prev.set(next, t);
      if (next === to) {
        const path = [to];
        let cur = to;
        while (prev.get(cur)) path.unshift((cur = prev.get(cur)!));
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const OPS: Record<Op, [string, string]> = { ">": ["over", "üzeri"], "<": ["under", "altı"], ">=": ["at least", "en az"], "<=": ["at most", "en fazla"], "=": ["exactly", "tam"], "!=": ["not", "değil"] };

function measureLabel(model: Model, m: Measure): { en: string; tr: string; note?: { en: string; tr: string } } {
  if (m.kind === "metric") {
    const x = model.metrics.find((y) => y.id === m.metric) as MetricModel;
    return { en: x.label, tr: x.labelTr, note: { en: x.note, tr: x.noteTr } };
  }
  const t = tableOf(model, m.table);
  if (m.kind === "count") return { en: `Number of ${t.plural}`, tr: `${t.labelTr} sayısı` };
  const c = t.columns.find((x) => x.name === m.column)!;
  const en = { sum: "Total", avg: "Average", min: "Lowest", max: "Highest" }[m.agg];
  const tr = { sum: "Toplam", avg: "Ortalama", min: "En düşük", max: "En yüksek" }[m.agg];
  return { en: `${en} ${c.label.toLowerCase()}`, tr: `${tr} ${c.labelTr.toLocaleLowerCase("tr")}` };
}

function describe(model: Model, plan: Plan, ranges: DateRange[]) {
  const n = plan.notes;
  const t = tableOf(model, plan.subject);
  if (plan.kind === "list") n.push({ kind: "shape", en: `List of ${t.plural}`, tr: `${t.labelTr} listesi` });
  if (plan.kind === "anti" && plan.anti) {
    const o = tableOf(model, plan.anti.table);
    n.push({ kind: "shape", en: `${t.plural[0].toUpperCase() + t.plural.slice(1)} with no ${o.plural}`, tr: `Hiç ${o.labelTr} kaydı olmayan ${t.labelTr} kayıtları` });
  }
  for (const m of plan.measures) {
    const l = measureLabel(model, m);
    n.push({ kind: "measure", en: l.note ? `${l.en}: ${l.note.en.charAt(0).toLowerCase() + l.note.en.slice(1)}` : l.en, tr: l.note ? `${l.tr}: ${l.note.tr.charAt(0).toLocaleLowerCase("tr") + l.note.tr.slice(1)}` : l.tr });
  }
  for (const g of plan.groups) {
    if (g.kind === "entity") {
      const gt = tableOf(model, g.table);
      n.push({ kind: "group", en: `Per ${gt.label}`, tr: `${gt.labelTr} bazında` });
    } else if (g.kind === "column") {
      const c = tableOf(model, g.table).columns.find((x) => x.name === g.column)!;
      n.push({ kind: "group", en: `Per ${c.label.toLowerCase()}`, tr: `${c.labelTr} bazında` });
    } else if (g.kind === "time") {
      const tr = { day: "Günlük", week: "Haftalık", month: "Aylık", quarter: "Çeyreklik", year: "Yıllık" }[g.grain];
      n.push({ kind: "group", en: `By ${g.grain}`, tr });
    } else n.push({ kind: "group", en: `Side by side: ${g.ranges.map((r) => r.label).join(" vs ")}`, tr: `Karşılaştırma: ${g.ranges.map((r) => r.label).join(" - ")}` });
  }
  if (plan.averageGroups) n.push({ kind: "shape", en: "Average over the groups", tr: "Gruplar üzerinden ortalama" });
  if (plan.countGroups) n.push({ kind: "shape", en: "Counting the groups that match", tr: "Koşulu sağlayan grupların sayısı" });
  const filters = [...plan.filters, ...(plan.anti?.filters ?? [])];
  for (const f of filters) {
    const c = tableOf(model, f.table).columns.find((x) => x.name === f.column)!;
    if (f.kind === "value") n.push({ kind: "filter", en: `${c.label} ${f.negate ? "is not" : "is"} ${f.values.join(" or ")}`, tr: `${c.labelTr} ${f.values.join(" veya ")}${f.negate ? " değil" : ""}` });
    else if (f.kind === "like") n.push({ kind: "filter", en: `${c.label} contains “${f.text}”`, tr: `${c.labelTr} “${f.text}” içeriyor` });
    else if (f.kind === "compare") n.push({ kind: "filter", en: f.value2 !== undefined ? `${c.label} between ${fmt(f.value)} and ${fmt(f.value2)}` : `${c.label} ${OPS[f.op][0]} ${fmt(f.value)}`, tr: f.value2 !== undefined ? `${c.labelTr} ${fmt(f.value)} ile ${fmt(f.value2)} arasında` : `${c.labelTr} ${fmt(f.value)} ${OPS[f.op][1]}` });
    else if (f.kind === "date") {
      const span = f.from && f.to ? `${f.from} → ${f.to}` : f.from ? `from ${f.from}` : `until ${f.to}`;
      const spanTr = f.from && f.to ? `${f.from} → ${f.to}` : f.from ? `${f.from} sonrası` : `${f.to} öncesi`;
      n.push({ kind: "date", en: `${f.label}: ${c.label.toLowerCase()} ${span}`, tr: `${f.label}: ${c.labelTr.toLocaleLowerCase("tr")} ${spanTr}` });
    }
  }
  if (plan.having) {
    const l = measureLabel(model, plan.measures[0]);
    const h = plan.having;
    n.push({ kind: "filter", en: h.value2 !== undefined ? `${l.en} between ${fmt(h.value)} and ${fmt(h.value2)}` : `${l.en} ${OPS[h.op][0]} ${fmt(h.value)}`, tr: h.value2 !== undefined ? `${l.tr} ${fmt(h.value)} ile ${fmt(h.value2)} arasında` : `${l.tr} ${fmt(h.value)} ${OPS[h.op][1]}` });
  }
  if (plan.share) n.push({ kind: "shape", en: "With each row's share of the total", tr: "Her satırın toplamdaki payıyla" });
  if (plan.growth) n.push({ kind: "shape", en: "With the change from the previous period", tr: "Bir önceki döneme göre değişimle" });
  if (plan.order && plan.limit) {
    const top = plan.order.dir === "desc";
    n.push({ kind: "limit", en: `${top ? "Top" : "Bottom"} ${plan.limit}`, tr: `${top ? "İlk" : "Son"} ${plan.limit}` });
  } else if (plan.limit) n.push({ kind: "limit", en: `First ${plan.limit}`, tr: `İlk ${plan.limit}` });
  void ranges;
}

export type { Plan, Measure, Group, Filter, Having };
