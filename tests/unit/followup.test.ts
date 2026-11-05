import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { Db } from "@/lib/db";
import { demoModel } from "@/lib/model";
import { parse } from "@/lib/nl/parse";
import { toSql } from "@/lib/nl/sql";
import { buildSeed } from "@/lib/seed";

const TODAY = "2026-11-05";

describe("follow-up questions", async () => {
  const SQL = await initSqlJs();
  const db = Db.create(SQL, buildSeed({ today: TODAY }).sql);
  const model = demoModel(db, TODAY);
  /** Asks a chain of questions, each a follow-up to the one before, and returns the last SQL. */
  const chain = (...qs: string[]) => {
    let base: { plan: NonNullable<ReturnType<typeof parse>["plan"]>; question: string } | undefined;
    let sql = "";
    for (const q of qs) {
      const r = parse(q, model, { base });
      expect(r.ok, `${q}: ${r.reason?.en}`).toBe(true);
      base = { plan: r.plan!, question: q };
      sql = toSql(model, r.plan!).sql.replace(/\s+/g, " ");
    }
    return sql;
  };
  const same = (a: string, b: string) => expect(db.run(a).rows).toEqual(db.run(b).rows);

  it("changes the grouping: “now by month”, “aylık”", () => {
    const s = chain("revenue from Germany this year", "now by month");
    expect(s).toContain("strftime('%Y-%m', i.issued_at)");
    expect(s).toContain("c.country = 'Germany'");
    expect(s).toContain("BETWEEN '2026-01-01' AND '2026-11-05'");
    expect(chain("bu yıl Almanya cirosu", "aylık")).toContain("strftime('%Y-%m', i.issued_at)");
  });

  it("swaps a filter value: “what about France?”, “peki Fransa?”", () => {
    same(chain("revenue from Germany this year", "what about France?"), chain("revenue from France this year"));
    same(chain("bu yıl Almanya'daki müşterilerin cirosu", "peki Fransa?"), chain("bu yıl Fransa'daki müşterilerin cirosu"));
  });

  it("adds a value with “also”, keeps the ranking with a new date", () => {
    expect(chain("revenue from Germany", "also France")).toContain("c.country IN ('Germany', 'France')");
    const s = chain("top 5 customers by revenue last quarter", "what about last year?");
    expect(s).toContain("BETWEEN '2025-01-01' AND '2025-12-31'");
    expect(s).toContain("LIMIT 5");
  });

  it("narrows and widens: “only retail”, “all countries”", () => {
    const s = chain("revenue by country this year", "only retail");
    expect(s).toContain("c.segment = 'Retail'");
    expect(s).toContain("GROUP BY c.country");
    expect(chain("revenue from Germany by segment", "all countries")).not.toContain("Germany");
  });

  it("swaps the measure: “units instead”", () => {
    expect(chain("revenue by category this year", "units instead")).toContain("SUM(il.quantity)");
  });

  it("treats a full new question as new", () => {
    expect(chain("revenue from Germany this year", "how many customers do we have")).toBe("SELECT COUNT(*) AS customers FROM customers AS c;");
  });
});
