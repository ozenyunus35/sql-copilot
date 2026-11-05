import type { Model } from "@/lib/model";

export interface Snippet {
  title: { en: string; tr: string };
  note: { en: string; tr: string };
  sql: string;
}

/** Worked examples for the demo data: each shows a pattern analysts reach for. */
const DEMO: Snippet[] = [
  {
    title: { en: "Receivables aging", tr: "Alacak yaşlandırma" },
    note: { en: "CASE buckets on days past due", tr: "Gecikme gününe göre CASE grupları" },
    sql: `-- Open balance by how late it is
SELECT
  CASE
    WHEN julianday('now') - julianday(i.due_at) <= 0 THEN '0. not due'
    WHEN julianday('now') - julianday(i.due_at) <= 30 THEN '1. 1-30 days'
    WHEN julianday('now') - julianday(i.due_at) <= 60 THEN '2. 31-60 days'
    WHEN julianday('now') - julianday(i.due_at) <= 90 THEN '3. 61-90 days'
    ELSE '4. 90+ days'
  END AS bucket,
  COUNT(*) AS invoices,
  ROUND(SUM(i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)), 2) AS open_balance
FROM invoices AS i
WHERE i.status IN ('open', 'overdue')
GROUP BY bucket
ORDER BY bucket;`,
  },
  {
    title: { en: "Running total this year", tr: "Bu yıl kümülatif ciro" },
    note: { en: "Window function over monthly sums", tr: "Aylık toplamlar üzerinde pencere fonksiyonu" },
    sql: `-- Monthly revenue and the running total
WITH monthly AS (
  SELECT strftime('%Y-%m', issued_at) AS month, SUM(total) AS revenue
  FROM invoices
  WHERE status <> 'void' AND issued_at >= date('now', 'start of year')
  GROUP BY month
)
SELECT
  month,
  ROUND(revenue, 2) AS revenue,
  ROUND(SUM(revenue) OVER (ORDER BY month), 2) AS running_total
FROM monthly
ORDER BY month;`,
  },
  {
    title: { en: "Month over month growth", tr: "Aydan aya büyüme" },
    note: { en: "LAG() to compare with the month before", tr: "Önceki ayla kıyas için LAG()" },
    sql: `-- Revenue change from the month before, last 12 months
WITH monthly AS (
  SELECT strftime('%Y-%m', issued_at) AS month, SUM(total) AS revenue
  FROM invoices
  WHERE status <> 'void' AND issued_at >= date('now', 'start of month', '-12 months')
  GROUP BY month
)
SELECT
  month,
  ROUND(revenue, 2) AS revenue,
  ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month)) / LAG(revenue) OVER (ORDER BY month), 1) AS change_pct
FROM monthly
ORDER BY month;`,
  },
  {
    title: { en: "Gross margin by category", tr: "Kategoriye göre brüt marj" },
    note: { en: "Join lines to products, cost vs price", tr: "Satırları ürünlere bağla, maliyet ve fiyat" },
    sql: `-- Revenue, cost and margin per product category
SELECT
  pr.category,
  ROUND(SUM(il.line_total), 2) AS revenue,
  ROUND(SUM(il.quantity * pr.unit_cost), 2) AS cost,
  ROUND(100.0 * (SUM(il.line_total) - SUM(il.quantity * pr.unit_cost)) / SUM(il.line_total), 1) AS margin_pct
FROM invoice_lines AS il
JOIN products AS pr ON pr.id = il.product_id
JOIN invoices AS i ON i.id = il.invoice_id
WHERE i.status <> 'void'
GROUP BY pr.category
ORDER BY margin_pct DESC;`,
  },
  {
    title: { en: "Customers gone quiet", tr: "Sessizleşen müşteriler" },
    note: { en: "NOT EXISTS: bought before, nothing in 6 months", tr: "NOT EXISTS: önce almış, 6 aydır yok" },
    sql: `-- Active before, no invoice in the last 6 months
SELECT c.name, c.segment, c.country, MAX(i.issued_at) AS last_invoice
FROM customers AS c
JOIN invoices AS i ON i.customer_id = c.id
WHERE NOT EXISTS (
  SELECT 1 FROM invoices AS r
  WHERE r.customer_id = c.id AND r.issued_at >= date('now', '-6 months')
)
GROUP BY c.id
ORDER BY last_invoice DESC;`,
  },
  {
    title: { en: "Top customer per country", tr: "Her ülkenin en büyük müşterisi" },
    note: { en: "RANK() inside each partition", tr: "Her bölümde RANK()" },
    sql: `-- The biggest customer in each country, all time
WITH ranked AS (
  SELECT
    c.country,
    c.name,
    SUM(i.total) AS revenue,
    RANK() OVER (PARTITION BY c.country ORDER BY SUM(i.total) DESC) AS rnk
  FROM customers AS c
  JOIN invoices AS i ON i.customer_id = c.id
  WHERE i.status <> 'void'
  GROUP BY c.country, c.id
)
SELECT country, name, ROUND(revenue, 2) AS revenue
FROM ranked
WHERE rnk = 1
ORDER BY revenue DESC;`,
  },
];

const q = (name: string) => (/^[a-z_][a-z0-9_]*$/i.test(name) ? name : `"${name.replace(/"/g, '""')}"`);

/** Examples for the data that is open: the worked set for the demo, simple starters for uploads. */
export function snippets(model: Model, demo: boolean): Snippet[] {
  if (demo) return DEMO;
  const out: Snippet[] = [];
  for (const t of model.tables.slice(0, 3)) {
    out.push({ title: { en: `Preview ${t.name}`, tr: `${t.name} önizleme` }, note: { en: "First 100 rows", tr: "İlk 100 satır" }, sql: `SELECT *\nFROM ${q(t.name)}\nLIMIT 100;` });
    const cat = t.columns.find((c) => c.role === "category");
    const num = t.columns.find((c) => c.role === "money" || c.role === "quantity" || c.role === "number");
    if (cat && num)
      out.push({
        title: { en: `${num.name} by ${cat.name}`, tr: `${cat.name} bazında ${num.name}` },
        note: { en: "GROUP BY with a total", tr: "Toplamlı GROUP BY" },
        sql: `SELECT ${q(cat.name)}, COUNT(*) AS n, ROUND(SUM(${q(num.name)}), 2) AS total\nFROM ${q(t.name)}\nGROUP BY ${q(cat.name)}\nORDER BY total DESC;`,
      });
  }
  return out.slice(0, 6);
}
