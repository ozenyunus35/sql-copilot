import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { suggestQuestion, suggestSql } from "@/lib/complete";
import { Db } from "@/lib/db";
import { insights, previousPeriod } from "@/lib/insights";
import { demoModel } from "@/lib/model";
import { parse } from "@/lib/nl/parse";
import { toSql } from "@/lib/nl/sql";
import { columnFormats } from "@/lib/present";
import { buildSeed } from "@/lib/seed";
import { explain } from "@/lib/sql/explain";
import { formatSql } from "@/lib/sql/format";
import { snippets } from "@/lib/sql/snippets";

const TODAY = "2026-11-05";

describe("tools around the answer", async () => {
  const db = Db.create(await initSqlJs(), buildSeed({ today: TODAY }).sql);
  const model = demoModel(db, TODAY);
  const run = (q: string) => {
    const p = parse(q, model).plan!;
    const r = db.run(toSql(model, p).sql);
    return { p, r, f: columnFormats(r, model, p) };
  };

  it("formats SQL clause by clause, keeping the query the same", () => {
    const raw = "select c.name, sum(i.total) as revenue from invoices i join customers c on c.id = i.customer_id where i.status <> 'void' and i.issued_at between '2026-01-01' and '2026-11-05' group by c.name order by revenue desc limit 5";
    const out = formatSql(raw);
    expect(out).toBe(
      "SELECT\n  c.name,\n  sum(i.total) AS revenue\nFROM invoices i\nJOIN customers c ON c.id = i.customer_id\nWHERE\n  i.status <> 'void'\n  AND i.issued_at BETWEEN '2026-01-01' AND '2026-11-05'\nGROUP BY c.name\nORDER BY revenue DESC\nLIMIT 5;",
    );
    expect(db.run(out).rows).toEqual(db.run(raw).rows);
    const sub = formatSql("select name from products p where not exists (select 1 from invoice_lines il where il.product_id = p.id)");
    expect(db.run(sub).rows.length).toBe(3);
    expect(sub).toContain("NOT EXISTS (\n    SELECT\n      1\n    FROM invoice_lines il");
  });

  it("reads a ranking and a time series like an analyst", () => {
    const a = run("revenue by segment");
    expect(insights(a.r, a.f, a.p, model).map((x) => x.en)[0]).toMatch(/^Corporate is \d+\.\d% of the total/);
    const t = run("monthly revenue this year");
    const notes = insights(t.r, t.f, t.p, model).map((x) => x.en);
    expect(notes[0]).toMatch(/^2026-10 vs 2026-09: [+-]\d+\.\d% .*leaving out 2026-11, which is still running\.$/);
  });

  it("compares a single number with the period before", () => {
    const q = run("revenue last quarter");
    const prev = previousPeriod(q.p, model, db, Number(q.r.rows[0][0]))!;
    expect(prev.en).toMatch(/vs the period before \(2026-04-01 → 2026-06-30: /);
    const expected = Number(db.value("SELECT ROUND(SUM(total), 2) FROM invoices WHERE status <> 'void' AND issued_at BETWEEN '2026-04-01' AND '2026-06-30'"));
    expect(prev.en).toContain(expected.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  });

  it("suggests words as you type, in both languages", () => {
    expect(suggestQuestion("top 5 cust", 10, model, "en").items[0]).toMatchObject({ text: "customers", kind: "table" });
    expect(suggestQuestion("ger", 3, model, "en").items.map((s) => s.text)).toContain("Germany");
    expect(suggestQuestion("geçen ç", 7, model, "tr").items[0].text).toBe("geçen çeyrek");
    expect(suggestQuestion("ödeme sü", 8, model, "tr").items.map((s) => s.text)).toContain("ortalama ödeme süresi (gün)");
    const s = suggestSql("SELECT i.st FROM invoices AS i", 11, model);
    expect(s.items.map((x) => x.text)).toEqual(["status"]);
    expect(suggestSql("SELECT * FROM inv", 17, model).items[0].text).toBe("invoices");
  });
  it("runs every example query, formatted, with rows and no errors flagged", () => {
    for (const x of snippets(model, true)) {
      const sql = formatSql(x.sql);
      const r = db.run(sql);
      expect(r.rows.length, x.title.en).toBeGreaterThan(0);
      expect(r.rows).toEqual(db.run(x.sql).rows);
      expect(explain(sql, model).flatMap((e) => e.lints.filter((l) => l.level === "error")), x.title.en).toEqual([]);
    }
  });
});
