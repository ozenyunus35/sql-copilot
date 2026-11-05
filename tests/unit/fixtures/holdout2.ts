import type { Case } from "./tuning";

/**
 * Holdout 2: written after the engine was tuned, before running it even once. Mixed styles:
 * terse, chatty, misspelled, business jargon, Turkish with suffixes. The first run is the number
 * reported in the README; it must not be tuned on.
 */
const NV = "i.status <> 'void'";
const REV = "ROUND(SUM(i.total), 2)";
const OUT = "SUM(i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0))";
const Y26 = "BETWEEN '2026-01-01' AND '2026-11-05'";
const Y25 = "BETWEEN '2025-01-01' AND '2025-12-31'";
const Y24 = "BETWEEN '2024-01-01' AND '2024-12-31'";
const OCT = "BETWEEN '2026-10-01' AND '2026-10-31'";
const Q3 = "BETWEEN '2026-07-01' AND '2026-09-30'";
const L90 = "BETWEEN '2026-08-08' AND '2026-11-05'";
const MAR26 = "BETWEEN '2026-03-01' AND '2026-03-31'";
const CUST = "FROM invoices i JOIN customers c ON c.id = i.customer_id";
const LINES = "FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN products p ON p.id = il.product_id";

export const HOLDOUT2: Case[] = [
  { q: "How much revenue did we make in March?", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${MAR26}` },
  { q: "revenue split by customer segment for 2024", sql: `SELECT c.segment, ${REV} ${CUST} WHERE ${NV} AND i.issued_at ${Y24} GROUP BY 1` },
  { q: "what are the five biggest invoices ever", sql: `SELECT number FROM invoices ORDER BY total DESC LIMIT 5` },
  { q: "list all customers in Canada", sql: `SELECT name FROM customers WHERE country = 'Canada'` },
  { q: "count customers by region", sql: `SELECT region, COUNT(*) FROM customers GROUP BY 1` },
  { q: "which products are out of stock?", sql: `SELECT name FROM products WHERE in_stock = 0` },
  { q: "total receivables for customers in the UK", sql: `SELECT ROUND(${OUT}, 2) ${CUST} WHERE i.status IN ('open', 'overdue') AND c.country = 'United Kingdom'` },
  { q: "overdue invoices for hotels", sql: `SELECT i.number ${CUST} WHERE i.status = 'overdue' AND c.segment = 'Hospitality'` },
  { q: "average days customers take to pay, per country", sql: `SELECT c.country, ROUND(AVG(julianday((SELECT MAX(p.paid_at) FROM payments p WHERE p.invoice_id = i.id)) - julianday(i.issued_at)), 1) ${CUST} WHERE i.status = 'paid' GROUP BY 1` },
  { q: "software spend this year", sql: `SELECT ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Software' AND spent_at ${Y26}` },
  { q: "expenses per vendor last quarter, highest first", sql: `SELECT vendor, ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Q3} GROUP BY 1` },
  { q: "how many units of electronics did we sell last year", sql: `SELECT SUM(il.quantity) ${LINES} WHERE ${NV} AND p.category = 'Electronics' AND i.issued_at ${Y25}` },
  { q: "top 3 sales reps by revenue this year", sql: `SELECT e.name, ${REV} r ${CUST} JOIN employees e ON e.id = c.sales_rep_id WHERE ${NV} AND i.issued_at ${Y26} GROUP BY e.id ORDER BY r DESC LIMIT 3` },
  { q: "revenue in the last 90 days", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${L90}` },
  { q: "weekly revenue last month", sql: `SELECT date(i.issued_at, 'weekday 0', '-6 days'), ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${OCT} GROUP BY 1` },
  { q: "gross profit last quarter", sql: `SELECT ROUND(SUM(il.line_total - il.quantity * p.unit_cost), 2) ${LINES} WHERE ${NV} AND i.issued_at ${Q3}` },
  { q: "number of payments per method this year", sql: `SELECT method, COUNT(*) FROM payments WHERE paid_at ${Y26} GROUP BY 1` },
  { q: "customers that never placed an order", sql: `SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id)` },
  { q: "biggest customer in turkey", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND c.country = 'Turkey' GROUP BY c.id ORDER BY r DESC LIMIT 1` },
  { q: "avg invoice amount for education customers", sql: `SELECT ROUND(AVG(i.total), 2) ${CUST} WHERE ${NV} AND c.segment = 'Education'` },
  { q: "customers with credit limit under 5000", sql: `SELECT name FROM customers WHERE credit_limit < 5000` },
  { q: "revenue by month for the healthcare segment in 2025", sql: `SELECT strftime('%Y-%m', i.issued_at), ${REV} ${CUST} WHERE ${NV} AND c.segment = 'Healthcare' AND i.issued_at ${Y25} GROUP BY 1` },
  { q: "how much cash came in last month", sql: `SELECT ROUND(SUM(amount), 2) FROM payments WHERE paid_at ${OCT}` },
  { q: "unpaid invoices older than... no wait, just unpaid invoices in Spain", sql: `SELECT i.number ${CUST} WHERE i.status IN ('open', 'overdue') AND c.country = 'Spain'` },
  { q: "Shipping costs by month this year", sql: `SELECT strftime('%Y-%m', spent_at), ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Shipping' AND spent_at ${Y26} GROUP BY 1` },
  { q: "products in the cleaning category", sql: `SELECT name FROM products WHERE category = 'Cleaning'` },
  { q: "what share of revenue comes from each country", sql: `SELECT c.country, ${REV}, ROUND(100.0 * ${REV} / SUM(${REV}) OVER (), 1) ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "employees hired in 2023", sql: `SELECT name FROM employees WHERE hired_at BETWEEN '2023-01-01' AND '2023-12-31'` },

  // Turkish
  { q: "Mart ayında ne kadar ciro yaptık?", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${MAR26}` },
  { q: "2024 yılında müşteri segmentine göre ciro", sql: `SELECT c.segment, ${REV} ${CUST} WHERE ${NV} AND i.issued_at ${Y24} GROUP BY 1` },
  { q: "şimdiye kadarki en büyük 5 fatura", sql: `SELECT number FROM invoices ORDER BY total DESC LIMIT 5` },
  { q: "Kanada'daki tüm müşterileri listele", sql: `SELECT name FROM customers WHERE country = 'Canada'` },
  { q: "bölgelere göre müşteri sayısı", sql: `SELECT region, COUNT(*) FROM customers GROUP BY 1` },
  { q: "stokta olmayan ürünler hangileri", sql: `SELECT name FROM products WHERE in_stock = 0` },
  { q: "İngiltere'deki müşterilerden toplam alacağımız", sql: `SELECT ROUND(${OUT}, 2) ${CUST} WHERE i.status IN ('open', 'overdue') AND c.country = 'United Kingdom'` },
  { q: "otellerin vadesi geçmiş faturaları", sql: `SELECT i.number ${CUST} WHERE i.status = 'overdue' AND c.segment = 'Hospitality'` },
  { q: "ülkelere göre müşterilerin ortalama ödeme süresi", sql: `SELECT c.country, ROUND(AVG(julianday((SELECT MAX(p.paid_at) FROM payments p WHERE p.invoice_id = i.id)) - julianday(i.issued_at)), 1) ${CUST} WHERE i.status = 'paid' GROUP BY 1` },
  { q: "bu yıl yazılım harcaması", sql: `SELECT ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Software' AND spent_at ${Y26}` },
  { q: "geçen çeyrek tedarikçi bazında giderler", sql: `SELECT vendor, ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Q3} GROUP BY 1` },
  { q: "geçen yıl kaç adet elektronik ürün sattık", sql: `SELECT SUM(il.quantity) ${LINES} WHERE ${NV} AND p.category = 'Electronics' AND i.issued_at ${Y25}` },
  { q: "bu yıl ciroya göre ilk 3 satış temsilcisi", sql: `SELECT e.name, ${REV} r ${CUST} JOIN employees e ON e.id = c.sales_rep_id WHERE ${NV} AND i.issued_at ${Y26} GROUP BY e.id ORDER BY r DESC LIMIT 3` },
  { q: "son 90 gündeki ciro", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${L90}` },
  { q: "geçen ay haftalık ciro", sql: `SELECT date(i.issued_at, 'weekday 0', '-6 days'), ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${OCT} GROUP BY 1` },
  { q: "geçen çeyrekteki brüt kâr", sql: `SELECT ROUND(SUM(il.line_total - il.quantity * p.unit_cost), 2) ${LINES} WHERE ${NV} AND i.issued_at ${Q3}` },
  { q: "bu yıl yönteme göre ödeme sayısı", sql: `SELECT method, COUNT(*) FROM payments WHERE paid_at ${Y26} GROUP BY 1` },
  { q: "hiç sipariş vermemiş müşteriler", sql: `SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id)` },
  { q: "türkiyedeki en büyük müşteri", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND c.country = 'Turkey' GROUP BY c.id ORDER BY r DESC LIMIT 1` },
  { q: "eğitim müşterilerinin ortalama fatura tutarı", sql: `SELECT ROUND(AVG(i.total), 2) ${CUST} WHERE ${NV} AND c.segment = 'Education'` },
  { q: "kredi limiti 5000'in altında olan müşteriler", sql: `SELECT name FROM customers WHERE credit_limit < 5000` },
  { q: "2025'te sağlık segmentinin aylık cirosu", sql: `SELECT strftime('%Y-%m', i.issued_at), ${REV} ${CUST} WHERE ${NV} AND c.segment = 'Healthcare' AND i.issued_at ${Y25} GROUP BY 1` },
  { q: "geçen ay ne kadar tahsilat yaptık", sql: `SELECT ROUND(SUM(amount), 2) FROM payments WHERE paid_at ${OCT}` },
  { q: "İspanya'daki ödenmemiş faturalar", sql: `SELECT i.number ${CUST} WHERE i.status IN ('open', 'overdue') AND c.country = 'Spain'` },
  { q: "bu yıl aylık kargo giderleri", sql: `SELECT strftime('%Y-%m', spent_at), ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Shipping' AND spent_at ${Y26} GROUP BY 1` },
  { q: "temizlik kategorisindeki ürünler", sql: `SELECT name FROM products WHERE category = 'Cleaning'` },
  { q: "her ülkenin cirodaki payı", sql: `SELECT c.country, ${REV}, ROUND(100.0 * ${REV} / SUM(${REV}) OVER (), 1) ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "2023'te işe alınan çalışanlar", sql: `SELECT name FROM employees WHERE hired_at BETWEEN '2023-01-01' AND '2023-12-31'` },
];
