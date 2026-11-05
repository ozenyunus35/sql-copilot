import type { SqlJsStatic } from "sql.js";
import { Db } from "../db";
import type { ColType, ColumnModel, MetricModel, Model, Relation, Role, TableModel } from "../model";
import { fold, parseNumber } from "../nl/text";

/** A sheet or file as read: a name and rows of raw cells (strings, numbers, dates or empty). */
export interface RawTable {
  name: string;
  rows: Array<Array<string | number | boolean | Date | null>>;
  /** Where it came from, shown to the user: "sales.csv", "Book1.xlsx › Orders". */
  source: string;
}

export interface ImportNote {
  level: "info" | "warning";
  en: string;
  tr: string;
}

export const MAX_ROWS_PER_TABLE = 200_000;
export const MAX_COLUMNS = 200;

/** Common business words in English and Turkish, so an uploaded "tutar" column answers "amount". */
const SYNONYMS: string[][] = [
  ["customer", "customers", "client", "clients", "müşteri", "müşteriler", "cari"],
  ["order", "orders", "sipariş", "siparişler"],
  ["invoice", "invoices", "bill", "fatura", "faturalar"],
  ["product", "products", "item", "items", "ürün", "ürünler", "mal"],
  ["price", "prices", "fiyat", "birim fiyat", "unit price"],
  ["amount", "tutar", "miktar tutarı", "value", "değer"],
  ["total", "toplam", "grand total", "genel toplam"],
  ["quantity", "qty", "units", "adet", "miktar"],
  ["date", "tarih", "day", "gün"],
  ["country", "ülke"],
  ["city", "şehir", "il", "town"],
  ["region", "bölge", "area"],
  ["category", "kategori", "group", "grup"],
  ["status", "durum", "state"],
  ["name", "ad", "isim", "adı", "unvan", "title"],
  ["email", "e-mail", "e-posta", "eposta", "mail"],
  ["phone", "telefon", "tel"],
  ["sales", "satış", "satışlar", "revenue", "ciro", "gelir", "turnover", "income"],
  ["cost", "costs", "maliyet", "masraf"],
  ["expense", "expenses", "gider", "giderler", "harcama"],
  ["payment", "payments", "ödeme", "ödemeler", "tahsilat"],
  ["employee", "employees", "staff", "çalışan", "çalışanlar", "personel"],
  ["department", "dept", "departman", "bölüm"],
  ["salary", "salaries", "maaş", "ücret"],
  ["supplier", "vendor", "suppliers", "vendors", "tedarikçi", "satıcı"],
  ["store", "shop", "branch", "mağaza", "şube"],
  ["discount", "indirim", "iskonto"],
  ["tax", "vat", "vergi", "kdv"],
  ["profit", "kâr", "kar", "margin", "marj"],
  ["stock", "inventory", "stok", "envanter"],
  ["type", "kind", "tür", "tip", "çeşit"],
  ["description", "açıklama", "notes", "not"],
  ["code", "kod", "sku", "number", "numara", "no"],
  ["currency", "para birimi", "döviz"],
  ["method", "yöntem", "şekil"],
  ["due", "vade", "due date", "vade tarihi"],
  ["segment", "sector", "industry", "sektör"],
  ["brand", "marka"],
  ["channel", "kanal"],
  ["age", "yaş"],
  ["gender", "cinsiyet"],
  ["rating", "score", "puan", "skor"],
];

const MONEY = /(amount|total|price|cost|revenue|sales|income|salary|fee|balance|paid|spend|spent|budget|value|tutar|toplam|fiyat|maliyet|ciro|gelir|maas|ucret|bakiye|odenen|harcama|butce|deger|net|gross|brut|tax|vergi|kdv|discount_amount|profit|kar)$|^(amount|total|price|cost|revenue|sales|tutar|fiyat|ciro)/;
const QUANTITY = /(^|_)(qty|quantity|units|count|adet|miktar|pieces|stock|stok|items)($|_)/;
const PERCENT = /(pct|percent|percentage|rate|ratio|oran|yuzde|discount|indirim|margin|marj)/;
const NAMEISH = /(^|_)(name|title|ad|adi|isim|unvan|company|firma|customer|musteri|client|product|urun|vendor|supplier|tedarikci|employee|calisan|description|aciklama)($|_)/;
const CODEISH = /(^|_)(code|kod|sku|number|numara|no|ref|reference|invoice_no|order_no)($|_)/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

/** snake_case ASCII, unique among `taken`. */
export function sqlName(raw: string, taken: Set<string>, fallback: string): string {
  let n = fold(String(raw ?? ""))
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!n) n = fallback;
  if (/^\d/.test(n)) n = `c_${n}`;
  if (["select", "from", "where", "order", "group", "table", "index", "limit", "by", "and", "or", "not", "values", "default", "check", "primary", "references", "join", "on", "as", "case", "when", "end", "having", "union", "null", "is", "in", "to", "all", "transaction"].includes(n)) n = `${n}_`;
  let out = n;
  for (let i = 2; taken.has(out); i++) out = `${n}_${i}`;
  taken.add(out);
  return out;
}

const DATE_PATTERNS: Array<{ re: RegExp; order: "ymd" | "dmy" | "mdy" | "amb" }> = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/, order: "ymd" },
  { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})/, order: "ymd" },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, order: "dmy" },
  { re: /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, order: "amb" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Reads a date column's values, deciding day-first or month-first from the values themselves. */
function readDates(values: string[]): { ok: number; out: Array<string | null>; hasTime: boolean } | null {
  let dayFirst: boolean | null = null;
  for (const v of values) {
    const m = DATE_PATTERNS[3].re.exec(v);
    if (m) {
      if (Number(m[1]) > 12) dayFirst = true;
      else if (Number(m[2]) > 12) dayFirst = false;
    }
  }
  let ok = 0;
  let hasTime = false;
  const out = values.map((v) => {
    for (const p of DATE_PATTERNS) {
      const m = p.re.exec(v.trim());
      if (!m) continue;
      let y: number, mo: number, d: number;
      if (p.order === "ymd") [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else if (p.order === "dmy") [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else [d, mo, y] = dayFirst === false ? [Number(m[2]), Number(m[1]), Number(m[3])] : [Number(m[1]), Number(m[2]), Number(m[3])];
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1800 || y > 2200) return null;
      ok++;
      if (m[4] !== undefined) {
        hasTime = true;
        return `${y}-${pad(mo)}-${pad(d)} ${pad(Number(m[4]))}:${m[5]}:${m[6] ?? "00"}`;
      }
      return `${y}-${pad(mo)}-${pad(d)}`;
    }
    return null;
  });
  return { ok, out, hasTime };
}

interface ColumnPlan {
  name: string;
  label: string;
  type: ColType;
  values: Array<string | number | null>;
  bad: number;
}

/** Decides each column's type and converts its values. */
function planColumn(name: string, label: string, raw: Array<string | number | boolean | Date | null>): ColumnPlan {
  const vals = raw.map((v) => (v instanceof Date ? v : typeof v === "string" ? v.trim() : v));
  const present = vals.filter((v) => v !== null && v !== undefined && v !== "");
  const n = present.length || 1;
  // Real dates from Excel.
  if (present.length && present.every((v) => v instanceof Date)) {
    const hasTime = present.some((v) => (v as Date).getUTCHours() || (v as Date).getUTCMinutes());
    return { name, label, type: "date", bad: 0, values: vals.map((v) => (v instanceof Date ? (hasTime ? (v as Date).toISOString().slice(0, 19).replace("T", " ") : (v as Date).toISOString().slice(0, 10)) : null)) };
  }
  const strs = present.map((v) => (v instanceof Date ? v.toISOString() : String(v)));
  // Booleans
  const BOOL: Record<string, number> = { true: 1, false: 0, yes: 1, no: 0, evet: 1, hayir: 0, y: 1, n: 0, var: 1, yok: 0 };
  if (strs.length && strs.every((s) => fold(s) in BOOL)) return { name, label, type: "integer", bad: 0, values: vals.map((v) => (v === null || v === "" ? null : (BOOL[fold(String(v))] ?? null))) };
  // Dates first: "03.01.2025" would otherwise read as the number 3012025.
  const looksDated = strs.filter((s) => /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[./-]\d{1,2}[./-]\d{4}|^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)).length;
  if (looksDated / n >= 0.95) {
    const d = readDates(strs);
    if (d && d.ok / n >= 0.95) {
      let k = 0;
      const out = vals.map((v) => (v === null || v === "" || v === undefined ? null : d.out[k++]));
      return { name, label, type: "date", bad: n - d.ok, values: out };
    }
  }
  // Numbers (not codes with leading zeros, not phone numbers). (1,234.50) is negative, as accountants write it.
  const leadingZero = strs.some((s) => /^0\d+$/.test(s));
  const numeric = strs.map((raw) => {
    if (typeof raw === "number") return raw;
    const s = raw.replace(/^\((.*)\)$/, "$1").replace(/^-\s*/, "");
    return /^[+]?[$€£₺]?\s?[\d.,\s]+%?$|^[+]?[\d.,]+\s?(tl|usd|eur|try|\$|€|£|₺)$/i.test(s) ? parseNumber(s.replace(/^\+/, "").replace(/\s(?=\d)/g, "").replace(/(tl|usd|eur|try)$/i, "")) : null;
  });
  const neg = strs.map((s) => s.trim().startsWith("-") || /^\(.*\)$/.test(s.trim()));
  const okNum = numeric.filter((x) => x !== null).length;
  if (!leadingZero && okNum / n >= 0.95 && okNum > 0) {
    let k = 0;
    const out = vals.map((v) => {
      if (v === null || v === "" || v === undefined) return null;
      const x = typeof v === "number" ? v : numeric[k];
      const isNeg = typeof v === "number" ? false : neg[k];
      k++;
      return x === null ? null : isNeg ? -Math.abs(x) : x;
    });
    const ints = out.every((x) => x === null || Number.isInteger(x));
    return { name, label, type: ints ? "integer" : "real", bad: n - okNum, values: out };
  }
  // Dates as text
  const d = readDates(strs);
  if (d && d.ok / n >= 0.95) {
    let k = 0;
    const out = vals.map((v) => (v === null || v === "" || v === undefined ? null : d.out[k++]));
    return { name, label, type: "date", bad: n - d.ok, values: out };
  }
  return { name, label, type: "text", bad: 0, values: vals.map((v) => (v === null || v === "" || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))) };
}

/** Finds the header row: the first row that fills most columns with distinct, non-numeric text. */
function headerRow(rows: RawTable["rows"]): number {
  const width = Math.max(...rows.slice(0, 30).map((r) => r.filter((c) => c !== null && c !== "").length));
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].filter((c) => c !== null && c !== "");
    if (cells.length >= Math.max(1, Math.ceil(width * 0.6))) return i;
  }
  return 0;
}

export interface Imported {
  db: Db;
  model: Model;
  notes: ImportNote[];
  tables: Array<{ name: string; source: string; rows: number; columns: number }>;
}

/** Builds a SQLite database and its semantic model from raw sheets. */
export function importTables(SQL: SqlJsStatic, raws: RawTable[], today: string): Imported {
  const notes: ImportNote[] = [];
  const db = Db.create(SQL);
  const takenTables = new Set<string>();
  const built: Array<{ table: string; source: string; cols: ColumnPlan[]; rows: number }> = [];
  for (const raw of raws) {
    const rows = raw.rows.filter((r) => r.some((c) => c !== null && c !== ""));
    if (!rows.length) {
      notes.push({ level: "warning", en: `${raw.source} is empty and was skipped.`, tr: `${raw.source} boş, atlandı.` });
      continue;
    }
    const h = headerRow(rows);
    const header = rows[h];
    const body = rows.slice(h + 1);
    // A header row of numbers means there was no header.
    const noHeader = header.filter((c) => c !== null && c !== "").every((c) => typeof c === "number" || (typeof c === "string" && parseNumber(c) !== null));
    const data = noHeader ? rows.slice(h) : body;
    if (!data.length) {
      notes.push({ level: "warning", en: `${raw.source} has a header but no rows.`, tr: `${raw.source} başlık satırı içeriyor ama veri satırı yok.` });
      continue;
    }
    if (h > 0) notes.push({ level: "info", en: `${raw.source}: skipped ${h} line${h > 1 ? "s" : ""} above the header.`, tr: `${raw.source}: başlığın üstündeki ${h} satır atlandı.` });
    let width = Math.max(header.length, ...data.slice(0, 1000).map((r) => r.length));
    if (width > MAX_COLUMNS) {
      notes.push({ level: "warning", en: `${raw.source} has ${width} columns; only the first ${MAX_COLUMNS} were read.`, tr: `${raw.source} ${width} sütun içeriyor; ilk ${MAX_COLUMNS} sütun okundu.` });
      width = MAX_COLUMNS;
    }
    let rowsIn = data;
    if (data.length > MAX_ROWS_PER_TABLE) {
      notes.push({ level: "warning", en: `${raw.source} has ${data.length.toLocaleString("en-US")} rows; the first ${MAX_ROWS_PER_TABLE.toLocaleString("en-US")} were read.`, tr: `${raw.source} ${data.length.toLocaleString("tr-TR")} satır içeriyor; ilk ${MAX_ROWS_PER_TABLE.toLocaleString("tr-TR")} satır okundu.` });
      rowsIn = data.slice(0, MAX_ROWS_PER_TABLE);
    }
    const takenCols = new Set<string>();
    const cols: ColumnPlan[] = [];
    for (let j = 0; j < width; j++) {
      const label = noHeader ? `Column ${j + 1}` : String(header[j] ?? "").trim() || `Column ${j + 1}`;
      const name = sqlName(label, takenCols, `column_${j + 1}`);
      // Fully empty columns are dropped.
      const vals = rowsIn.map((r) => r[j] ?? null);
      if (vals.every((v) => v === null || v === "")) continue;
      const plan = planColumn(name, label, vals);
      if (plan.bad > 0) notes.push({ level: "warning", en: `${raw.source} › ${label}: ${plan.bad} value${plan.bad > 1 ? "s" : ""} could not be read as ${plan.type === "date" ? "dates" : "numbers"} and were left empty.`, tr: `${raw.source} › ${label}: ${plan.bad} değer ${plan.type === "date" ? "tarih" : "sayı"} olarak okunamadı ve boş bırakıldı.` });
      cols.push(plan);
    }
    if (!cols.length) continue;
    const table = sqlName(raw.name, takenTables, "table");
    const q = (s: string) => `"${s}"`;
    db.raw.exec(`CREATE TABLE ${q(table)} (${cols.map((c) => `${q(c.name)} ${c.type === "integer" ? "INTEGER" : c.type === "real" ? "REAL" : "TEXT"}`).join(", ")});`);
    const stmt = db.raw.prepare(`INSERT INTO ${q(table)} VALUES (${cols.map(() => "?").join(",")})`);
    db.raw.exec("BEGIN");
    for (let i = 0; i < rowsIn.length; i++) stmt.run(cols.map((c) => c.values[i] ?? null));
    db.raw.exec("COMMIT");
    stmt.free();
    built.push({ table, source: raw.source, cols, rows: rowsIn.length });
  }
  const model = inferModel(db, today, built.map((b) => ({ table: b.table, labels: Object.fromEntries(b.cols.map((c) => [c.name, c.label])), types: Object.fromEntries(b.cols.map((c) => [c.name, c.type])) })));
  return { db, model, notes, tables: built.map((b) => ({ name: b.table, source: b.source, rows: b.rows, columns: b.cols.length })) };
}

const singular = (w: string) => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("ses") || w.endsWith("xes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w.replace(/(lar|ler)$/, ""));
const plural = (w: string) => (w.endsWith("y") && !/[aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : w.endsWith("s") ? w : w + "s");

function synonymsFor(words: string): string[] {
  const f = fold(words);
  const parts = f.split(/[_\s]+/).filter(Boolean);
  const out = new Set<string>([f.replace(/_/g, " ")]);
  for (const group of SYNONYMS) {
    const g = group.map(fold);
    if (g.includes(f.replace(/_/g, " ")) || parts.some((p) => g.includes(p) || g.includes(singular(p)))) for (const s of g) out.add(s);
  }
  return [...out];
}

/** Infers what tables and columns mean, and how they relate, from names and values. */
export function inferModel(db: Db, today: string, meta: Array<{ table: string; labels?: Record<string, string>; types?: Record<string, ColType> }>): Model {
  const tables: TableModel[] = [];
  const relations: Relation[] = [];
  const metrics: MetricModel[] = [];
  const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;
  for (const m of meta) {
    const info = db.run(`PRAGMA table_info(${qi(m.table)})`).rows;
    const rows = Number(db.value(`SELECT COUNT(*) FROM ${qi(m.table)}`));
    const columns: ColumnModel[] = info.map((r) => {
      const name = String(r[1]);
      const declared = String(r[2]).toUpperCase();
      const type: ColType = m.types?.[name] ?? (declared.includes("INT") ? "integer" : declared.includes("REAL") || declared.includes("NUM") || declared.includes("DEC") || declared.includes("FLO") || declared.includes("DOUB") ? "real" : /DATE|TIME/.test(declared) ? "date" : "text");
      const label = m.labels?.[name] ?? name.replace(/_/g, " ");
      const f = fold(name);
      const distinct = Number(db.value(`SELECT COUNT(DISTINCT ${qi(name)}) FROM ${qi(m.table)}`) ?? 0);
      const nonNull = Number(db.value(`SELECT COUNT(${qi(name)}) FROM ${qi(m.table)}`) ?? 0);
      let role: Role = type === "date" ? "date" : type === "text" ? "text" : "number";
      // Dates stored as text in an uploaded SQLite file.
      if (type === "text" && nonNull) {
        const sample = db.run(`SELECT ${qi(name)} FROM ${qi(m.table)} WHERE ${qi(name)} IS NOT NULL LIMIT 50`).rows.map((x) => String(x[0]));
        if (sample.every((s) => /^\d{4}-\d{2}-\d{2}/.test(s))) role = "date";
        else if (sample.filter((s) => EMAIL.test(s)).length > sample.length * 0.8) role = "email";
      }
      if (role === "number") {
        if ((f === "id" || f === "rowid") && distinct === nonNull) role = "id";
        else if (/(^|_)id$/.test(f) || /_(no|code)$/.test(f) && type === "integer") role = "fk";
        else if (PERCENT.test(f)) role = "percent";
        else if (QUANTITY.test(f) && type === "integer") role = "quantity";
        else if (MONEY.test(f) || type === "real") role = "money";
        else if (distinct <= 2) role = "flag";
      } else if (role === "text") {
        if (/(^|_)id$/.test(f)) role = distinct === nonNull ? "code" : "fk";
        else if (CODEISH.test(f) && distinct > nonNull * 0.8) role = "code";
        else if (NAMEISH.test(f) && distinct > Math.min(30, nonNull * 0.3)) role = "name";
        else if (distinct <= Math.max(60, nonNull * 0.05) && distinct > 0) role = "category";
        else if (distinct > nonNull * 0.9 && !NAMEISH.test(f)) role = "text";
        else role = "category";
      }
      const c: ColumnModel = { table: m.table, name, type: role === "date" ? "date" : type, role, label, labelTr: label, terms: synonymsFor(label === name ? name : `${label}`).concat(synonymsFor(name)), distinct };
      if (role === "category" || role === "name" || role === "code") {
        if (distinct <= (role === "category" ? 300 : 2000)) c.values = db.run(`SELECT DISTINCT ${qi(name)} FROM ${qi(m.table)} WHERE ${qi(name)} IS NOT NULL ORDER BY 1 LIMIT 2000`).rows.map((x) => String(x[0])).filter((v) => v.length <= 80);
      }
      c.terms = [...new Set(c.terms)];
      return c;
    });
    const words = fold(m.table).split("_").filter(Boolean);
    const last = words[words.length - 1] ?? m.table;
    const label = [...words.slice(0, -1), singular(last)].join(" ");
    const plural_ = [...words.slice(0, -1), plural(singular(last))].join(" ");
    const money = columns.filter((c) => c.role === "money");
    const amountColumn = (money.find((c) => /(total|amount|revenue|sales|tutar|toplam|ciro)/.test(fold(c.name))) ?? money[0] ?? columns.find((c) => c.role === "quantity"))?.name;
    tables.push({
      name: m.table,
      label,
      plural: plural_,
      labelTr: label,
      terms: [...new Set([...synonymsFor(m.table), label, plural_, singular(last), plural(singular(last))])],
      pk: columns.find((c) => c.role === "id")?.name,
      nameColumn: columns.find((c) => c.role === "name")?.name,
      dateColumn: columns.find((c) => c.role === "date")?.name,
      amountColumn,
      listColumns: columns.filter((c) => c.role !== "id").slice(0, 8).map((c) => c.name),
      columns,
      rows,
    });
  }

  // Declared foreign keys (uploaded SQLite files) first.
  for (const t of tables) {
    for (const fk of db.run(`PRAGMA foreign_key_list(${qi(t.name)})`).rows) {
      const to = String(fk[2]);
      const toCol = fk[4] ? String(fk[4]) : (tables.find((x) => x.name === to)?.pk ?? "id");
      if (tables.some((x) => x.name === to)) relations.push({ from: { table: t.name, column: String(fk[3]) }, to: { table: to, column: toCol } });
    }
  }
  // Then by name: orders.customer_id -> customers.id, when the values line up.
  for (const t of tables) {
    for (const c of t.columns) {
      if (relations.some((r) => r.from.table === t.name && r.from.column === c.name)) continue;
      const f = fold(c.name);
      const m = /^(.*?)_?(id|code|no)$/.exec(f);
      if (!m || !m[1]) continue;
      const stem = m[1].replace(/_$/, "");
      const target = tables.find((x) => x !== t && (fold(x.name) === stem || singular(fold(x.name)) === stem || fold(x.name) === plural(stem) || singular(fold(x.name)) === singular(stem)));
      if (!target) continue;
      const key = target.columns.find((x) => fold(x.name) === f) ?? target.columns.find((x) => x.role === "id") ?? target.columns.find((x) => fold(x.name) === "id" || fold(x.name) === "code");
      if (!key) continue;
      const total = Number(db.value(`SELECT COUNT(DISTINCT ${qi(c.name)}) FROM ${qi(t.name)} WHERE ${qi(c.name)} IS NOT NULL`) ?? 0);
      const hit = Number(db.value(`SELECT COUNT(DISTINCT a.${qi(c.name)}) FROM ${qi(t.name)} a WHERE a.${qi(c.name)} IN (SELECT ${qi(key.name)} FROM ${qi(target.name)})`) ?? 0);
      if (total && hit / total >= 0.9) {
        relations.push({ from: { table: t.name, column: c.name }, to: { table: target.name, column: key.name } });
        c.role = "fk";
        c.ref = { table: target.name, column: key.name };
        if (!target.pk && key.role !== "id") target.pk = key.name;
      }
    }
  }
  for (const r of relations) {
    const c = tables.find((t) => t.name === r.from.table)?.columns.find((x) => x.name === r.from.column);
    if (c) {
      c.role = "fk";
      c.ref = r.to;
    }
  }

  // Measures: the total of each money or quantity column. Tables that others point at rank by them.
  for (const t of tables) {
    for (const c of t.columns.filter((x) => x.role === "money" || x.role === "quantity")) {
      const id = `${t.name}__${c.name}`;
      const isSales = /(total|amount|revenue|sales|tutar|ciro|satis)/.test(fold(c.name));
      metrics.push({
        id,
        label: `Total ${c.label}`,
        labelTr: `Toplam ${c.label}`,
        terms: isSales && t.amountColumn === c.name ? ["revenue", "sales", "turnover", "ciro", "satis", "satislar", "gelir"].filter((w) => !t.columns.some((x) => fold(x.name) === w)) : [],
        table: t.name,
        sql: `SUM({${t.name}}.${qi(c.name)})`,
        date: t.dateColumn ? `${t.name}.${t.dateColumn}` : "",
        unit: c.role === "money" ? "money" : "count",
        note: `Sum of ${c.label} in ${t.name}`,
        noteTr: `${t.name} içindeki ${c.label} toplamı`,
        higherIsBetter: true,
      });
    }
  }
  for (const t of tables) {
    const fact = relations.filter((r) => r.to.table === t.name).map((r) => tables.find((x) => x.name === r.from.table)!).find((x) => x.amountColumn);
    if (fact) t.rankMetric = `${fact.name}__${fact.amountColumn}`;
  }
  return { source: "upload", tables, relations, metrics: metrics.filter((m) => m.date || true), today };
}
