import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { Db } from "@/lib/db";
import { demoModel } from "@/lib/model";
import { findDateRanges } from "@/lib/nl/dates";
import { tokenize } from "@/lib/nl/text";
import { buildSeed } from "@/lib/seed";
import { explain, explainError } from "@/lib/sql/explain";
import { splitStatements } from "@/lib/sql/tokens";

const TODAY = "2026-11-05";

describe("SQL explanations and checks", async () => {
  const SQL = await initSqlJs();
  const db = Db.create(SQL, buildSeed({ today: TODAY }).sql);
  const model = demoModel(db, TODAY);
  const lints = (sql: string) => explain(sql, model).flatMap((e) => e.lints.map((l) => `${l.level}: ${l.en}`));

  it("explains a grouped query step by step, in both languages", () => {
    const [e] = explain(`SELECT c.name AS customer, ROUND(SUM(i.total), 2) AS revenue FROM invoices AS i JOIN customers AS c ON c.id = i.customer_id WHERE i.status <> 'void' GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT 5`, model);
    expect(e.kind).toBe("select");
    expect(e.summary.en).toBe("Computes revenue for each customer id and customer from invoices + customers, after filtering, top 5.");
    expect(e.steps.map((s) => s.title.en)).toEqual(["Data", "Filter rows", "Group", "Columns", "Sort", "Limit"]);
    expect(e.steps[1].detail.tr).toContain("fatura durumu: 'void' değil");
    expect(e.lints).toEqual([]);
  });
  it("describes window functions and named steps", () => {
    const [e] = explain("WITH monthly AS (SELECT strftime('%Y-%m', issued_at) AS month, SUM(total) AS revenue FROM invoices GROUP BY month) SELECT month, revenue, SUM(revenue) OVER (ORDER BY month) AS running, LAG(revenue) OVER (ORDER BY month) AS prev, RANK() OVER (ORDER BY revenue DESC) AS rnk FROM monthly", model);
    expect(e.summary.en).toBe("Lists 5 columns from monthly (WITH), with a running total (running) and the previous row's value (prev) and a rank (rnk).");
    expect(e.steps.map((s) => s.title.en)).toContain("Window functions");
    expect(e.summary.tr).toContain("kümülatif toplam (running)");
    expect(explain("SELECT month, ROUND(SUM(revenue) OVER (ORDER BY month), 2) AS total FROM monthly", model)[0].summary.en).toContain("a running total (total)");
  });

  it("flags the classic mistakes", () => {
    expect(lints("SELECT * FROM customers WHERE country = NULL")).toContain('error: "= NULL" is never true. Use IS NULL.');
    expect(lints("DELETE FROM invoices")[0]).toMatch(/^error: This DELETE has no WHERE/);
    expect(lints("UPDATE customers SET status = 'inactive'")[0]).toMatch(/^error: This UPDATE has no WHERE/);
    expect(lints("SELECT c.name FROM customers c WHERE SUM(c.credit_limit) > 5 GROUP BY c.name")[0]).toMatch(/WHERE runs before grouping/);
    expect(lints("SELECT country, city, COUNT(*) FROM customers GROUP BY country")[0]).toMatch(/city is neither grouped nor aggregated/);
    // Grouping by a primary key fixes the other columns of that table, but not of the joined one.
    expect(lints("SELECT c.name, c.country, SUM(i.total) FROM customers c JOIN invoices i ON i.customer_id = c.id GROUP BY c.id")).toEqual([]);
    expect(lints("SELECT c.name, i.status, SUM(i.total) FROM customers c JOIN invoices i ON i.customer_id = c.id GROUP BY c.id")[0]).toMatch(/i\.status is neither grouped/);
    expect(lints("SELECT c.name, SUM(i.total) FROM customers c JOIN invoices i ON i.customer_id = c.id JOIN invoice_lines il ON il.invoice_id = i.id GROUP BY c.name").join()).toMatch(/total is inflated/);
    expect(lints("SELECT * FROM invoices WHERE status = 'paid' OR status = 'open' AND total > 5").join()).toMatch(/AND and OR are mixed/);
    expect(lints("SELECT * FROM invoices WHERE issued_at > '1/3/2025'").join()).toMatch(/not in YYYY-MM-DD form/);
    expect(lints("SELECT * FROM products p WHERE p.id NOT IN (SELECT product_id FROM invoice_lines)").join()).toMatch(/NOT EXISTS is safer/);
    expect(lints("SELECT * FROM customers, invoices").join()).toMatch(/cross joined with no condition|no ON condition/);
    expect(lints("DROP TABLE customers")[0]).toMatch(/permanently removes/);
    expect(lints("SELECT * FROM invoices LIMIT 5").join()).toMatch(/LIMIT without ORDER BY/);
    expect(lints("SELECT il.quantity / il.quantity FROM invoice_lines il").join()).toMatch(/drops the decimals/);
  });

  it("turns SQLite errors into hints", () => {
    expect(explainError("no such column: custmer_id", model).en).toBe("There is no column called “custmer_id”. Did you mean “customer_id” (in invoices)?");
    expect(explainError("no such table: invoice", model).en).toContain("Did you mean “invoices”?");
    expect(explainError('near "FORM": syntax error', model).tr).toContain("söz dizimi hatası");
  });

  it("splits scripts on semicolons outside strings and comments", () => {
    expect(splitStatements("SELECT 'a;b'; -- c;\nSELECT 2; /* x; */")).toEqual(["SELECT 'a;b'", "-- c;\nSELECT 2"]);
  });
});

describe("dates in questions", () => {
  const r = (q: string) => findDateRanges(tokenize(q), TODAY).map((x) => `${x.from}..${x.to}`);
  it("reads English and Turkish periods", () => {
    expect(r("last 6 months")).toEqual(["2026-05-06..2026-11-05"]);
    expect(r("son 6 ayda")).toEqual(["2026-05-06..2026-11-05"]);
    expect(r("last month")).toEqual(["2026-10-01..2026-10-31"]);
    expect(r("geçen çeyrek")).toEqual(["2026-07-01..2026-09-30"]);
    expect(r("this year")).toEqual(["2026-01-01..2026-11-05"]);
    expect(r("bu yılki")).toEqual(["2026-01-01..2026-11-05"]);
    expect(r("in Q3 2025")).toEqual(["2025-07-01..2025-09-30"]);
    expect(r("the third quarter of 2025")).toEqual(["2025-07-01..2025-09-30"]);
    expect(r("2025 3. çeyrekte")).toEqual(["2025-07-01..2025-09-30"]);
    expect(r("between March and June 2026")).toEqual(["2026-03-01..2026-06-30"]);
    expect(r("mart ile haziran 2026 arasında")).toEqual(["2026-03-01..2026-06-30"]);
    expect(r("2024'ten beri")).toEqual(["2024-01-01..2026-11-05"]);
    expect(r("before 2025")).toEqual(["null..2024-12-31"]);
    expect(r("eylül ayında")).toEqual(["2026-09-01..2026-09-30"]);
    expect(r("December")).toEqual(["2025-12-01..2025-12-31"]);
    expect(r("year to date")).toEqual(["2026-01-01..2026-11-05"]);
    expect(r("revnue last quater")).toEqual(["2026-07-01..2026-09-30"]);
    expect(r("14.03.2026")).toEqual(["2026-03-14..2026-03-14"]);
  });
});
