/** A small SQL tokenizer: enough to split clauses, find tables and read conditions. */

export type TokKind = "kw" | "ident" | "string" | "number" | "op" | "punct" | "comment" | "param";
export interface Tok {
  kind: TokKind;
  text: string;
  /** Upper-cased keyword or lower-cased identifier, without quotes. */
  v: string;
  start: number;
  end: number;
  /** Parenthesis depth at this token. */
  depth: number;
}

export const KEYWORDS = new Set(
  "SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL ON USING AS AND OR NOT IN IS NULL LIKE GLOB BETWEEN EXISTS CASE WHEN THEN ELSE END DISTINCT ALL UNION INTERSECT EXCEPT WITH RECURSIVE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX DROP ALTER ADD COLUMN RENAME TO PRIMARY KEY FOREIGN REFERENCES DEFAULT UNIQUE CHECK ASC DESC NULLS FIRST LAST OVER PARTITION ROWS RANGE PRECEDING FOLLOWING CURRENT ROW UNBOUNDED TRUNCATE REPLACE IF PRAGMA BEGIN COMMIT ROLLBACK TRANSACTION ESCAPE COLLATE CAST TRUE FALSE FILTER WINDOW RETURNING CONFLICT DO NOTHING VACUUM ATTACH DETACH".split(" "),
);

export function tokenizeSql(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let depth = 0;
  const push = (kind: TokKind, start: number, end: number, v?: string) => out.push({ kind, text: sql.slice(start, end), v: v ?? sql.slice(start, end), start, end, depth });
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const e = sql.indexOf("\n", i);
      const end = e < 0 ? sql.length : e;
      push("comment", i, end);
      i = end;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const e = sql.indexOf("*/", i + 2);
      const end = e < 0 ? sql.length : e + 2;
      push("comment", i, end);
      i = end;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      push("string", i, Math.min(j + 1, sql.length), sql.slice(i + 1, j).replace(/''/g, "'"));
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < sql.length && sql[j] !== close) j++;
      push("ident", i, Math.min(j + 1, sql.length), sql.slice(i + 1, j).toLowerCase());
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(sql.slice(i))!;
      push("number", i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      const m = /^[A-Za-z_À-￿][A-Za-z0-9_$À-￿]*/.exec(sql.slice(i))!;
      const word = m[0];
      const up = word.toUpperCase();
      if (KEYWORDS.has(up)) push("kw", i, i + word.length, up);
      else push("ident", i, i + word.length, word.toLowerCase());
      i += word.length;
      continue;
    }
    if (c === "?" || c === ":" || c === "@" || c === "$") {
      const m = /^[?:@$][A-Za-z0-9_]*/.exec(sql.slice(i))!;
      push("param", i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", "==", "||", "<<", ">>"].includes(two)) {
      push("op", i, i + 2);
      i += 2;
      continue;
    }
    if (c === "(") {
      push("punct", i, i + 1);
      depth++;
      i++;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      push("punct", i, i + 1);
      i++;
      continue;
    }
    if ("=<>+-*/%&|~".includes(c)) push("op", i, i + 1);
    else push("punct", i, i + 1);
    i++;
  }
  return out;
}

/** Splits a script into statements at top-level semicolons (strings and comments respected). */
export function splitStatements(sql: string): string[] {
  const toks = tokenizeSql(sql);
  const out: string[] = [];
  let start = 0;
  for (const t of toks) {
    if (t.kind === "punct" && t.text === ";") {
      const s = sql.slice(start, t.start).trim();
      if (s && !/^(--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(s)) out.push(s);
      start = t.end;
    }
  }
  const rest = sql.slice(start).trim();
  if (rest && !/^(--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(rest)) out.push(rest);
  return out;
}
