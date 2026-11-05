import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { Db } from "@/lib/db";
import { demoModel } from "@/lib/model";
import { parse } from "@/lib/nl/parse";
import { toSql } from "@/lib/nl/sql";
import { buildSeed } from "@/lib/seed";
import { sameAnswer } from "./compare";
import { TUNING, type Case } from "./fixtures/tuning";

const TODAY = "2026-11-05";

export async function score(cases: Case[]) {
  const SQL = await initSqlJs();
  const db = Db.create(SQL, buildSeed({ today: TODAY }).sql);
  const model = demoModel(db, TODAY);
  const failures: string[] = [];
  let right = 0;
  let unanswered = 0;
  for (const c of cases) {
    const expected = db.run(c.sql, 100000);
    const r = parse(c.q, model);
    if (!r.ok) {
      unanswered++;
      failures.push(`✗ ${c.q}\n   no answer: ${r.reason?.en}`);
      continue;
    }
    const { sql } = toSql(model, r.plan!);
    try {
      const got = db.run(sql, 100000);
      if (sameAnswer(expected, got)) right++;
      else failures.push(`✗ ${c.q}\n   rows ${got.rows.length} vs ${expected.rows.length}; ${r.plan!.notes.map((n) => n.en).join(" | ")}\n${sql.split("\n").map((l) => "     " + l).join("\n")}`);
    } catch (e) {
      failures.push(`✗ ${c.q}\n   SQL error ${(e as Error).message}\n${sql}`);
    }
  }
  return { right, unanswered, wrong: cases.length - right - unanswered, total: cases.length, failures };
}

describe("accuracy on the tuning questions", () => {
  it("answers them", async () => {
    const s = await score(TUNING);
    if (process.env.SHOW) console.log(s.failures.join("\n"));
    console.log(`tuning: ${s.right}/${s.total} (${Math.round((100 * s.right) / s.total)}%)`);
    expect(s.right).toBe(s.total);
  });
});

import { HOLDOUT } from "./fixtures/holdout";

describe("accuracy on the holdout questions", () => {
  it("answers them", async () => {
    const s = await score(HOLDOUT);
    if (process.env.SHOW_HOLDOUT) console.log(s.failures.join("\n"));
    console.log(`holdout: ${s.right}/${s.total} (${Math.round((100 * s.right) / s.total)}%)`);
    // Retired into tuning after its first run (77%); kept as a regression floor.
    expect(s.right).toBe(s.total);
  });
});

import { randomCases } from "./fixtures/random-questions";

describe("accuracy on random questions", () => {
  it("answers them", async () => {
    for (const seed of (process.env.SEEDS ?? "101,202,303").split(",").map(Number)) {
      const s = await score(randomCases(seed, Number(process.env.N ?? 300)));
      if (process.env.SHOW_RANDOM) console.log(s.failures.slice(0, Number(process.env.SHOW_RANDOM)).join("\n"));
      console.log(`random seed ${seed}: right ${s.right}/${s.total} (${Math.round((100 * s.right) / s.total)}%), wrong ${s.wrong} (${((100 * s.wrong) / s.total).toFixed(1)}%), no answer ${s.unanswered}`);
      expect(s.right / s.total).toBeGreaterThanOrEqual(0.95);
      expect(s.wrong / s.total).toBeLessThanOrEqual(0.03);
    }
  }, 120_000);
});

import { HOLDOUT2 } from "./fixtures/holdout2";

describe("accuracy on holdout 2", () => {
  it("answers them", async () => {
    const s = await score(HOLDOUT2);
    if (process.env.SHOW_HOLDOUT2) console.log(s.failures.join("\n"));
    console.log(`holdout2: right ${s.right}/${s.total} (${Math.round((100 * s.right) / s.total)}%), wrong ${s.wrong}, no answer ${s.unanswered}`);
    // First run was 46/56 (82%); retired into tuning afterwards, so now a regression floor.
    expect(s.right).toBe(s.total);
  });
});
