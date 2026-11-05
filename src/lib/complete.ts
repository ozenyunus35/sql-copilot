import type { Model } from "./model";
import { fold } from "./nl/text";
import { KEYWORDS, tokenizeSql } from "./sql/tokens";

export interface Suggestion {
  /** What gets inserted. */
  text: string;
  /** What is shown. */
  label: string;
  kind: "table" | "column" | "measure" | "value" | "date" | "keyword" | "function";
  detail?: string;
}

/** The word being typed at the caret, and where it starts. */
export function wordAt(text: string, caret: number): { word: string; start: number } {
  let s = caret;
  while (s > 0 && /[\p{L}\p{N}_'.-]/u.test(text[s - 1])) s--;
  return { word: text.slice(s, caret), start: s };
}

const DATES = {
  en: ["last month", "this month", "last quarter", "this quarter", "this year", "last year", "last 30 days", "last 6 months", "year to date"],
  tr: ["geçen ay", "bu ay", "geçen çeyrek", "bu çeyrek", "bu yıl", "geçen yıl", "son 30 gün", "son 6 ay", "yılbaşından beri"],
};

/** Suggestions for the question box: tables, measures, columns, values and dates that start with what's typed. */
export function suggestQuestion(text: string, caret: number, model: Model, lang: "en" | "tr", extra: string[] = []): { start: number; items: Suggestion[] } {
  // Phrases first: "ödeme sü" completes "ödeme süresi", "credit li" completes "credit limit".
  const before = text.slice(0, caret);
  for (const n of [3, 2]) {
    const m = new RegExp(`((?:[\\p{L}\\p{N}_'-]+\\s+){${n - 1}}[\\p{L}\\p{N}_'-]{1,})$`, "u").exec(before);
    if (!m) continue;
    const phrase = fold(m[1]);
    const single = suggestSingle(m[1], model, lang, extra, phrase);
    if (single.length) return { start: caret - m[1].length, items: single };
  }
  const { word, start } = wordAt(text, caret);
  if (fold(word).length < 2) return { start, items: [] };
  return { start, items: suggestSingle(word, model, lang, extra) };
}

function suggestSingle(word: string, model: Model, lang: "en" | "tr", extra: string[], phrase?: string): Suggestion[] {
  const w = fold(word);
  const items: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (s: Suggestion) => {
    const k = fold(s.text);
    if (seen.has(k) || k === w) return;
    seen.add(k);
    items.push(s);
  };
  const starts = (x: string) => (phrase ? fold(x).startsWith(phrase) || fold(x).includes(` ${phrase}`) : fold(x).startsWith(w) || fold(x).split(/\s+/).some((p) => p.startsWith(w) && w.length >= 3));
  for (const m of model.metrics) {
    const label = lang === "tr" ? m.labelTr : m.label;
    if (starts(label)) add({ text: label.toLocaleLowerCase(lang), label, kind: "measure", detail: lang === "tr" ? m.noteTr : m.note });
  }
  for (const t of model.tables) {
    const name = lang === "tr" ? t.labelTr : t.plural;
    if (starts(name) || starts(t.name)) add({ text: name, label: name, kind: "table", detail: `${t.rows.toLocaleString(lang === "tr" ? "tr-TR" : "en-US")} ${lang === "tr" ? "satır" : "rows"}` });
  }
  for (const t of model.tables)
    for (const c of t.columns) {
      if (c.role === "id" || c.role === "fk") continue;
      const label = (lang === "tr" ? c.labelTr : c.label).toLocaleLowerCase(lang);
      if (starts(label)) add({ text: label, label, kind: "column", detail: t.name });
    }
  for (const t of model.tables)
    for (const c of t.columns)
      for (const v of c.values ?? []) {
        if (items.length > 40) break;
        if (starts(v)) add({ text: v, label: v, kind: "value", detail: `${t.name}.${c.name}` });
      }
  for (const d of [...DATES[lang], ...DATES[lang === "tr" ? "en" : "tr"]]) if (starts(d)) add({ text: d, label: d, kind: "date" });
  for (const e of extra) if (starts(e)) add({ text: e, label: e, kind: "measure" });
  const rank = { measure: 0, table: 1, column: 2, date: 3, value: 4, keyword: 5, function: 6 } as const;
  items.sort((a, b) => Number(!fold(a.text).startsWith(w)) - Number(!fold(b.text).startsWith(w)) || rank[a.kind] - rank[b.kind] || a.text.length - b.text.length);
  return items.slice(0, 8);
}

const FUNCS = ["COUNT", "SUM", "AVG", "MIN", "MAX", "ROUND", "COALESCE", "STRFTIME", "DATE", "JULIANDAY", "LOWER", "UPPER", "LENGTH", "SUBSTR", "CAST", "NULLIF", "LAG", "LEAD", "ROW_NUMBER", "RANK", "IIF", "ABS"];

/** Suggestions for the SQL editor: columns after "alias.", otherwise keywords, tables, columns and functions. */
export function suggestSql(sql: string, caret: number, model: Model): { start: number; items: Suggestion[] } {
  const before = sql.slice(0, caret);
  const dot = /([A-Za-z_][\w]*)\.([\w]*)$/.exec(before);
  // Aliases declared in the statement: FROM invoices AS i, JOIN customers c
  const aliases = new Map<string, string>();
  const toks = tokenizeSql(sql);
  toks.forEach((t, i) => {
    if (t.kind !== "ident" || !model.tables.some((x) => x.name === t.v)) return;
    const prev = toks[i - 1]?.v;
    if (prev !== "FROM" && prev !== "JOIN" && toks[i - 1]?.text !== ",") return;
    let j = i + 1;
    if (toks[j]?.v === "AS") j++;
    if (toks[j]?.kind === "ident") aliases.set(toks[j].v, t.v);
    aliases.set(t.v, t.v);
  });
  if (dot) {
    const table = aliases.get(dot[1].toLowerCase()) ?? dot[1].toLowerCase();
    const t = model.tables.find((x) => x.name === table);
    const p = dot[2].toLowerCase();
    if (!t) return { start: caret, items: [] };
    return {
      start: caret - dot[2].length,
      items: t.columns.filter((c) => c.name.startsWith(p)).slice(0, 12).map((c) => ({ text: c.name, label: c.name, kind: "column" as const, detail: c.ref ? `→ ${c.ref.table}` : c.type })),
    };
  }
  const m = /([A-Za-z_][\w]*)$/.exec(before);
  if (!m) return { start: caret, items: [] };
  const w = m[1].toLowerCase();
  const start = caret - m[1].length;
  const items: Suggestion[] = [];
  const inStatement = new Set(aliases.values());
  for (const t of model.tables) if (t.name.startsWith(w)) items.push({ text: t.name, label: t.name, kind: "table", detail: `${t.rows.toLocaleString("en-US")} rows` });
  for (const t of model.tables)
    if (inStatement.has(t.name) || inStatement.size === 0)
      for (const c of t.columns) if (c.name.startsWith(w) && !items.some((x) => x.text === c.name)) items.push({ text: c.name, label: c.name, kind: "column", detail: t.name });
  for (const k of KEYWORDS) if (k.toLowerCase().startsWith(w) && k.length > w.length) items.push({ text: k, label: k, kind: "keyword" });
  for (const f of FUNCS) if (f.toLowerCase().startsWith(w)) items.push({ text: `${f}(`, label: `${f}()`, kind: "function" });
  // After FROM / JOIN a table name is expected; elsewhere columns come first.
  const lastKw = [...toks].reverse().find((t) => t.end <= start && t.kind === "kw")?.v;
  const wantsTable = lastKw === "FROM" || lastKw === "JOIN" || lastKw === "INTO" || lastKw === "UPDATE";
  const rank = wantsTable ? ({ table: 0, keyword: 1, column: 2, function: 3, measure: 4, value: 5, date: 6 } as const) : ({ column: 0, table: 1, function: 2, keyword: 3, measure: 4, value: 5, date: 6 } as const);
  items.sort((a, b) => rank[a.kind] - rank[b.kind] || a.text.length - b.text.length);
  return { start, items: items.slice(0, 10) };
}
