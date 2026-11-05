import type { QueryResult } from "@/lib/db";

const norm = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "number" ? (Math.round(v * 10) / 10).toFixed(1) : String(v));

/**
 * True when the predicted result answers the same question as the expected one: the same number
 * of rows, and every expected column found among the predicted columns with the same values on
 * the same rows. Extra predicted columns (a share %, more list columns) are allowed; column names
 * and order are not compared. Numbers are compared to one decimal.
 */
export function sameAnswer(expected: QueryResult, got: QueryResult): boolean {
  if (expected.rows.length !== got.rows.length) return false;
  const exp = expected.columns.map((_, j) => expected.rows.map((r) => norm(r[j])));
  const pred = got.columns.map((_, j) => got.rows.map((r) => norm(r[j])));
  const bag = (xs: string[]) => [...xs].sort().join("\u0001");
  // Match each expected column to a predicted column holding the same values.
  const used = new Set<number>();
  const match: number[] = [];
  for (const col of exp) {
    const want = bag(col);
    const j = pred.findIndex((p, k) => !used.has(k) && bag(p) === want);
    if (j < 0) return false;
    used.add(j);
    match.push(j);
  }
  // And the values must sit on the same rows.
  const rowsE = expected.rows.map((r) => r.map(norm).join("\u0001")).sort();
  const rowsG = got.rows.map((r) => match.map((j) => norm(r[j])).join("\u0001")).sort();
  return rowsE.every((x, i) => x === rowsG[i]);
}
