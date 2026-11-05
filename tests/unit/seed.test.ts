import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { Db } from "@/lib/db";
import { buildSeed } from "@/lib/seed";

describe("demo database", async () => {
  const SQL = await initSqlJs();
  const seed = buildSeed({ today: "2026-11-05" });
  const db = Db.create(SQL, seed.sql);

  it("is the same every time for the same day", () => {
    expect(buildSeed({ today: "2026-11-05" }).sql).toBe(seed.sql);
  });

  it("has three years of data that ends today", () => {
    expect(seed.start).toBe("2023-11-01");
    expect(db.value("SELECT MAX(issued_at) FROM invoices")! <= "2026-11-05").toBe(true);
    expect(db.value("SELECT MIN(issued_at) FROM invoices")).toBe("2023-11-01");
    console.log(seed.counts);
  });

  it("keeps the books consistent", () => {
    // Invoice totals match their lines plus 8% tax.
    expect(db.value("SELECT COUNT(*) FROM invoices i WHERE ABS(i.subtotal - (SELECT SUM(line_total) FROM invoice_lines l WHERE l.invoice_id = i.id)) > 0.05")).toBe(0);
    expect(db.value("SELECT COUNT(*) FROM invoices WHERE ABS(total - subtotal - tax) > 0.011")).toBe(0);
    // Paid invoices are paid in full; nothing is paid twice.
    expect(db.value("SELECT COUNT(*) FROM invoices i WHERE status = 'paid' AND ABS(total - (SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id)) > 0.05")).toBe(0);
    expect(db.value("SELECT COUNT(*) FROM invoices i WHERE status <> 'paid' AND (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.invoice_id = i.id) >= total")).toBe(0);
    // Overdue means past due today; open means not yet due.
    expect(db.value("SELECT COUNT(*) FROM invoices WHERE status = 'overdue' AND due_at >= '2026-11-05'")).toBe(0);
    expect(db.value("SELECT COUNT(*) FROM invoices WHERE status = 'open' AND due_at < '2026-11-05'")).toBe(0);
    expect(db.value("SELECT COUNT(*) FROM payments WHERE paid_at > '2026-11-05'")).toBe(0);
    expect(db.value("PRAGMA foreign_key_check")).toBe(null);
  });

  it("looks like a real business", () => {
    const statuses = Object.fromEntries(db.run("SELECT status, COUNT(*) FROM invoices GROUP BY status").rows);
    console.log(statuses, db.run("SELECT substr(issued_at,1,4) y, ROUND(SUM(total)) FROM invoices WHERE status <> 'void' GROUP BY y").rows);
    expect(Number(statuses.overdue)).toBeGreaterThan(10);
    expect(Number(statuses.open)).toBeGreaterThan(30);
    expect(Number(statuses.void)).toBeGreaterThan(5);
  });
});
