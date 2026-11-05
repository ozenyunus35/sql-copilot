/**
 * Tuning questions with hand-written answers (SQL written independently of the engine), for
 * "today" = 2026-11-05. The engine was adjusted while looking at these; the honest measure is the
 * holdout set, which it was not tuned on.
 *
 * Date conventions: last N months = from the day after the same date N months ago, through today;
 * last month/quarter/year = the previous calendar period; this year = Jan 1 through today.
 */
export interface Case {
  q: string;
  sql: string;
}

const NV = "i.status <> 'void'";
const REV = "ROUND(SUM(i.total), 2)";
const OUT = "SUM(i.total - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0))";
const DTP = "AVG(julianday((SELECT MAX(p.paid_at) FROM payments p WHERE p.invoice_id = i.id)) - julianday(i.issued_at))";
const Y26 = "BETWEEN '2026-01-01' AND '2026-11-05'";
const Y25 = "BETWEEN '2025-01-01' AND '2025-12-31'";
const OCT = "BETWEEN '2026-10-01' AND '2026-10-31'";
const Q3 = "BETWEEN '2026-07-01' AND '2026-09-30'";
const L6M = "BETWEEN '2026-05-06' AND '2026-11-05'";
const L3M = "BETWEEN '2026-08-06' AND '2026-11-05'";
const CUST = "FROM invoices i JOIN customers c ON c.id = i.customer_id";
const LINES = "FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN products p ON p.id = il.product_id";
const GP = "SUM(il.line_total - il.quantity * p.unit_cost)";

export const TUNING: Case[] = [
  // Revenue
  { q: "total revenue", sql: `SELECT ${REV} FROM invoices i WHERE ${NV}` },
  { q: "revenue last month", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${OCT}` },
  { q: "how much did we invoice this year", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Y26}` },
  { q: "revenue by month in 2025", sql: `SELECT strftime('%Y-%m', i.issued_at), ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Y25} GROUP BY 1` },
  { q: "quarterly revenue", sql: `SELECT strftime('%Y', i.issued_at) || '-Q' || ((CAST(strftime('%m', i.issued_at) AS INTEGER) + 2) / 3), ${REV} FROM invoices i WHERE ${NV} GROUP BY 1` },
  { q: "revenue by year", sql: `SELECT strftime('%Y', i.issued_at), ${REV} FROM invoices i WHERE ${NV} GROUP BY 1` },
  { q: "top 5 customers by revenue", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} GROUP BY c.id ORDER BY r DESC LIMIT 5` },
  { q: "top 3 customers by revenue last quarter", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${Q3} GROUP BY c.id ORDER BY r DESC LIMIT 3` },
  { q: "which customer spent the most this year", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${Y26} GROUP BY c.id ORDER BY r DESC LIMIT 1` },
  { q: "revenue by segment", sql: `SELECT c.segment, ${REV} ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "revenue by country last year", sql: `SELECT c.country, ${REV} ${CUST} WHERE ${NV} AND i.issued_at ${Y25} GROUP BY 1` },
  { q: "revenue from Germany this year", sql: `SELECT ${REV} ${CUST} WHERE ${NV} AND c.country = 'Germany' AND i.issued_at ${Y26}` },
  { q: "revenue from retail customers in the US last quarter", sql: `SELECT ${REV} ${CUST} WHERE ${NV} AND c.segment = 'Retail' AND c.country = 'United States' AND i.issued_at ${Q3}` },
  { q: "revenue in Q3 2025", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at BETWEEN '2025-07-01' AND '2025-09-30'` },
  { q: "revenue between March and June 2026", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at BETWEEN '2026-03-01' AND '2026-06-30'` },
  { q: "revenue excluding the United States last year", sql: `SELECT ${REV} ${CUST} WHERE ${NV} AND c.country <> 'United States' AND i.issued_at ${Y25}` },
  { q: "share of revenue by region", sql: `SELECT c.region, ${REV}, ROUND(100.0 * ${REV} / SUM(${REV}) OVER (), 1) ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "revenue this year vs last year", sql: `SELECT CASE WHEN i.issued_at ${Y26} THEN 'This year' ELSE 'Last year' END, ${REV} FROM invoices i WHERE ${NV} AND i.issued_at BETWEEN '2025-01-01' AND '2026-11-05' GROUP BY 1` },
  {
    q: "monthly revenue growth this year",
    sql: `SELECT strftime('%Y-%m', i.issued_at) m, ${REV}, ROUND(100.0 * (${REV} - LAG(${REV}) OVER (ORDER BY strftime('%Y-%m', i.issued_at))) / NULLIF(LAG(${REV}) OVER (ORDER BY strftime('%Y-%m', i.issued_at)), 0), 1) FROM invoices i WHERE ${NV} AND i.issued_at ${Y26} GROUP BY 1`,
  },
  { q: "sales rep with the most revenue last quarter", sql: `SELECT e.name, ${REV} r ${CUST} JOIN employees e ON e.id = c.sales_rep_id WHERE ${NV} AND i.issued_at ${Q3} GROUP BY e.id ORDER BY r DESC LIMIT 1` },
  { q: "revenue by sales rep this year", sql: `SELECT e.name, ${REV} ${CUST} JOIN employees e ON e.id = c.sales_rep_id WHERE ${NV} AND i.issued_at ${Y26} GROUP BY e.id` },
  { q: "who are our top 3 customers in Germany", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND c.country = 'Germany' GROUP BY c.id ORDER BY r DESC LIMIT 3` },
  { q: "customers who spent more than 100k this year", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${Y26} GROUP BY c.id HAVING r > 100000` },
  { q: "how many customers spent more than 100k this year", sql: `SELECT COUNT(*) FROM (SELECT c.id ${CUST} WHERE ${NV} AND i.issued_at ${Y26} GROUP BY c.id HAVING SUM(i.total) > 100000)` },
  { q: "average revenue per customer last year", sql: `SELECT ROUND(AVG(r), 2) FROM (SELECT ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${Y25} GROUP BY c.id)` },
  { q: "average invoice value last year", sql: `SELECT ROUND(AVG(i.total), 2) FROM invoices i WHERE ${NV} AND i.issued_at ${Y25}` },

  // Customers
  { q: "how many customers do we have", sql: `SELECT COUNT(*) FROM customers` },
  { q: "how many active customers", sql: `SELECT COUNT(*) FROM customers WHERE status = 'active'` },
  { q: "number of customers per country", sql: `SELECT country, COUNT(*) FROM customers GROUP BY 1` },
  { q: "customers in Turkey", sql: `SELECT name FROM customers WHERE country = 'Turkey'` },
  { q: "list hospitality customers in Europe", sql: `SELECT name FROM customers WHERE segment = 'Hospitality' AND region = 'Europe'` },
  { q: "customers with a credit limit above 30000", sql: `SELECT name FROM customers WHERE credit_limit > 30000` },
  { q: "average credit limit by segment", sql: `SELECT segment, ROUND(AVG(credit_limit), 2) FROM customers GROUP BY 1` },
  { q: "new customers per month this year", sql: `SELECT strftime('%Y-%m', created_at), COUNT(*) FROM customers WHERE created_at ${Y26} GROUP BY 1` },
  { q: "new customers last year", sql: `SELECT COUNT(*) FROM customers WHERE created_at ${Y25}` },
  { q: "customers with no invoices in the last 3 months", sql: `SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.issued_at ${L3M})` },

  // Invoices and receivables
  { q: "how many invoices were issued last month", sql: `SELECT COUNT(*) FROM invoices WHERE issued_at ${OCT}` },
  { q: "overdue invoices", sql: `SELECT number FROM invoices WHERE status = 'overdue'` },
  { q: "how many overdue invoices", sql: `SELECT COUNT(*) FROM invoices WHERE status = 'overdue'` },
  { q: "total outstanding balance", sql: `SELECT ROUND(${OUT}, 2) FROM invoices i WHERE i.status IN ('open', 'overdue')` },
  { q: "top 10 customers by outstanding balance", sql: `SELECT c.name, ROUND(${OUT}, 2) o ${CUST} WHERE i.status IN ('open', 'overdue') GROUP BY c.id ORDER BY o DESC LIMIT 10` },
  { q: "overdue amount by country", sql: `SELECT c.country, ROUND(${OUT}, 2) ${CUST} WHERE i.status = 'overdue' GROUP BY 1` },
  { q: "average days to pay", sql: `SELECT ROUND(${DTP}, 1) FROM invoices i WHERE i.status = 'paid'` },
  { q: "average days to pay by segment", sql: `SELECT c.segment, ROUND(${DTP}, 1) ${CUST} WHERE i.status = 'paid' GROUP BY 1` },
  { q: "invoices over 20000", sql: `SELECT number FROM invoices WHERE total > 20000` },
  { q: "how many invoices over 10000 last year", sql: `SELECT COUNT(*) FROM invoices WHERE total > 10000 AND issued_at ${Y25}` },
  { q: "latest 5 invoices", sql: `SELECT number FROM invoices ORDER BY issued_at DESC, id DESC LIMIT 5` },
  { q: "largest invoice this year", sql: `SELECT number, total FROM invoices WHERE issued_at ${Y26} ORDER BY total DESC LIMIT 1` },
  { q: "invoices for Willow Labs this year", sql: `SELECT i.number ${CUST} WHERE c.name = 'Willow Labs' AND i.issued_at ${Y26}` },
  { q: "unpaid invoices for hospitality customers", sql: `SELECT i.number ${CUST} WHERE i.status IN ('open', 'overdue') AND c.segment = 'Hospitality'` },

  // Products
  { q: "units sold by category this year", sql: `SELECT p.category, SUM(il.quantity) ${LINES} WHERE ${NV} AND i.issued_at ${Y26} GROUP BY 1` },
  { q: "top 10 products by units sold", sql: `SELECT p.name, SUM(il.quantity) u ${LINES} WHERE ${NV} GROUP BY p.id ORDER BY u DESC LIMIT 10` },
  { q: "best selling product last month", sql: `SELECT p.name, SUM(il.quantity) u ${LINES} WHERE ${NV} AND i.issued_at ${OCT} GROUP BY p.id ORDER BY u DESC LIMIT 1` },
  { q: "gross profit by category", sql: `SELECT p.category, ROUND(${GP}, 2) ${LINES} WHERE ${NV} GROUP BY 1` },
  { q: "gross margin by category", sql: `SELECT p.category, ROUND(100.0 * ${GP} / SUM(il.line_total), 1) ${LINES} WHERE ${NV} GROUP BY 1` },
  { q: "most profitable customers", sql: `SELECT c.name, ROUND(${GP}, 2) g ${LINES} JOIN customers c ON c.id = i.customer_id WHERE ${NV} GROUP BY c.id ORDER BY g DESC LIMIT 10` },
  { q: "products never sold", sql: `SELECT name FROM products p WHERE NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.product_id = p.id)` },
  { q: "most expensive products", sql: `SELECT name FROM products ORDER BY unit_price DESC LIMIT 10` },
  { q: "products out of stock", sql: `SELECT name FROM products WHERE in_stock = 0` },
  { q: "how many products per category", sql: `SELECT category, COUNT(*) FROM products GROUP BY 1` },
  { q: "average discount by category", sql: `SELECT p.category, ROUND(AVG(il.discount_pct), 2) FROM invoice_lines il JOIN products p ON p.id = il.product_id GROUP BY 1` },

  // Expenses and cash
  { q: "expenses by category this year", sql: `SELECT category, ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Y26} GROUP BY 1` },
  { q: "total expenses last quarter", sql: `SELECT ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Q3}` },
  { q: "monthly expenses this year", sql: `SELECT strftime('%Y-%m', spent_at), ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Y26} GROUP BY 1` },
  { q: "expenses by department", sql: `SELECT department, ROUND(SUM(amount), 2) FROM expenses GROUP BY 1` },
  { q: "top 5 vendors by spend", sql: `SELECT vendor, ROUND(SUM(amount), 2) s FROM expenses GROUP BY 1 ORDER BY s DESC LIMIT 5` },
  { q: "how much did we spend on travel last year", sql: `SELECT ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Travel' AND spent_at ${Y25}` },
  { q: "payroll expenses by month this year", sql: `SELECT strftime('%Y-%m', spent_at), ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Payroll' AND spent_at ${Y26} GROUP BY 1` },
  { q: "cash collected last month", sql: `SELECT ROUND(SUM(amount), 2) FROM payments WHERE paid_at ${OCT}` },
  { q: "payments by method", sql: `SELECT method, COUNT(*), ROUND(SUM(amount), 2) FROM payments GROUP BY 1` },
  { q: "how many payments by card last month", sql: `SELECT COUNT(*) FROM payments WHERE method = 'Card' AND paid_at ${OCT}` },

  // Turkish
  { q: "toplam ciro", sql: `SELECT ${REV} FROM invoices i WHERE ${NV}` },
  { q: "geçen ay ciro ne kadar", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${OCT}` },
  { q: "bu yıl aylık ciro", sql: `SELECT strftime('%Y-%m', i.issued_at), ${REV} FROM invoices i WHERE ${NV} AND i.issued_at ${Y26} GROUP BY 1` },
  { q: "2025 yılında ülkelere göre ciro", sql: `SELECT c.country, ${REV} ${CUST} WHERE ${NV} AND i.issued_at ${Y25} GROUP BY 1` },
  { q: "son 6 ayda en çok harcayan 5 müşteri", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${L6M} GROUP BY c.id ORDER BY r DESC LIMIT 5` },
  { q: "geçen çeyrek en çok ciro yapan 3 müşteri", sql: `SELECT c.name, ${REV} r ${CUST} WHERE ${NV} AND i.issued_at ${Q3} GROUP BY c.id ORDER BY r DESC LIMIT 3` },
  { q: "segment bazında ciro", sql: `SELECT c.segment, ${REV} ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "kaç müşterimiz var", sql: `SELECT COUNT(*) FROM customers` },
  { q: "kaç aktif müşteri var", sql: `SELECT COUNT(*) FROM customers WHERE status = 'active'` },
  { q: "ülkelere göre müşteri sayısı", sql: `SELECT country, COUNT(*) FROM customers GROUP BY 1` },
  { q: "Türkiye'deki müşteriler", sql: `SELECT name FROM customers WHERE country = 'Turkey'` },
  { q: "vadesi geçmiş faturalar", sql: `SELECT number FROM invoices WHERE status = 'overdue'` },
  { q: "kaç tane vadesi geçmiş fatura var", sql: `SELECT COUNT(*) FROM invoices WHERE status = 'overdue'` },
  { q: "toplam alacak", sql: `SELECT ROUND(${OUT}, 2) FROM invoices i WHERE i.status IN ('open', 'overdue')` },
  { q: "en çok borcu olan 10 müşteri", sql: `SELECT c.name, ROUND(${OUT}, 2) o ${CUST} WHERE i.status IN ('open', 'overdue') GROUP BY c.id ORDER BY o DESC LIMIT 10` },
  { q: "segmentlere göre ortalama ödeme süresi", sql: `SELECT c.segment, ROUND(${DTP}, 1) ${CUST} WHERE i.status = 'paid' GROUP BY 1` },
  { q: "bu yıl kategori bazında satılan adet", sql: `SELECT p.category, SUM(il.quantity) ${LINES} WHERE ${NV} AND i.issued_at ${Y26} GROUP BY 1` },
  { q: "en çok satan 10 ürün", sql: `SELECT p.name, SUM(il.quantity) u ${LINES} WHERE ${NV} GROUP BY p.id ORDER BY u DESC LIMIT 10` },
  { q: "kategorilere göre brüt kâr", sql: `SELECT p.category, ROUND(${GP}, 2) ${LINES} WHERE ${NV} GROUP BY 1` },
  { q: "bu yıl gider türüne göre giderler", sql: `SELECT category, ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Y26} GROUP BY 1` },
  { q: "geçen çeyrek toplam giderler", sql: `SELECT ROUND(SUM(amount), 2) FROM expenses WHERE spent_at ${Q3}` },
  { q: "geçen yıl seyahat giderleri", sql: `SELECT ROUND(SUM(amount), 2) FROM expenses WHERE category = 'Travel' AND spent_at ${Y25}` },
  { q: "departmanlara göre giderler", sql: `SELECT department, ROUND(SUM(amount), 2) FROM expenses GROUP BY 1` },
  { q: "geçen ay tahsilat", sql: `SELECT ROUND(SUM(amount), 2) FROM payments WHERE paid_at ${OCT}` },
  { q: "ödeme yöntemine göre ödemeler", sql: `SELECT method, COUNT(*), ROUND(SUM(amount), 2) FROM payments GROUP BY 1` },
  { q: "bu yıl aylık yeni müşteri sayısı", sql: `SELECT strftime('%Y-%m', created_at), COUNT(*) FROM customers WHERE created_at ${Y26} GROUP BY 1` },
  { q: "son 3 ayda hiç faturası olmayan müşteriler", sql: `SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.issued_at ${L3M})` },
  { q: "hiç satılmamış ürünler", sql: `SELECT name FROM products p WHERE NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.product_id = p.id)` },
  { q: "20000 dolardan büyük faturalar", sql: `SELECT number FROM invoices WHERE total > 20000` },
  { q: "kredi limiti 30000'den fazla olan müşteriler", sql: `SELECT name FROM customers WHERE credit_limit > 30000` },
  { q: "segmente göre ortalama kredi limiti", sql: `SELECT segment, ROUND(AVG(credit_limit), 2) FROM customers GROUP BY 1` },
  { q: "bölgelere göre ciro payı", sql: `SELECT c.region, ${REV}, ROUND(100.0 * ${REV} / SUM(${REV}) OVER (), 1) ${CUST} WHERE ${NV} GROUP BY 1` },
  { q: "bu yıl ile geçen yıl ciro karşılaştırması", sql: `SELECT CASE WHEN i.issued_at ${Y26} THEN 'Bu yıl' ELSE 'Geçen yıl' END, ${REV} FROM invoices i WHERE ${NV} AND i.issued_at BETWEEN '2025-01-01' AND '2026-11-05' GROUP BY 1` },
  { q: "Almanya'daki müşterilerin bu yılki cirosu", sql: `SELECT ${REV} ${CUST} WHERE ${NV} AND c.country = 'Germany' AND i.issued_at ${Y26}` },
  { q: "Amerika hariç geçen yıl ciro", sql: `SELECT ${REV} ${CUST} WHERE ${NV} AND c.country <> 'United States' AND i.issued_at ${Y25}` },
  { q: "konaklama müşterilerinin ödenmemiş faturaları", sql: `SELECT i.number ${CUST} WHERE i.status IN ('open', 'overdue') AND c.segment = 'Hospitality'` },
  { q: "en pahalı 5 ürün", sql: `SELECT name FROM products ORDER BY unit_price DESC LIMIT 5` },
  { q: "2025 Q3 ciro", sql: `SELECT ${REV} FROM invoices i WHERE ${NV} AND i.issued_at BETWEEN '2025-07-01' AND '2025-09-30'` },
  { q: "Willow Labs'in bu yılki faturaları", sql: `SELECT i.number ${CUST} WHERE c.name = 'Willow Labs' AND i.issued_at ${Y26}` },
  { q: "satış temsilcisine göre bu yıl ciro", sql: `SELECT e.name, ${REV} ${CUST} JOIN employees e ON e.id = c.sales_rep_id WHERE ${NV} AND i.issued_at ${Y26} GROUP BY e.id` },
];
