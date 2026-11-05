import type { Agg, Grain, Op } from "./lexicon";

export type Measure =
  | { kind: "metric"; metric: string }
  | { kind: "agg"; agg: Exclude<Agg, "count">; table: string; column: string }
  | { kind: "count"; table: string; distinct?: { table: string; column: string } };

export type Group =
  | { kind: "entity"; table: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "time"; table: string; column: string; grain: Grain }
  | { kind: "period"; table: string; column: string; ranges: Array<{ from: string | null; to: string | null; label: string }> };

export type Filter =
  | { kind: "value"; table: string; column: string; values: string[]; negate: boolean }
  | { kind: "like"; table: string; column: string; text: string; negate: boolean }
  | { kind: "compare"; table: string; column: string; op: Op; value: number; value2?: number }
  | { kind: "date"; table: string; column: string; from: string | null; to: string | null; label: string };

/** A HAVING condition on the first measure. */
export interface Having {
  op: Op;
  value: number;
  value2?: number;
}

export interface Note {
  kind: "measure" | "group" | "filter" | "date" | "order" | "limit" | "assume" | "ignored" | "shape";
  en: string;
  tr: string;
}

export interface Plan {
  lang: "en" | "tr";
  /** aggregate: measures (optionally grouped); list: rows of one table; anti: rows with no related rows. */
  kind: "aggregate" | "list" | "anti";
  /** The table rows are listed from (list/anti) or the main table of the measure (aggregate). */
  subject: string;
  measures: Measure[];
  groups: Group[];
  filters: Filter[];
  having: Having | null;
  /** For anti: the related table that must have no rows (with its own filters). */
  anti?: { table: string; filters: Filter[] };
  order: { by: "measure" | "column" | "group"; table?: string; column?: string; dir: "asc" | "desc" } | null;
  limit: number | null;
  share: boolean;
  growth: boolean;
  /** Count the groups instead of listing them ("how many customers spent over 10k"). */
  countGroups: boolean;
  /** Average of the measure over the groups ("average revenue per customer"). */
  averageGroups: boolean;
  /** Extra columns to show in a list. */
  columns: Array<{ table: string; column: string }>;
  notes: Note[];
}

export interface ParseResult {
  ok: boolean;
  plan?: Plan;
  /** Why it could not be answered, when ok is false. */
  reason?: { en: string; tr: string };
  /** Words that were not understood. */
  ignored: string[];
  /** 0-1: how much of the question was understood. */
  confidence: number;
  /** Other readings worth offering, as rephrased questions. */
  alternatives: Array<{ en: string; tr: string; question: string }>;
}
