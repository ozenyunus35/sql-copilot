import type { Case } from "./tuning";

/**
 * Holdout questions: written in one go before running them, in different words from the tuning
 * set (casual phrasing, typos, synonyms, Turkish inflections). The answers are hand-written SQL.
 * Rule: the engine is never adjusted by looking at a single holdout failure; after the first run
 * this set is retired into tuning and a fresh holdout is written.
 */
const NV = "i.status <> 'void'";
const REV = "ROUND(SUM(i.total), 2)";
const OUT = "SUM(i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0))";
const Y26 = "BETWEEN '2026-01-01' AND '2026-11-05'";
const Y25 = "BETWEEN '2025-01-01' AND '2025-12-31'";
const Y24 = "BETWEEN '2024-01-01' AND '2024-12-31'";
const SEP = "BETWEEN '2026-09-01' AND '2026-09-30'";
const OCT = "BETWEEN '2026-10-01' AND '2026-10-31'";
const Q3 = "BETWEEN '2026-07-01' AND '2026-09-30'";
const L30 = "BETWEEN '2026-10-07' AND '2026-11-05'";
const L12M = "BETWEEN '2025-11-06' AND '2026-11-05'";
const CUST = "FROM invoices i JOIN customers c ON c.id = i.customer_id";
const LINES = "FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN products p ON p.id = il.product_id";

export const HOLDOUT: Case[] = [
  { q: "What were our total sales in 2024?", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Y24}` },
  { q: "turnover by country", sql: `SELECT c.country, ${REV} ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "Who owes us the most money?", sql: `SELECT c.name, ROUND(${OUT}, 2) o ${CUST} WHERE i.status IN ('open', 'overdue') GROUP BY c.id ORDER BY o DESC LIMIT 1` },
  { q: "show me late invoices", sql: `SELECT number FROM invoices WHERE status = 'overdue'` },
  { q: "payments received in September", sql: `SELECT paid_at, amount FROM payments WHERE paid_at ${SEP}` },
  { q: "costs by department last year", sql: `SELECT department, ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Y25} GROUP BY 1` },
  { q: "which sector brings in the most revenue?", sql: `SELECT c.segment, ${REV} r ${CUST} WHERE ${NV} GROUP BY 1 ORDER BY r DESC LIMIT 1` },
  { q: "sales per quarter in 2025", sql: `SELECT strftime('%Y', i.issued_at) || '-Q' || ((CAST(strftime('%m', i.issued_at) AS INTEGER) + 2) / 3), ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Y25} GROUP BY 1` },
  { q: "biggest 10 clients this year", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${Y26} GROUP BY c.id ORDER BY r DESC LIMIT 10` },
  { q: "number of invoices per month in 2025", sql: `SELECT strftime('%Y-%m', issued_at), COUNT(*) FROM invoices WHERE issued_at ${Y25} GROUP BY 1` },
  { q: "revnue last quater", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Q3}` },
  { q: "how many customers in the healthcare sector", sql: `SELECT COUNT(*) FROM customers WHERE segment = 'Healthcare'` },
  { q: "list customers from Dubai", sql: `SELECT name FROM customers WHERE city = 'Dubai'` },
  { q: "average order value by segment", sql: `SELECT c.segment, ROUND(AVG(i.total), 2) ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "total amount collected by card this year", sql: `SELECT ROUND(SUM(amount), 2) FROM payments WHERE method = 'Card' AND paid_at ${Y26}` },
  { q: "marketing spend per month in 2025", sql: `SELECT strftime('%Y-%m', spent_at), ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Marketing' AND spent_at ${Y25} GROUP BY 1` },
  { q: "what's our gross margin this year", sql: `SELECT ROUND(100.0 * SUM(il.line_total - il.quantity * p.unit_cost) / SUM(il.line_total), 1) ${LINES} WHERE ${NV} AND i.issued_at ${Y26}` },
  { q: "furniture revenue last year", sql: `SELECT ROUND(SUM(il.line_total), 2) ${LINES} WHERE ${NV} AND p.category = 'Furniture' AND i.issued_at ${Y25}` },
  { q: "Top 3 product categories by profit", sql: `SELECT p.category, ROUND(SUM(il.line_total - il.quantity * p.unit_cost), 2) g ${LINES} WHERE ${NV} GROUP BY 1 ORDER BY g DESC LIMIT 3` },
  { q: "customers who haven't ordered in the last 12 months", sql: `SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.issued_at ${L12M})` },
  { q: "inactive customers in the UK", sql: `SELECT name FROM customers WHERE status = 'inactive' AND country = 'United Kingdom'` },
  { q: "invoices between 5000 and 10000 dollars", sql: `SELECT number FROM invoices WHERE total BETWEEN 5000 AND 10000` },
  { q: "how many invoices did Silverline Partners get last year", sql: `SELECT COUNT(*) ${CUST} WHERE c.name = 'Silverline Partners' AND i.issued_at ${Y25}` },
  { q: "revenue trend over the last 30 days", sql: `SELECT date(i.issued_at), ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${L30} GROUP BY 1` },
  { q: "employees in Europe", sql: `SELECT name FROM employees WHERE region = 'Europe'` },
  { q: "how many sales reps do we have", sql: `SELECT COUNT(*) FROM employees WHERE role = 'Sales rep'` },
  { q: "expenses over 5000 last quarter", sql: `SELECT spent_at, amount FROM expenses WHERE amount > 5000 AND spent_at ${Q3}` },
  { q: "average days to pay for hospitality customers", sql: `SELECT ROUND(AVG(julianday((SELECT MAX(p.paid_at) FROM payments p WHERE p.invoice_id = i.id)) - julianday(i.issued_at)), 1) ${CUST} WHERE i.status = 'paid' AND c.segment = 'Hospitality'` },
  { q: "Revenue by product category, share of total", sql: `SELECT p.category, ROUND(SUM(il.line_total), 2), ROUND(100.0 * SUM(il.line_total) / SUM(SUM(il.line_total)) OVER (), 1) ${LINES} WHERE ${NV} GROUP BY 1` },
  { q: "cheapest 3 products", sql: `SELECT name FROM products ORDER BY unit_price ASC LIMIT 3` },
  { q: "units sold of coffee beans this year", sql: `SELECT SUM(il.quantity) ${LINES} WHERE ${NV} AND p.name = 'Coffee beans, 6 kg' AND i.issued_at ${Y26}` },
  { q: "new clients in 2025 by country", sql: `SELECT country, COUNT(*) FROM customers WHERE created_at ${Y25} GROUP BY 1` },
  { q: "open invoices", sql: `SELECT number FROM invoices WHERE status IN ('open', 'overdue')` },
  { q: "void invoices last year", sql: `SELECT number FROM invoices WHERE status = 'void' AND issued_at ${Y25}` },
  { q: "total tax collected this year", sql: `SELECT ROUND(SUM(tax), 2) FROM invoices WHERE issued_at ${Y26}` },
  { q: "how much did hospitality customers spend in october", sql: `SELECT ${REV} ${CUST} WHERE ${NV} AND c.segment = 'Hospitality' AND i.issued_at ${OCT}` },

  // Turkish
  { q: "2024 yılı toplam satışlar", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Y24}` },
  { q: "bize en çok borcu olan müşteri kim", sql: `SELECT c.name, ROUND(${OUT}, 2) o ${CUST} WHERE i.status IN ('open', 'overdue') GROUP BY c.id ORDER BY o DESC LIMIT 1` },
  { q: "geciken faturaları göster", sql: `SELECT number FROM invoices WHERE status = 'overdue'` },
  { q: "eylül ayında alınan ödemeler", sql: `SELECT paid_at, amount FROM payments WHERE paid_at ${SEP}` },
  { q: "geçen yıl departman bazında masraflar", sql: `SELECT department, ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Y25} GROUP BY 1` },
  { q: "hangi sektör en çok ciro getiriyor", sql: `SELECT c.segment, ${REV} r ${CUST} WHERE ${NV} GROUP BY 1 ORDER BY r DESC LIMIT 1` },
  { q: "2025 çeyreklik satışlar", sql: `SELECT strftime('%Y', i.issued_at) || '-Q' || ((CAST(strftime('%m', i.issued_at) AS INTEGER) + 2) / 3), ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Y25} GROUP BY 1` },
  { q: "bu yılın en büyük 10 müşterisi", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${Y26} GROUP BY c.id ORDER BY r DESC LIMIT 10` },
  { q: "2025'te aylık fatura sayısı", sql: `SELECT strftime('%Y-%m', issued_at), COUNT(*) FROM invoices WHERE issued_at ${Y25} GROUP BY 1` },
  { q: "sağlık sektöründe kaç müşteri var", sql: `SELECT COUNT(*) FROM customers WHERE segment = 'Healthcare'` },
  { q: "Dubai'deki müşteriler", sql: `SELECT name FROM customers WHERE city = 'Dubai'` },
  { q: "segmentlere göre ortalama sipariş tutarı", sql: `SELECT c.segment, ROUND(AVG(i.total), 2) ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "bu yıl kartla yapılan tahsilat", sql: `SELECT ROUND(SUM(amount), 2) FROM payments WHERE method = 'Card' AND paid_at ${Y26}` },
  { q: "2025 aylık pazarlama giderleri", sql: `SELECT strftime('%Y-%m', spent_at), ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Marketing' AND spent_at ${Y25} GROUP BY 1` },
  { q: "bu yıl brüt kar marjımız", sql: `SELECT ROUND(100.0 * SUM(il.line_total - il.quantity * p.unit_cost) / SUM(il.line_total), 1) ${LINES} WHERE ${NV} AND i.issued_at ${Y26}` },
  { q: "geçen yıl mobilya satışları", sql: `SELECT ROUND(SUM(il.line_total), 2) ${LINES} WHERE ${NV} AND p.category = 'Furniture' AND i.issued_at ${Y25}` },
  { q: "son 12 ayda sipariş vermeyen müşteriler", sql: `SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.issued_at ${L12M})` },
  { q: "İngiltere'deki pasif müşteriler", sql: `SELECT name FROM customers WHERE status = 'inactive' AND country = 'United Kingdom'` },
  { q: "5000 ile 10000 dolar arasındaki faturalar", sql: `SELECT number FROM invoices WHERE total BETWEEN 5000 AND 10000` },
  { q: "Avrupa'daki çalışanlar", sql: `SELECT name FROM employees WHERE region = 'Europe'` },
  { q: "kaç satış temsilcimiz var", sql: `SELECT COUNT(*) FROM employees WHERE role = 'Sales rep'` },
  { q: "geçen çeyrek 5000'in üzerindeki giderler", sql: `SELECT spent_at, amount FROM expenses WHERE amount > 5000 AND spent_at ${Q3}` },
  { q: "en ucuz 3 ürün", sql: `SELECT name FROM products ORDER BY unit_price ASC LIMIT 3` },
  { q: "2025'te ülkelere göre yeni müşteri sayısı", sql: `SELECT country, COUNT(*) FROM customers WHERE created_at ${Y25} GROUP BY 1` },
  { q: "açık faturalar", sql: `SELECT number FROM invoices WHERE status IN ('open', 'overdue')` },
  { q: "geçen yıl iptal edilen faturalar", sql: `SELECT number FROM invoices WHERE status = 'void' AND issued_at ${Y25}` },
  { q: "konaklama müşterileri ekimde ne kadar harcadı", sql: `SELECT ${REV} ${CUST} WHERE ${NV} AND c.segment = 'Hospitality' AND i.issued_at ${OCT}` },
  { q: "temsilci başına müşteri sayısı", sql: `SELECT e.name, COUNT(*) FROM customers c JOIN employees e ON e.id = c.sales_rep_id GROUP BY e.id` },
];
