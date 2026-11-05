import type { Case } from "./tuning";

/**
 * A random question generator for measuring the engine on questions nobody tuned it on. Each
 * question is built from a spec (measure, grouping, filter, date range, top N) in English or
 * Turkish, with several phrasings per piece, filler words and occasional typos. Some phrasings use
 * words the engine's dictionary doesn't have, on purpose. The expected SQL comes from the spec
 * through templates written here, not from the engine.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Measure = "revenue" | "invoices" | "customers" | "expenses" | "units" | "collected" | "outstanding" | "aov";
type Group = "none" | "customer" | "segment" | "country" | "region" | "month" | "year" | "method" | "expense_category" | "department" | "product_category" | "product";
type Filter = "none" | "germany" | "turkey" | "us" | "retail" | "hospitality" | "overdue" | "travel" | "card";
type DateR = "none" | "last_month" | "this_year" | "last_year" | "last_6m" | "last_3m" | "y2025" | "q3_2025";

const ALLOWED: Record<Measure, { groups: Group[]; filters: Filter[]; dates: boolean }> = {
  revenue: { groups: ["none", "customer", "segment", "country", "region", "month", "year"], filters: ["none", "germany", "turkey", "us", "retail", "hospitality"], dates: true },
  invoices: { groups: ["none", "customer", "country", "month", "year", "segment"], filters: ["none", "germany", "retail", "overdue"], dates: true },
  customers: { groups: ["none", "country", "segment", "region"], filters: ["none", "germany", "retail", "turkey"], dates: false },
  expenses: { groups: ["none", "expense_category", "department", "month", "year"], filters: ["none", "travel"], dates: true },
  units: { groups: ["none", "product_category", "product", "month", "year", "country"], filters: ["none", "germany", "retail"], dates: true },
  collected: { groups: ["none", "method", "month", "year"], filters: ["none", "card"], dates: true },
  outstanding: { groups: ["none", "customer", "country", "segment"], filters: ["none", "germany", "hospitality"], dates: false },
  aov: { groups: ["none", "segment", "country", "month"], filters: ["none", "us", "retail"], dates: true },
};

const MEASURE_WORDS: Record<Measure, { en: string[]; tr: string[] }> = {
  revenue: { en: ["revenue", "sales", "total sales", "turnover", "income", "total revenue", "billings"], tr: ["ciro", "satışlar", "toplam satış", "gelir", "toplam ciro", "hasılat"] },
  invoices: { en: ["number of invoices", "how many invoices", "invoice count", "count of orders", "number of orders"], tr: ["fatura sayısı", "kaç fatura", "sipariş sayısı", "kaç sipariş"] },
  customers: { en: ["number of customers", "how many customers", "customer count", "count of clients"], tr: ["müşteri sayısı", "kaç müşteri", "müşteri adedi"] },
  expenses: { en: ["expenses", "total expenses", "spending", "costs", "operating expenses"], tr: ["giderler", "toplam gider", "harcamalar", "masraflar"] },
  units: { en: ["units sold", "quantity sold", "number of units sold", "volume sold"], tr: ["satılan adet", "satış adedi", "satılan miktar"] },
  collected: { en: ["cash collected", "money collected", "collections", "cash received"], tr: ["tahsilat", "tahsil edilen tutar", "tahsilatlar"] },
  outstanding: { en: ["outstanding balance", "unpaid amount", "receivables", "amount owed", "open balance"], tr: ["alacak", "açık bakiye", "ödenmemiş tutar", "alacaklar"] },
  aov: { en: ["average invoice value", "average order value", "average order size", "average invoice"], tr: ["ortalama fatura tutarı", "ortalama sipariş tutarı", "sepet ortalaması"] },
};

const GROUP_WORDS: Record<Exclude<Group, "none">, { en: string[]; tr: string[] }> = {
  customer: { en: ["customer", "client"], tr: ["müşteri bazında", "müşteriye göre", "her müşteri için"] },
  segment: { en: ["segment", "industry", "sector"], tr: ["segment bazında", "segmente göre", "sektöre göre"] },
  country: { en: ["country"], tr: ["ülke bazında", "ülkelere göre", "her ülke için"] },
  region: { en: ["region"], tr: ["bölge bazında", "bölgelere göre"] },
  month: { en: ["month"], tr: ["aylık", "aylara göre", "ay bazında"] },
  year: { en: ["year"], tr: ["yıllık", "yıllara göre", "yıl bazında"] },
  method: { en: ["payment method", "method"], tr: ["ödeme yöntemine göre", "yöntem bazında"] },
  expense_category: { en: ["category", "expense category", "expense type"], tr: ["gider türüne göre", "kategori bazında"] },
  department: { en: ["department", "team"], tr: ["departmana göre", "departman bazında"] },
  product_category: { en: ["product category", "category"], tr: ["kategori bazında", "ürün kategorisine göre"] },
  product: { en: ["product", "item"], tr: ["ürün bazında", "ürüne göre"] },
};

const FILTER_WORDS: Record<Exclude<Filter, "none">, { en: string[]; tr: string[] }> = {
  germany: { en: ["in Germany", "from Germany", "for Germany"], tr: ["Almanya'da", "Almanya'daki", "Almanya için"] },
  turkey: { en: ["in Turkey", "from Türkiye", "for Turkey"], tr: ["Türkiye'de", "Türkiye'deki"] },
  us: { en: ["in the US", "in the United States", "from the USA"], tr: ["ABD'de", "Amerika'daki"] },
  retail: { en: ["from retail customers", "for retail", "in the retail segment"], tr: ["perakende müşterilerin", "perakende segmentinde"] },
  hospitality: { en: ["from hospitality customers", "for hotels and restaurants", "in hospitality"], tr: ["konaklama müşterilerinin", "konaklama sektöründe"] },
  overdue: { en: ["overdue", "late", "past due"], tr: ["vadesi geçmiş", "geciken", "gecikmiş"] },
  travel: { en: ["on travel", "for travel"], tr: ["seyahat", "seyahat için"] },
  card: { en: ["by card", "with a card", "via credit card"], tr: ["kartla", "kredi kartıyla"] },
};

const DATE_WORDS: Record<Exclude<DateR, "none">, { en: string[]; tr: string[]; range: [string, string] }> = {
  last_month: { en: ["last month", "in the previous month"], tr: ["geçen ay", "önceki ay"], range: ["2026-10-01", "2026-10-31"] },
  this_year: { en: ["this year", "so far this year", "in the current year"], tr: ["bu yıl", "bu sene"], range: ["2026-01-01", "2026-11-05"] },
  last_year: { en: ["last year", "in the previous year"], tr: ["geçen yıl", "geçen sene", "önceki yıl"], range: ["2025-01-01", "2025-12-31"] },
  last_6m: { en: ["in the last 6 months", "over the past six months", "last 6 months"], tr: ["son 6 ayda", "son altı ayda", "son 6 ay"], range: ["2026-05-06", "2026-11-05"] },
  last_3m: { en: ["in the last 3 months", "over the past three months"], tr: ["son 3 ayda", "son üç ay içinde"], range: ["2026-08-06", "2026-11-05"] },
  y2025: { en: ["in 2025", "during 2025", "for 2025"], tr: ["2025'te", "2025 yılında", "2025 yılı"], range: ["2025-01-01", "2025-12-31"] },
  q3_2025: { en: ["in Q3 2025", "in the third quarter of 2025"], tr: ["2025 Q3", "2025 3. çeyrekte"], range: ["2025-07-01", "2025-09-30"] },
};

export interface Spec {
  m: Measure;
  g: Group;
  f: Filter;
  d: DateR;
  top: number | null;
  lang: "en" | "tr";
}

const FILTER_SQL: Record<Exclude<Filter, "none">, string> = {
  germany: "c.country = 'Germany'",
  turkey: "c.country = 'Turkey'",
  us: "c.country = 'United States'",
  retail: "c.segment = 'Retail'",
  hospitality: "c.segment = 'Hospitality'",
  overdue: "i.status = 'overdue'",
  travel: "e.category = 'Travel'",
  card: "pa.method = 'Card'",
};

/** Expected SQL for a spec, written from the business definitions, independent of the engine. */
export function goldSql(s: Spec): string {
  const where: string[] = [];
  let from = "";
  let value = "";
  let date = "";
  const groupExpr: Record<string, string> = {};
  switch (s.m) {
    case "revenue":
    case "invoices":
    case "outstanding":
    case "aov":
      from = "FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN employees emp ON emp.id = c.sales_rep_id";
      date = "i.issued_at";
      value = { revenue: "ROUND(SUM(i.total), 2)", invoices: "COUNT(*)", outstanding: "ROUND(SUM(i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)), 2)", aov: "ROUND(AVG(i.total), 2)" }[s.m];
      if (s.m === "revenue" || s.m === "aov") where.push("i.status <> 'void'");
      if (s.m === "outstanding") where.push("i.status IN ('open', 'overdue')");
      break;
    case "customers":
      from = "FROM customers c";
      value = "COUNT(*)";
      break;
    case "expenses":
      from = "FROM expenses e";
      date = "e.spent_at";
      value = "ROUND(SUM(e.amount), 2)";
      break;
    case "units":
      from = "FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN products p ON p.id = il.product_id JOIN customers c ON c.id = i.customer_id";
      date = "i.issued_at";
      value = "SUM(il.quantity)";
      where.push("i.status <> 'void'");
      break;
    case "collected":
      from = "FROM payments pa";
      date = "pa.paid_at";
      value = "ROUND(SUM(pa.amount), 2)";
      break;
  }
  Object.assign(groupExpr, {
    customer: "c.name",
    segment: "c.segment",
    country: "c.country",
    region: "c.region",
    month: `strftime('%Y-%m', ${date})`,
    year: `strftime('%Y', ${date})`,
    method: "pa.method",
    expense_category: "e.category",
    department: "e.department",
    product_category: "p.category",
    product: "p.name",
  });
  if (s.f !== "none") where.push(FILTER_SQL[s.f]);
  if (s.d !== "none" && date) where.push(`${date} BETWEEN '${DATE_WORDS[s.d].range[0]}' AND '${DATE_WORDS[s.d].range[1]}'`);
  const g = s.g === "none" ? null : s.g === "customer" ? "c.id" : s.g === "product" ? "p.id" : groupExpr[s.g];
  const select = s.g === "none" ? value : `${groupExpr[s.g]}, ${value} AS v`;
  let sql = `SELECT ${select} ${from}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${g ? ` GROUP BY ${g}` : ""}`;
  if (s.top && g) sql += ` ORDER BY v DESC LIMIT ${s.top}`;
  return sql;
}

function typo(w: string, r: () => number): string {
  if (w.length < 6 || !/^[a-zçğıöşü]+$/i.test(w)) return w;
  const i = 1 + Math.floor(r() * (w.length - 2));
  const kind = r();
  if (kind < 0.4) return w.slice(0, i) + w.slice(i + 1); // drop a letter
  if (kind < 0.7) return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2); // swap two
  return w.slice(0, i) + w[i] + w.slice(i); // double a letter
}

/** Phrases a spec as a question. */
export function phrase(s: Spec, r: () => number): string {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const L = s.lang;
  let m = pick(MEASURE_WORDS[s.m][L]);
  const f = s.f === "none" ? "" : pick(FILTER_WORDS[s.f][L]);
  const d = s.d === "none" ? "" : pick(DATE_WORDS[s.d][L]);
  let q: string;
  if (L === "en") {
    const gw = s.g === "none" ? "" : pick(GROUP_WORDS[s.g].en);
    if (s.top && s.g !== "none") {
      const plural = gw.endsWith("y") ? gw.slice(0, -1) + "ies" : gw.endsWith("s") ? gw : gw + "s";
      q = pick([`top ${s.top} ${plural} by ${m} ${f} ${d}`, `the ${s.top} ${plural} with the highest ${m} ${f} ${d}`, `${d} top ${s.top} ${plural} by ${m} ${f}`]);
    } else {
      const g = s.g === "none" ? "" : pick([`by ${gw}`, `per ${gw}`, `for each ${gw}`, `broken down by ${gw}`]);
      if (s.g === "month" && r() < 0.5) {
        q = `monthly ${m} ${f} ${d}`;
      } else q = pick([`${m} ${g} ${f} ${d}`, `${m} ${f} ${d} ${g}`, `${d} ${m} ${f} ${g}`]);
      if (s.f === "overdue") q = q.replace(m, `${m.replace(/invoices|orders/, `${f} $&`)}`).replace(` ${f} `, " ");
    }
    q = pick(["", "", "", "show me ", "what is the ", "please show ", "can you give me "]) + q;
  } else {
    const gw = s.g === "none" ? "" : pick(GROUP_WORDS[s.g].tr);
    if (s.top && s.g !== "none") {
      const noun = { customer: "müşteri", country: "ülke", segment: "segment", region: "bölge", product: "ürün", product_category: "kategori", month: "ay", year: "yıl", method: "yöntem", expense_category: "kategori", department: "departman" }[s.g];
      q = pick([`${d} ${f} ${m} bazında ilk ${s.top} ${noun}`, `${d} ${f} en yüksek ${m} olan ${s.top} ${noun}`, `${f} ${d} ${m} açısından en büyük ${s.top} ${noun}`]);
    } else {
      if (s.f === "overdue") m = `${f} ${m}`;
      q = pick([`${d} ${s.f === "overdue" ? "" : f} ${gw} ${m}`, `${s.f === "overdue" ? "" : f} ${m} ${gw} ${d}`, `${d} ${s.f === "overdue" ? "" : f} ${m} ${gw}`]);
    }
    q = q + pick(["", "", "", " nedir", " ne kadar", " göster", " lütfen"]);
  }
  q = q.replace(/\s+/g, " ").trim();
  // Occasional typo in one longer word, and random capitalisation.
  if (r() < 0.12) {
    const words = q.split(" ");
    const k = Math.floor(r() * words.length);
    words[k] = typo(words[k], r);
    q = words.join(" ");
  }
  if (r() < 0.3) q = q.charAt(0).toUpperCase() + q.slice(1);
  if (r() < 0.2) q += "?";
  return q;
}

export function randomCases(seed: number, n: number): Array<Case & { spec: Spec }> {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const out: Array<Case & { spec: Spec }> = [];
  const seen = new Set<string>();
  while (out.length < n) {
    const m = pick(Object.keys(ALLOWED) as Measure[]);
    const a = ALLOWED[m];
    const g = pick(a.groups);
    const f = pick(a.filters);
    const d: DateR = a.dates && r() < 0.65 ? pick(Object.keys(DATE_WORDS) as DateR[]) : "none";
    const entity = ["customer", "product", "country", "segment", "region"].includes(g);
    // Top N only on sums: counts tie too often for a fixed top 5 to be well defined.
    const top = entity && r() < 0.4 && ["revenue", "units", "outstanding"].includes(m) ? pick([3, 5, 10]) : null;
    const spec: Spec = { m, g, f, d, top, lang: r() < 0.5 ? "en" : "tr" };
    // Skip specs whose meaning is unclear even to a person.
    const dim: Partial<Record<Filter, Group>> = { germany: "country", turkey: "country", us: "country", retail: "segment", hospitality: "segment", travel: "expense_category", card: "method" };
    if (dim[f] === g) continue;
    if (m === "invoices" && f === "overdue" && d !== "none") continue;
    if (m === "outstanding" && g === "none" && f === "none" && r() < 0.5) continue;
    const q = phrase(spec, r);
    if (seen.has(q)) continue;
    seen.add(q);
    out.push({ q, sql: goldSql(spec), spec });
  }
  return out;
}
