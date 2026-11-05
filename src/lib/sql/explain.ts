import type { Model } from "../model";
import { splitStatements, tokenizeSql, type Tok } from "./tokens";

/**
 * Explains a SQL statement in plain English or Turkish, step by step, and flags mistakes:
 * deletes without WHERE, "= NULL", WHERE on aggregates, columns missing from GROUP BY, sums that
 * double count across a join, cartesian joins and the like. Works on any SQL, not only the SQL
 * the question box writes.
 */

export type Lang = "en" | "tr";
export interface Bi {
  en: string;
  tr: string;
}
export interface Step {
  title: Bi;
  detail: Bi;
  code?: string;
}
export interface Lint {
  level: "error" | "warning" | "info";
  en: string;
  tr: string;
  code?: string;
}
export interface Explanation {
  kind: "select" | "insert" | "update" | "delete" | "create" | "drop" | "alter" | "other";
  summary: Bi;
  steps: Step[];
  lints: Lint[];
}

const bi = (en: string, tr: string): Bi => ({ en, tr });
const text = (ts: Tok[]) => ts.map((t, i) => (i && needsSpace(ts[i - 1], t) ? " " : "") + t.text).join("");
function needsSpace(a: Tok, b: Tok) {
  if (a.text === "(" || b.text === ")" || b.text === "," || b.text === "." || a.text === ".") return false;
  if (b.text === "(" && (a.kind === "ident" || a.kind === "kw") && !["IN", "AS", "AND", "OR", "EXISTS", "FROM", "JOIN", "ON", "NOT", "OVER", "VALUES"].includes(a.v)) return false;
  return true;
}

/** Top-level slices of a token list split at a predicate, at the depth of the first token. */
function splitTop(ts: Tok[], at: (t: Tok, i: number) => boolean): Tok[][] {
  if (!ts.length) return [];
  const d = Math.min(...ts.map((t) => t.depth));
  const out: Tok[][] = [[]];
  ts.forEach((t, i) => {
    if (t.depth === d && at(t, i)) out.push([]);
    else out[out.length - 1].push(t);
  });
  return out.filter((x) => x.length);
}

interface Source {
  table: string | null;
  alias: string;
  sub: boolean;
  join: string | null;
  on: Tok[];
}

interface Select {
  distinct: boolean;
  items: Array<{ expr: Tok[]; alias: string | null }>;
  sources: Source[];
  where: Tok[];
  groupBy: Tok[][];
  having: Tok[];
  orderBy: Array<{ expr: Tok[]; dir: "ASC" | "DESC" }>;
  limit: Tok[];
  offset: Tok[];
  ctes: string[];
  compound: string[];
}

const CLAUSES = ["SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "WINDOW"];

function parseSelect(all: Tok[]): Select {
  let ts = all.filter((t) => t.kind !== "comment");
  const base = Math.min(...ts.map((t) => t.depth));
  const ctes: string[] = [];
  if (ts[0]?.v === "WITH") {
    // WITH a AS (...), b AS (...) SELECT ...
    let i = 1;
    if (ts[i]?.v === "RECURSIVE") i++;
    while (i < ts.length) {
      if (ts[i].kind === "ident") ctes.push(ts[i].v);
      let j = i;
      while (j < ts.length && !(ts[j].depth === base && ts[j].text === ")")) j++;
      i = j + 1;
      if (ts[i]?.text === ",") i++;
      else break;
    }
    ts = ts.slice(i);
  }
  // UNION / EXCEPT / INTERSECT: explain the first part, mention the rest.
  const compound: string[] = [];
  const cut = ts.findIndex((t) => t.depth === base && ["UNION", "EXCEPT", "INTERSECT"].includes(t.v));
  if (cut > 0) {
    for (const t of ts.slice(cut)) if (t.depth === base && ["UNION", "EXCEPT", "INTERSECT"].includes(t.v)) compound.push(t.v);
    ts = ts.slice(0, cut);
  }
  const at: Record<string, number> = {};
  ts.forEach((t, i) => {
    if (t.depth === base && t.kind === "kw" && CLAUSES.includes(t.v) && at[t.v] === undefined) at[t.v] = i;
  });
  const clause = (k: string) => {
    if (at[k] === undefined) return [];
    const next = Object.values(at).filter((x) => x > at[k]).sort((a, b) => a - b)[0] ?? ts.length;
    let start = at[k] + 1;
    if ((k === "GROUP" || k === "ORDER") && ts[start]?.v === "BY") start++;
    return ts.slice(start, next);
  };
  let sel = clause("SELECT");
  const distinct = sel[0]?.v === "DISTINCT";
  if (distinct || sel[0]?.v === "ALL") sel = sel.slice(1);
  const items = splitTop(sel, (t) => t.text === ",").map((expr) => {
    const n = expr.length;
    if (n >= 3 && expr[n - 2].v === "AS") return { expr: expr.slice(0, n - 2), alias: expr[n - 1].v };
    if (n >= 2 && (expr[n - 1].kind === "ident" || expr[n - 1].kind === "string") && expr[n - 2].text !== "." && !["*", "(", ","].includes(expr[n - 2].text) && expr[n - 2].kind !== "op") return { expr: expr.slice(0, n - 1), alias: expr[n - 1].v };
    return { expr, alias: null };
  });
  return {
    distinct,
    items,
    sources: parseFrom(clause("FROM")),
    where: clause("WHERE"),
    groupBy: splitTop(clause("GROUP"), (t) => t.text === ","),
    having: clause("HAVING"),
    orderBy: splitTop(clause("ORDER"), (t) => t.text === ",").map((e) => {
      const last = e[e.length - 1];
      if (last?.v === "DESC" || last?.v === "ASC") return { expr: e.slice(0, -1), dir: last.v as "ASC" | "DESC" };
      return { expr: e, dir: "ASC" as const };
    }),
    limit: clause("LIMIT"),
    offset: clause("OFFSET"),
    ctes,
    compound,
  };
}

function parseFrom(ts: Tok[]): Source[] {
  if (!ts.length) return [];
  const base = Math.min(...ts.map((t) => t.depth));
  const out: Source[] = [];
  let i = 0;
  let join: string | null = null;
  while (i < ts.length) {
    const t = ts[i];
    if (t.depth === base && t.kind === "kw" && ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "OUTER"].includes(t.v)) {
      const words: string[] = [];
      while (i < ts.length && ts[i].depth === base && ["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "OUTER"].includes(ts[i].v)) words.push(ts[i++].v);
      join = words.join(" ");
      continue;
    }
    if (t.text === ",") {
      join = ",";
      i++;
      continue;
    }
    let table: string | null = null;
    let sub = false;
    if (t.text === "(") {
      sub = true;
      let j = i + 1;
      while (j < ts.length && !(ts[j].depth === base && ts[j].text === ")")) j++;
      i = j + 1;
    } else {
      table = t.v;
      i++;
      if (ts[i]?.text === "." && ts[i + 1]) {
        table = ts[i + 1].v;
        i += 2;
      }
    }
    let alias = table ?? "subquery";
    if (ts[i]?.v === "AS") i++;
    if (ts[i] && ts[i].kind === "ident" && ts[i].depth === base) alias = ts[i++].v;
    const on: Tok[] = [];
    if (ts[i]?.v === "ON" || ts[i]?.v === "USING") {
      i++;
      while (i < ts.length && !(ts[i].depth === base && (["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL"].includes(ts[i].v) || ts[i].text === ","))) on.push(ts[i++]);
    }
    out.push({ table, alias, sub, join: out.length ? (join ?? "JOIN") : null, on });
    join = null;
  }
  return out;
}

/** Labels for columns and tables from the semantic model, when it knows them. */
function labeler(model: Model | null, sources: Source[], lang: Lang) {
  const byAlias = new Map(sources.map((s) => [s.alias, s.table]));
  const tableLabel = (t: string | null) => {
    if (!t) return lang === "tr" ? "alt sorgu" : "a subquery";
    const m = model?.tables.find((x) => x.name === t);
    return m ? (lang === "tr" ? `${m.labelTr} (${t})` : t) : t;
  };
  const col = (qual: string | null, name: string) => {
    const t = qual ? (byAlias.get(qual) ?? qual) : sources.find((s) => s.table && model?.tables.find((x) => x.name === s.table)?.columns.some((c) => c.name === name))?.table;
    const m = t ? model?.tables.find((x) => x.name === t)?.columns.find((c) => c.name === name) : undefined;
    if (!m) return name.replace(/_/g, " ");
    return (lang === "tr" ? m.labelTr : m.label).toLocaleLowerCase(lang === "tr" ? "tr" : "en");
  };
  return { tableLabel, col };
}

const FN: Record<string, [string, string]> = {
  SUM: ["total of", "toplamı:"],
  AVG: ["average", "ortalama"],
  MIN: ["lowest", "en düşük"],
  MAX: ["highest", "en yüksek"],
  LOWER: ["lower-case", "küçük harfli"],
  UPPER: ["upper-case", "büyük harfli"],
  ABS: ["absolute value of", "mutlak değeri:"],
  LENGTH: ["length of", "uzunluğu:"],
  TOTAL: ["total of", "toplamı:"],
};

/** Describes an expression in words where it can, falling back to the SQL itself. */
function describeExpr(ts: Tok[], L: ReturnType<typeof labeler>, lang: Lang): string {
  const tr = lang === "tr";
  const toks = ts.filter((t) => t.kind !== "comment");
  if (!toks.length) return "";
  const d = Math.min(...toks.map((t) => t.depth));
  // Strip outer parentheses.
  if (toks[0].text === "(" && toks[toks.length - 1].text === ")" && toks.slice(1, -1).every((t) => t.depth > d)) return describeExpr(toks.slice(1, -1), L, lang);
  // Binary arithmetic at the top level.
  for (const [op, en, trw] of [["-", "minus", "eksi"], ["+", "plus", "artı"], ["/", "divided by", "bölü"], ["*", "times", "çarpı"]] as const) {
    const idx = toks.map((t, i) => (t.depth === d && t.text === op && i > 0 ? i : -1)).filter((i) => i > 0).pop();
    if (idx !== undefined) {
      const a = toks.slice(0, idx);
      const b = toks.slice(idx + 1);
      // julianday(a) - julianday(b): days between
      if (op === "-" && a[0]?.v === "julianday" && b[0]?.v === "julianday") return tr ? `${describeExpr(b.slice(2, -1), L, lang)} ile ${describeExpr(a.slice(2, -1), L, lang)} arasındaki gün` : `days from ${describeExpr(b.slice(2, -1), L, lang)} to ${describeExpr(a.slice(2, -1), L, lang)}`;
      return `${describeExpr(a, L, lang)} ${tr ? trw : en} ${describeExpr(b, L, lang)}`;
    }
  }
  if (toks.length === 1) {
    const t = toks[0];
    if (t.text === "*") return tr ? "tüm sütunlar" : "every column";
    if (t.kind === "string") return `'${t.v}'`;
    if (t.kind === "number") return t.text;
    if (t.kind === "ident") return L.col(null, t.v);
    return t.text;
  }
  if (toks.length === 3 && toks[1].text === ".") return toks[2].text === "*" ? (tr ? `${L.tableLabel(toks[0].v)} tüm sütunları` : `every column of ${toks[0].v}`) : L.col(toks[0].v, toks[2].v);
  // Function call covering the whole expression.
  const f = toks[0];
  const closes = toks[toks.length - 1].text === ")" && toks[1]?.text === "(";
  const over = toks.findIndex((t) => t.v === "OVER" && t.depth === d);
  if ((f.kind === "ident" || f.kind === "kw") && toks[1]?.text === "(" && (closes || over > 0)) {
    const end = over > 0 ? over : toks.length;
    const inner = toks.slice(2, end - 1);
    const args = splitTop(inner, (t) => t.text === ",");
    const name = f.v.toUpperCase();
    const win = over > 0 ? (tr ? " (pencere: " : " (window: ") + text(toks.slice(over + 1)) + ")" : "";
    if (name === "COUNT") {
      if (inner.length === 1 && inner[0].text === "*") return (tr ? "satır sayısı" : "number of rows") + win;
      if (inner[0]?.v === "DISTINCT") return (tr ? `farklı ${describeExpr(inner.slice(1), L, lang)} sayısı` : `number of different ${describeExpr(inner.slice(1), L, lang)}`) + win;
      return (tr ? `${describeExpr(inner, L, lang)} dolu satır sayısı` : `number of rows with ${describeExpr(inner, L, lang)}`) + win;
    }
    if (name === "ROUND") return describeExpr(args[0] ?? [], L, lang) + (tr ? " (yuvarlanmış)" : " (rounded)");
    if (name === "COALESCE" || name === "IFNULL") return tr ? `${describeExpr(args[0] ?? [], L, lang)} (boşsa ${describeExpr(args[1] ?? [], L, lang)})` : `${describeExpr(args[0] ?? [], L, lang)} (or ${describeExpr(args[1] ?? [], L, lang)} when empty)`;
    if (name === "NULLIF") return describeExpr(args[0] ?? [], L, lang);
    if (name === "STRFTIME") {
      const fmt = args[0]?.[0]?.v ?? "";
      const what = describeExpr(args[1] ?? [], L, lang);
      const unit = fmt === "%Y-%m" ? ["month", "ayı"] : fmt === "%Y" ? ["year", "yılı"] : fmt.includes("%W") ? ["week", "haftası"] : fmt === "%m" ? ["month number", "ay numarası"] : ["formatted date", "biçimli tarihi"];
      return tr ? `${what} ${unit[1]}` : `${unit[0]} of ${what}`;
    }
    if (name === "DATE") return tr ? `${describeExpr(args[0] ?? [], L, lang)} günü` : `day of ${describeExpr(args[0] ?? [], L, lang)}`;
    if (name === "JULIANDAY") return describeExpr(args[0] ?? [], L, lang);
    if (name === "LAG" || name === "LEAD") return (tr ? `${name === "LAG" ? "önceki" : "sonraki"} satırın ${describeExpr(args[0] ?? [], L, lang)} değeri` : `${name === "LAG" ? "previous" : "next"} row's ${describeExpr(args[0] ?? [], L, lang)}`) + win;
    if (name === "ROW_NUMBER" || name === "RANK" || name === "DENSE_RANK") return (tr ? "sıra numarası" : "rank") + win;
    const fn = FN[name];
    if (fn) {
      const arg = inner[0]?.v === "DISTINCT" ? describeExpr(inner.slice(1), L, lang) : describeExpr(inner, L, lang);
      return (tr ? `${arg} ${fn[1].replace(/:$/, "")}` : `${fn[0]} ${arg}`) + win;
    }
  }
  if (f.v === "CASE") return tr ? "duruma göre değişen değer (CASE)" : "a value that depends on conditions (CASE)";
  if (f.v === "CAST") return describeExpr(toks.slice(2, toks.findIndex((t) => t.v === "AS")), L, lang);
  if (f.text === "(" && toks[1]?.v === "SELECT") return tr ? "alt sorgudan gelen değer" : "a value from a subquery";
  return text(toks);
}

/** A WHERE / HAVING / ON condition in words. */
function describeCond(ts: Tok[], L: ReturnType<typeof labeler>, lang: Lang): string {
  const tr = lang === "tr";
  const toks = ts.filter((t) => t.kind !== "comment");
  if (!toks.length) return "";
  const d = Math.min(...toks.map((t) => t.depth));
  if (toks[0].text === "(" && toks[toks.length - 1].text === ")" && toks.slice(1, -1).every((t) => t.depth > d)) {
    const inner = toks.slice(1, -1);
    if (inner.some((t) => t.depth === d + 1 && t.v === "OR")) return `(${splitTop(inner, (t) => t.v === "OR").map((p) => describeCond(p, L, lang)).join(tr ? " veya " : " or ")})`;
    return describeCond(inner, L, lang);
  }
  const ors = splitTop(toks, (t) => t.v === "OR");
  if (ors.length > 1) return ors.map((p) => describeCond(p, L, lang)).join(tr ? " veya " : " or ");
  const not = toks[0].v === "NOT";
  const body = not ? toks.slice(1) : toks;
  if (body[0]?.v === "EXISTS") {
    const from = body.findIndex((t) => t.v === "FROM");
    const table = from > 0 ? body[from + 1]?.v : "?";
    return tr ? `${L.tableLabel(table)} içinde eşleşen satır ${not ? "yok" : "var"}` : `there is ${not ? "no" : "a"} matching row in ${L.tableLabel(table)}`;
  }
  const at = (v: string) => body.findIndex((t) => t.depth === d && t.v === v);
  const opIdx = body.findIndex((t) => t.depth === d && t.kind === "op" && ["=", "==", "<>", "!=", "<", ">", "<=", ">="].includes(t.text));
  const between = at("BETWEEN");
  const inIdx = at("IN");
  const like = at("LIKE");
  const isIdx = at("IS");
  const isNot = (i: number) => body[i - 1]?.v === "NOT";
  if (between > 0) {
    const and = body.findIndex((t, i) => i > between && t.depth === d && t.v === "AND");
    const lhs = describeExpr(body.slice(0, isNot(between) ? between - 1 : between), L, lang);
    const a = describeExpr(body.slice(between + 1, and), L, lang);
    const b = describeExpr(body.slice(and + 1), L, lang);
    return tr ? `${lhs} ${a} ile ${b} arasında${isNot(between) ? " değil" : ""}` : `${lhs} is ${isNot(between) ? "not " : ""}between ${a} and ${b}`;
  }
  if (inIdx > 0) {
    const lhs = describeExpr(body.slice(0, isNot(inIdx) ? inIdx - 1 : inIdx), L, lang);
    const list = body.slice(inIdx + 1);
    if (list[1]?.v === "SELECT") return tr ? `${lhs} bir alt sorgunun sonuçları arasında${isNot(inIdx) ? " değil" : ""}` : `${lhs} is ${isNot(inIdx) ? "not " : ""}among the results of a subquery`;
    const vals = splitTop(list.slice(1, -1), (t) => t.text === ",").map((x) => describeExpr(x, L, lang));
    return tr ? `${lhs} ${vals.join(", ")} değerlerinden ${isNot(inIdx) ? "biri değil" : "biri"}` : `${lhs} is ${isNot(inIdx) ? "not " : ""}one of ${vals.join(", ")}`;
  }
  if (like > 0) {
    const lhs = describeExpr(body.slice(0, isNot(like) ? like - 1 : like), L, lang);
    const pat = body[like + 1]?.kind === "string" ? body[like + 1].v : text(body.slice(like + 1));
    const neg = isNot(like);
    const core = pat.replace(/^%|%$/g, "");
    const kind = pat.startsWith("%") && pat.endsWith("%") ? "contains" : pat.endsWith("%") ? "starts" : pat.startsWith("%") ? "ends" : "matches";
    const en = { contains: "contains", starts: "starts with", ends: "ends with", matches: "matches" }[kind];
    const trw = { contains: "içeriyor", starts: "ile başlıyor", ends: "ile bitiyor", matches: "kalıbına uyuyor" }[kind];
    return tr ? `${lhs} '${core}' ${trw}${neg ? " (değil)" : ""}` : `${lhs} ${neg ? "does not " + en.replace(/s$/, "").replace(/s with$/, " with") : en} '${core}'`;
  }
  if (isIdx > 0) {
    const lhs = describeExpr(body.slice(0, isIdx), L, lang);
    const neg = body[isIdx + 1]?.v === "NOT";
    return tr ? `${lhs} ${neg ? "dolu" : "boş"}` : `${lhs} ${neg ? "has a value" : "is empty"}`;
  }
  if (opIdx > 0) {
    const lhs = describeExpr(body.slice(0, opIdx), L, lang);
    const rhs = describeExpr(body.slice(opIdx + 1), L, lang);
    const op = body[opIdx].text;
    const date = /^'\d{4}-\d{2}/.test(rhs);
    const en: Record<string, string> = { "=": "is", "==": "is", "<>": "is not", "!=": "is not", "<": date ? "is before" : "is less than", ">": date ? "is after" : "is more than", "<=": date ? "is on or before" : "is at most", ">=": date ? "is on or after" : "is at least" };
    const trm: Record<string, string> = { "=": "", "==": "", "<>": " değil", "!=": " değil", "<": date ? " öncesi" : " altında", ">": date ? " sonrası" : " üzerinde", "<=": " veya altı", ">=": " veya üzeri" };
    const bothCols = body.slice(opIdx + 1).some((t) => t.kind === "ident") && body.slice(0, opIdx).some((t) => t.kind === "ident") && !body.slice(opIdx + 1).some((t) => t.kind === "string" || t.kind === "number");
    if (bothCols && (op === "=" || op === "==")) return tr ? `${lhs} = ${rhs}` : `${lhs} matches ${rhs}`;
    return tr ? `${lhs}: ${rhs}${trm[op]}` : `${lhs} ${en[op]} ${rhs}`;
  }
  return (not ? (tr ? "DEĞİL: " : "NOT ") : "") + text(body);
}

const AGG = new Set(["SUM", "AVG", "COUNT", "MIN", "MAX", "TOTAL", "GROUP_CONCAT"]);
const hasAgg = (ts: Tok[]) => ts.some((t, i) => AGG.has(t.v.toUpperCase()) && ts[i + 1]?.text === "(" && !ts.slice(i).some((x) => x.v === "OVER" && x.depth === t.depth));

/** Explains every statement in a script. */
export function explain(sql: string, model: Model | null): Explanation[] {
  return splitStatements(sql).map((s) => explainOne(s, model));
}

function explainOne(sql: string, model: Model | null): Explanation {
  const ts = tokenizeSql(sql).filter((t) => t.kind !== "comment");
  const lints: Lint[] = [];
  const first = ts[0]?.v ?? "";
  const lint = (level: Lint["level"], en: string, tr: string, code?: string) => lints.push({ level, en, tr, code });

  if (first === "DELETE" || first === "UPDATE") {
    const table = first === "DELETE" ? ts[ts.findIndex((t) => t.v === "FROM") + 1]?.v : ts[1]?.v;
    const where = ts.findIndex((t) => t.depth === 0 && t.v === "WHERE");
    if (where < 0) lint("error", `This ${first} has no WHERE: it changes every row in ${table}.`, `Bu ${first} WHERE içermiyor: ${table} tablosundaki tüm satırları etkiler.`);
    const cond = where > 0 ? describeCond(ts.slice(where + 1), labeler(model, [{ table: table ?? null, alias: table ?? "", sub: false, join: null, on: [] }], "en"), "en") : "";
    const condTr = where > 0 ? describeCond(ts.slice(where + 1), labeler(model, [{ table: table ?? null, alias: table ?? "", sub: false, join: null, on: [] }], "tr"), "tr") : "";
    nullCompare(ts, lint);
    return {
      kind: first === "DELETE" ? "delete" : "update",
      summary: first === "DELETE" ? bi(`Deletes rows from ${table}${where > 0 ? ` where ${cond}` : " (all of them)"}.`, `${table} tablosundan ${where > 0 ? `${condTr} olan` : "tüm"} satırları siler.`) : bi(`Changes rows in ${table}${where > 0 ? ` where ${cond}` : " (all of them)"}.`, `${table} tablosunda ${where > 0 ? `${condTr} olan` : "tüm"} satırları değiştirir.`),
      steps: [],
      lints,
    };
  }
  if (first === "INSERT" || first === "REPLACE") {
    const into = ts.findIndex((t) => t.v === "INTO");
    const table = ts[into + 1]?.v;
    const values = ts.findIndex((t) => t.v === "VALUES" && t.depth === 0);
    const rows = values < 0 ? 0 : ts.slice(values).filter((t) => t.depth === 0 && t.text === "(").length;
    const fromSelect = ts.some((t) => t.v === "SELECT");
    return { kind: "insert", summary: bi(`Adds ${fromSelect ? "the rows of a query" : `${rows} row${rows === 1 ? "" : "s"}`} to ${table}.`, `${table} tablosuna ${fromSelect ? "bir sorgunun satırlarını" : `${rows} satır`} ekler.`), steps: [], lints };
  }
  if (first === "DROP" || first === "TRUNCATE") {
    const name = ts[2]?.v === "IF" ? ts[4]?.v : ts[2]?.v;
    lint("error", `This permanently removes ${ts[1]?.v.toLowerCase()} ${name} and all of its data.`, `Bu, ${name} nesnesini ve tüm verisini kalıcı olarak siler.`);
    return { kind: "drop", summary: bi(`Removes ${ts[1]?.v.toLowerCase()} ${name}.`, `${name} nesnesini kaldırır.`), steps: [], lints };
  }
  if (first === "CREATE") {
    const k = ts[1]?.v === "UNIQUE" ? ts[2]?.v : ts[1]?.v;
    const name = ts.find((t, i) => i > 1 && t.kind === "ident")?.v;
    return { kind: "create", summary: bi(`Creates ${k?.toLowerCase()} ${name}.`, `${name} adlı ${k === "TABLE" ? "tablo" : k === "VIEW" ? "görünüm" : k === "INDEX" ? "indeks" : "nesne"} oluşturur.`), steps: [], lints };
  }
  if (first === "ALTER") return { kind: "alter", summary: bi(`Changes the structure of ${ts[2]?.v}.`, `${ts[2]?.v} tablosunun yapısını değiştirir.`), steps: [], lints };
  if (first !== "SELECT" && first !== "WITH" && first !== "VALUES") return { kind: "other", summary: bi(`A ${first || "SQL"} statement.`, `Bir ${first || "SQL"} komutu.`), steps: [], lints };

  const q = parseSelect(ts);
  const steps: Step[] = [];
  const L = { en: labeler(model, q.sources, "en"), tr: labeler(model, q.sources, "tr") };
  const both = (f: (L: ReturnType<typeof labeler>, lang: Lang) => string): Bi => bi(f(L.en, "en"), f(L.tr, "tr"));

  // FROM and JOINs
  if (q.ctes.length) steps.push({ title: bi("Named subqueries", "Adlı alt sorgular"), detail: bi(`First builds ${q.ctes.join(", ")} (WITH), then uses ${q.ctes.length > 1 ? "them" : "it"} like tables.`, `Önce ${q.ctes.join(", ")} sonucunu hazırlar (WITH), sonra tablo gibi kullanır.`) });
  if (q.sources.length) {
    const [base, ...joins] = q.sources;
    const en = [`Reads ${base.sub ? "a subquery" : base.table}${base.alias !== base.table && !base.sub ? ` (as ${base.alias})` : ""}`];
    const tr = [`${base.sub ? "Bir alt sorgunun sonucunu" : `${L.tr.tableLabel(base.table)} tablosunu`} okur${base.alias !== base.table && !base.sub ? ` (kısa adı ${base.alias})` : ""}`];
    for (const j of joins) {
      const left = j.join?.includes("LEFT");
      // Join conditions read best as written: c.id = i.customer_id
      const on = j.on.length ? text(j.on) : "";
      const onTr = on;
      en.push(`${left ? "adds" : "joins"} ${j.sub ? "a subquery" : j.table}${j.alias !== j.table ? ` (${j.alias})` : ""}${on ? ` on ${on}` : ""}${left ? ", keeping rows with no match" : ""}`);
      tr.push(`${j.sub ? "bir alt sorguyu" : `${L.tr.tableLabel(j.table)} tablosunu`} ${onTr ? `${onTr} koşuluyla ` : ""}${left ? "ekler (eşleşmeyen satırlar da kalır)" : "birleştirir"}`);
      if (!j.on.length && j.join !== "NATURAL" && !j.join?.includes("CROSS")) lint("warning", `${j.table ?? "A subquery"} is joined with no ON condition: every row pairs with every other row.`, `${j.table ?? "Alt sorgu"} ON koşulu olmadan birleşiyor: her satır diğer her satırla eşleşir.`);
      if (j.join === "CROSS" || j.join === ",") if (!q.where.length) lint("warning", `${j.table} is cross joined with no condition: the result has rows × rows.`, `${j.table} koşulsuz çapraz birleştiriliyor: sonuç satır × satır kadar büyür.`);
    }
    const fromAt = ts.findIndex((t) => t.v === "FROM" && t.depth === ts[0].depth);
    const endAt = ts.findIndex((t, i) => i > fromAt && t.depth === ts[0].depth && ["WHERE", "GROUP", "HAVING", "ORDER", "LIMIT"].includes(t.v));
    steps.push({ title: bi("Data", "Veri"), detail: bi(en.join(", ") + ".", tr.join("; ") + "."), code: fromAt >= 0 ? text(ts.slice(fromAt, endAt < 0 ? undefined : endAt)) : undefined });
  }
  // WHERE
  if (q.where.length) {
    const parts = splitTop(q.where, (t, i) => t.v === "AND" && !q.where.slice(0, i).reverse().slice(0, 4).some((x) => x.v === "BETWEEN" && x.depth === t.depth && !q.where.slice(q.where.indexOf(x) + 1, i).some((y) => y.v === "AND" && y.depth === t.depth)));
    steps.push({ title: bi("Filter rows", "Satırları süz"), detail: both((L, lang) => (lang === "tr" ? "Şu koşulları sağlayan satırları tutar: " : "Keeps rows where ") + parts.map((p) => describeCond(p, L, lang)).join(lang === "tr" ? "; " : "; and ") + "."), code: text(q.where) });
    if (hasAgg(q.where)) lint("error", "WHERE runs before grouping, so it can't use SUM/COUNT/AVG. Move that condition to HAVING.", "WHERE gruplamadan önce çalışır; SUM/COUNT/AVG kullanamaz. O koşulu HAVING'e taşıyın.");
    const top = Math.min(...q.where.map((t) => t.depth));
    if (q.where.some((t) => t.depth === top && t.v === "OR") && q.where.some((t) => t.depth === top && t.v === "AND" && !q.where.some((b) => b.v === "BETWEEN")))
      lint("warning", "AND and OR are mixed without parentheses. AND binds first, which is often not what was meant.", "AND ile OR parantezsiz karışık. Önce AND uygulanır; çoğu zaman istenen bu değildir.");
    if (q.where.some((t, i) => t.v === "LIKE" && q.where[i + 1]?.kind === "string" && q.where[i + 1].v.startsWith("%")))
      lint("info", "LIKE '%…' can't use an index, so it scans every row. Fine here, slow on big tables.", "LIKE '%…' indeks kullanamaz, tüm satırları tarar. Burada sorun değil; büyük tablolarda yavaşlar.");
    const notInSub = q.where.findIndex((t, i) => t.v === "NOT" && q.where[i + 1]?.v === "IN" && q.where[i + 3]?.v === "SELECT");
    if (notInSub >= 0) lint("warning", "NOT IN (SELECT …) returns nothing if the subquery yields a NULL. NOT EXISTS is safer.", "Alt sorgu NULL döndürürse NOT IN (SELECT …) hiç satır getirmez. NOT EXISTS daha güvenli.");
    for (let i = 0; i < q.where.length - 2; i++) {
      const a = q.where[i];
      if (a.kind === "ident" && q.where[i + 1]?.kind === "op" && q.where[i + 2]?.kind === "string" && /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(q.where[i + 2].v))
        lint("warning", `'${q.where[i + 2].v}' is not in YYYY-MM-DD form. Dates here are stored as text like '2026-03-01', so this comparison is alphabetical and wrong.`, `'${q.where[i + 2].v}' YYYY-AA-GG biçiminde değil. Tarihler '2026-03-01' gibi metin olarak saklanıyor; bu karşılaştırma alfabetik yapılır ve yanlış olur.`);
    }
  }
  // Grouping and measures
  const aggItems = q.items.filter((it) => hasAgg(it.expr));
  if (q.groupBy.length) {
    steps.push({ title: bi("Group", "Grupla"), detail: both((L, lang) => (lang === "tr" ? "Satırları şuna göre gruplar: " : "Makes one row per ") + q.groupBy.map((g) => describeExpr(g, L, lang)).join(lang === "tr" ? ", " : " and ") + "."), code: q.groupBy.map(text).join(", ") });
    // Non-aggregated columns not in GROUP BY
    const groupTexts = new Set(q.groupBy.map((g) => text(g).toLowerCase()));
    const groupCols = new Set(q.groupBy.map((g) => g[g.length - 1]?.v));
    // Grouping by a table's primary key fixes every other column of that table (as in PostgreSQL).
    const keyed = new Set<string>();
    for (const g of q.groupBy) {
      const alias = g.length === 3 && g[1].text === "." ? g[0].v.toLowerCase() : g.length === 1 && q.sources.length === 1 ? q.sources[0].alias.toLowerCase() : null;
      const col = g[g.length - 1]?.v.toLowerCase();
      const src = alias ? q.sources.find((x) => x.alias.toLowerCase() === alias && !x.sub) : null;
      const tm = src && model?.tables.find((t) => t.name.toLowerCase() === src.table!.toLowerCase());
      if (src && (tm ? tm.columns.some((c) => c.name.toLowerCase() === col && c.role === "id") : col === "id")) keyed.add(alias!);
    }
    const fixed = (expr: Tok[]) => expr.every((t, i) => t.kind !== "ident" || expr[i + 1]?.text === "(" || (expr[i + 1]?.text === "." && keyed.has(t.v.toLowerCase())) || (expr[i - 1]?.text === "." && keyed.has(expr[i - 2]?.v.toLowerCase())) || (q.sources.length === 1 && keyed.size > 0));
    for (const it of q.items) {
      if (hasAgg(it.expr) || it.expr.some((t) => t.v === "OVER") || (keyed.size && fixed(it.expr))) continue;
      const tx = text(it.expr).toLowerCase();
      if (groupTexts.has(tx) || (it.alias && groupTexts.has(it.alias)) || it.expr.every((t) => t.kind !== "ident" || groupCols.has(t.v) || t.kind === "ident" && it.expr[it.expr.indexOf(t) + 1]?.text === ".")) continue;
      const col = it.expr.filter((t) => t.kind === "ident" && it.expr[it.expr.indexOf(t) + 1]?.text !== "(" && it.expr[it.expr.indexOf(t) + 1]?.text !== ".").map((t) => t.v);
      if (col.length && col.some((c) => !groupCols.has(c)))
        lint("warning", `${text(it.expr)} is neither grouped nor aggregated. SQLite picks a value from an arbitrary row; other databases reject it.`, `${text(it.expr)} ne gruplanmış ne de toplanmış. SQLite rastgele bir satırdan değer alır; diğer veritabanları hata verir.`);
    }
  } else if (aggItems.length && aggItems.length < q.items.length) {
    const bare = q.items.filter((it) => !aggItems.includes(it) && it.expr.some((t) => t.kind === "ident") && !it.expr.some((t) => t.v === "OVER"));
    if (bare.length) lint("warning", `${bare.map((b) => text(b.expr)).join(", ")} sits next to a SUM/COUNT without GROUP BY, so the result is one row with a value from an arbitrary row.`, `${bare.map((b) => text(b.expr)).join(", ")}, GROUP BY olmadan bir SUM/COUNT yanında duruyor; sonuç tek satır ve değer rastgele bir satırdan gelir.`);
  }
  const outputs = q.items.map((it) => ({ en: `${it.alias ? `${it.alias}: ` : ""}${describeExpr(it.expr, L.en, "en")}`, tr: `${it.alias ? `${it.alias}: ` : ""}${describeExpr(it.expr, L.tr, "tr")}` }));
  steps.push({ title: bi("Columns", "Sütunlar"), detail: bi(`${q.distinct ? "Returns distinct rows of " : "Returns "}${outputs.map((o) => o.en).join("; ")}.`, `${q.distinct ? "Tekrarsız olarak " : ""}Döndürdüğü sütunlar: ${outputs.map((o) => o.tr).join("; ")}.`) });
  if (q.items.some((it) => it.expr.length === 1 && it.expr[0].text === "*") && q.sources.length > 1) lint("info", "SELECT * with joins returns every column of every table, including duplicates like id. Name the columns you need.", "Birleştirmeli sorguda SELECT * her tablonun tüm sütunlarını (id gibi tekrarlar dahil) getirir. Gereken sütunları yazın.");
  // HAVING
  if (q.having.length) {
    steps.push({ title: bi("Filter groups", "Grupları süz"), detail: both((L, lang) => (lang === "tr" ? "Şu koşulu sağlayan grupları tutar: " : "Keeps groups where ") + describeCond(q.having, L, lang) + "."), code: text(q.having) });
    if (!q.groupBy.length) lint("info", "HAVING without GROUP BY treats the whole result as one group.", "GROUP BY olmadan HAVING tüm sonucu tek grup sayar.");
  }
  // ORDER, LIMIT
  if (q.orderBy.length) steps.push({ title: bi("Sort", "Sırala"), detail: both((L, lang) => (lang === "tr" ? "Sıralama: " : "Sorts by ") + q.orderBy.map((o) => `${describeExpr(o.expr, L, lang)} ${o.dir === "DESC" ? (lang === "tr" ? "(büyükten küçüğe)" : "(highest first)") : lang === "tr" ? "(küçükten büyüğe)" : "(lowest first)"}`).join(", ") + ".") });
  if (q.limit.length) steps.push({ title: bi("Limit", "Sınır"), detail: bi(`Returns at most ${text(q.limit)} row${text(q.limit) === "1" ? "" : "s"}${q.offset.length ? `, skipping the first ${text(q.offset)}` : ""}.`, `En fazla ${text(q.limit)} satır döndürür${q.offset.length ? `; ilk ${text(q.offset)} satırı atlar` : ""}.`) });
  if (q.limit.length && !q.orderBy.length) lint("info", "LIMIT without ORDER BY returns whichever rows come first, which can change between runs.", "ORDER BY olmadan LIMIT, ilk gelen satırları döndürür; sonuç çalıştırmadan çalıştırmaya değişebilir.");
  if (q.compound.length) steps.push({ title: bi("Combine", "Birleştir"), detail: bi(`Then combines this with ${q.compound.length} more quer${q.compound.length > 1 ? "ies" : "y"} (${q.compound.join(", ")}).`, `Sonra bunu ${q.compound.length} sorguyla daha birleştirir (${q.compound.join(", ")}).`) });

  // Window functions
  const windows: Bi[] = [];
  for (const it of q.items) {
    const over = it.expr.findIndex((t) => t.v === "OVER");
    if (over < 0) continue;
    // The function the OVER belongs to: the call that closes right before it, even inside ROUND(…).
    const close = it.expr[over - 1];
    let open = over - 2;
    while (open >= 0 && !(it.expr[open].text === "(" && it.expr[open].depth === close?.depth)) open--;
    const fn = (close?.text === ")" && open > 0 ? it.expr[open - 1].v : "").toUpperCase();
    const ordered = it.expr.slice(over).some((t) => t.v === "ORDER");
    const name = it.alias ? ` (${it.alias})` : "";
    const w =
      fn === "RANK" || fn === "DENSE_RANK" || fn === "ROW_NUMBER" ? bi(`a rank${name}`, `sıra numarası${name}`)
      : fn === "LAG" ? bi(`the previous row's value${name}`, `önceki satırın değeri${name}`)
      : fn === "LEAD" ? bi(`the next row's value${name}`, `sonraki satırın değeri${name}`)
      : fn === "SUM" ? (ordered ? bi(`a running total${name}`, `kümülatif toplam${name}`) : bi(`a total over each partition${name}`, `bölüm toplamı${name}`))
      : fn === "AVG" && ordered ? bi(`a moving average${name}`, `hareketli ortalama${name}`)
      : fn === "NTILE" ? bi(`a bucket number${name}`, `dilim numarası${name}`)
      : bi(`a window calculation${name}`, `pencere hesabı${name}`);
    if (!windows.some((x) => x.en === w.en)) windows.push(w);
  }
  if (windows.length)
    steps.push({ title: bi("Window functions", "Pencere fonksiyonları"), detail: bi(`Computes ${windows.map((w) => w.en).join(", ")} across rows, without collapsing them.`, `Satırları birleştirmeden ${windows.map((w) => w.tr).join(", ")} hesaplar.`) });

  nullCompare(ts, lint);
  fanOut(q, model, lint);
  integerDivision(ts, model, q, lint);

  // Summary
  const ctes = new Set(q.ctes.map((c) => c.toLowerCase()));
  const tables = q.sources.filter((s) => !s.sub).map((s) => (ctes.has(s.table!.toLowerCase()) ? `${s.table} (WITH)` : s.table!));
  const groups = q.groupBy.length ? both((L, lang) => q.groupBy.map((g) => describeExpr(g, L, lang)).join(lang === "tr" ? " ve " : " and ")) : null;
  const measures = aggItems.length ? both((L, lang) => aggItems.map((it) => it.alias ?? describeExpr(it.expr, L, lang)).join(", ")) : null;
  const summary = bi(
    `${measures ? `Computes ${measures.en}` : `Lists ${q.items.length === 1 && q.items[0].expr[0]?.text === "*" ? "rows" : outputs.length + " column" + (outputs.length > 1 ? "s" : "")}`}${groups ? ` for each ${groups.en}` : ""} from ${tables.length ? tables.join(" + ") : "a subquery"}${q.where.length ? ", after filtering" : ""}${q.limit.length ? `, top ${text(q.limit)}` : ""}${windows.length ? `, with ${windows.map((w) => w.en).join(" and ")}` : ""}.`,
    `${tables.length ? tables.join(" + ") : "Alt sorgu"} verisinden${q.where.length ? " süzdükten sonra" : ""} ${groups ? `${groups.tr} bazında ` : ""}${measures ? `${measures.tr} hesaplar` : "satırları listeler"}${q.limit.length ? ` (ilk ${text(q.limit)})` : ""}${windows.length ? `; ${windows.map((w) => w.tr).join(" ve ")} ekler` : ""}.`,
  );
  return { kind: "select", summary, steps, lints };
}

function nullCompare(ts: Tok[], lint: (l: Lint["level"], en: string, tr: string) => void) {
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i].kind === "op" && ["=", "<>", "!=", "=="].includes(ts[i].text) && ts[i + 1].v === "NULL") {
      lint("error", `"${ts[i].text} NULL" is never true. Use IS ${ts[i].text === "=" || ts[i].text === "==" ? "" : "NOT "}NULL.`, `"${ts[i].text} NULL" hiçbir zaman doğru olmaz. IS ${ts[i].text === "=" || ts[i].text === "==" ? "" : "NOT "}NULL kullanın.`);
      return;
    }
  }
}

/** SUM of a parent table's column while joined to its child table counts the parent once per child row. */
function fanOut(q: Select, model: Model | null, lint: (l: Lint["level"], en: string, tr: string) => void) {
  if (!model || q.sources.length < 2) return;
  const byAlias = new Map(q.sources.map((s) => [s.alias, s.table]));
  const tables = new Set(q.sources.map((s) => s.table).filter(Boolean) as string[]);
  for (const it of q.items) {
    const ts = it.expr;
    for (let i = 0; i < ts.length; i++) {
      const fn = ts[i].v.toUpperCase();
      if (!["SUM", "AVG", "TOTAL"].includes(fn) || ts[i + 1]?.text !== "(") continue;
      // First column reference inside.
      const ref = ts.slice(i + 2).find((t, k, arr) => t.kind === "ident" && arr[k + 1]?.text === ".");
      const t = ref ? byAlias.get(ref.v) : null;
      if (!t) continue;
      const child = model.relations.find((r) => r.to.table === t && tables.has(r.from.table));
      if (child && ts.slice(i).some((x) => x.v === "DISTINCT") === false) {
        lint("warning", `${fn}(${ref!.v}.…) adds up ${t} values, but ${child.from.table} is joined to ${t}: each ${t} row repeats once per ${child.from.table} row, so the total is inflated. Aggregate ${child.from.table} first or use EXISTS.`, `${fn}(${ref!.v}.…) ${t} değerlerini topluyor ama ${child.from.table} tablosu ${t} ile birleşmiş: her ${t} satırı her ${child.from.table} satırı için tekrarlanır ve toplam şişer. Önce ${child.from.table} tablosunu toplayın ya da EXISTS kullanın.`);
        return;
      }
    }
  }
}

function integerDivision(ts: Tok[], model: Model | null, q: Select, lint: (l: Lint["level"], en: string, tr: string) => void) {
  if (!model) return;
  const byAlias = new Map(q.sources.map((s) => [s.alias, s.table]));
  const isInt = (i: number) => {
    const t = ts[i];
    if (t?.kind === "number") return !t.text.includes(".");
    if (t?.kind === "ident" && ts[i - 1]?.text === "." && ts[i - 2]) {
      const table = byAlias.get(ts[i - 2].v);
      return model.tables.find((x) => x.name === table)?.columns.find((c) => c.name === t.v)?.type === "integer";
    }
    return false;
  };
  for (let i = 1; i < ts.length - 1; i++) {
    if (ts[i].text !== "/" || ts[i].kind !== "op") continue;
    const right = ts[i + 1]?.kind === "ident" && ts[i + 2]?.text === "." ? i + 3 : i + 1;
    if (isInt(i - 1) && isInt(right) && ts[i - 1].text !== ")") {
      lint("warning", "Dividing two whole numbers drops the decimals in SQLite (7 / 2 = 3). Multiply by 1.0 first.", "SQLite'ta iki tam sayının bölümü ondalığı atar (7 / 2 = 3). Önce 1.0 ile çarpın.");
      return;
    }
  }
}

/** A friendlier message for a SQLite error, with a suggestion when a name is misspelled. */
export function explainError(message: string, model: Model | null): Bi {
  const m = /no such (column|table): ([\w.]+)/i.exec(message);
  if (m && model) {
    const want = m[2].split(".").pop()!.toLowerCase();
    const pool = m[1] === "table" ? model.tables.map((t) => t.name) : model.tables.flatMap((t) => t.columns.map((c) => `${c.name}`));
    const best = [...new Set(pool)].map((x) => ({ x, d: lev(x.toLowerCase(), want) })).sort((a, b) => a.d - b.d)[0];
    const hint = best && best.d <= Math.max(2, Math.floor(want.length / 3)) ? best.x : null;
    const where = m[1] === "column" && hint ? model.tables.filter((t) => t.columns.some((c) => c.name === hint)).map((t) => t.name).join(", ") : "";
    return bi(
      `There is no ${m[1]} called “${m[2]}”.${hint ? ` Did you mean “${hint}”${where ? ` (in ${where})` : ""}?` : ""}`,
      `“${m[2]}” adında bir ${m[1] === "table" ? "tablo" : "sütun"} yok.${hint ? ` “${hint}” mı demek istediniz${where ? ` (${where} içinde)` : ""}?` : ""}`,
    );
  }
  if (/syntax error/i.test(message)) {
    const near = /near "([^"]*)"/.exec(message)?.[1];
    return bi(`SQL syntax error${near ? ` near “${near}”` : ""}. Check commas, quotes and parentheses around it.`, `SQL söz dizimi hatası${near ? ` (“${near}” yakınında)` : ""}. Çevresindeki virgül, tırnak ve parantezleri kontrol edin.`);
  }
  if (/ambiguous column name: (\w+)/i.test(message)) {
    const c = /ambiguous column name: (\w+)/i.exec(message)![1];
    return bi(`“${c}” exists in more than one joined table. Write it with the table's alias, like c.${c}.`, `“${c}” birden fazla tabloda var. Tablo kısa adıyla yazın, örneğin c.${c}.`);
  }
  if (/misuse of aggregate/i.test(message)) return bi("An aggregate (SUM, COUNT…) is used where it can't be, usually in WHERE. Use HAVING.", "Toplama fonksiyonu (SUM, COUNT…) kullanılamayacağı yerde, çoğunlukla WHERE içinde. HAVING kullanın.");
  if (/FOREIGN KEY constraint failed/i.test(message)) return bi("Other rows still point at this row (a foreign key). Change or remove them first.", "Başka satırlar hâlâ bu satıra bağlı (yabancı anahtar). Önce onları değiştirin ya da silin.");
  return bi(message, message);
}

function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
