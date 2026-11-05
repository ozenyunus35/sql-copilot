import { tokenizeSql, type Tok } from "./tokens";

/**
 * Formats SQL for reading: upper-case keywords, one clause per line, one select item per line,
 * AND / OR conditions on their own lines, and subqueries indented by depth. Comments and string
 * contents are kept as written.
 */

const CLAUSE = new Set(["SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "UNION", "EXCEPT", "INTERSECT", "WITH", "VALUES", "SET", "INSERT", "UPDATE", "DELETE", "WINDOW"]);
const JOIN_START = new Set(["JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL"]);

export function formatSql(sql: string): string {
  const toks = tokenizeSql(sql);
  if (!toks.length) return sql.trim();
  let out = "";
  let indent = 0;
  const stack: Array<{ select: boolean; indent: number; clause: string }> = [];
  let clause = "";
  let lineStart = true;
  const nl = (extra = 0) => {
    out = out.replace(/[ \t]+$/, "");
    out += "\n" + "  ".repeat(Math.max(0, indent + extra));
    lineStart = true;
  };
  const word = (t: Tok) => (t.kind === "kw" ? t.v : t.text);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1];
    const up = t.kind === "kw" ? t.v : "";
    if (t.kind === "comment") {
      if (!lineStart) out += " ";
      out += t.text;
      if (t.text.startsWith("--")) nl();
      continue;
    }
    if (t.text === ";") {
      out = out.replace(/\s+$/, "") + ";\n\n";
      indent = 0;
      clause = "";
      lineStart = true;
      continue;
    }
    if (t.text === "(") {
      const sub = toks[i + 1]?.v === "SELECT" || toks[i + 1]?.v === "WITH";
      out += (lineStart || prev?.text === "(" || (prev && /^[A-Za-z_]/.test(prev.text) && prev.kind !== "kw") ? "" : " ") + "(";
      stack.push({ select: sub, indent, clause });
      if (sub) {
        // The subquery sits one step inside the clause body it appears in.
        indent += 2;
        nl();
      }
      lineStart = sub;
      continue;
    }
    if (t.text === ")") {
      const top = stack.pop();
      if (top?.select) {
        indent = top.indent;
        clause = top.clause;
        nl(1);
        out += ")";
      } else out = out.replace(/[ \t]+$/, "") + ")";
      lineStart = false;
      continue;
    }
    const inSub = stack.length && !stack[stack.length - 1].select;
    if (!inSub && up && (CLAUSE.has(up) || JOIN_START.has(up)) && !(up === "JOIN" && JOIN_START.has(prev?.v ?? "")) && !(JOIN_START.has(up) && JOIN_START.has(prev?.v ?? "")) && !(up === "OUTER")) {
      if (out.trim() && !lineStart) nl();
      clause = up;
      out += up;
      lineStart = false;
      if (["SELECT", "WHERE", "HAVING", "SET"].includes(up) && toks[i + 1]?.v !== "DISTINCT") nl(1);
      continue;
    }
    if (!inSub && t.text === "," && clause === "SELECT") {
      out = out.replace(/\s+$/, "") + ",";
      nl(1);
      continue;
    }
    if (!inSub && (up === "AND" || up === "OR") && (clause === "WHERE" || clause === "HAVING") && !isBetweenAnd(toks, i)) {
      nl(1);
      out += up;
      lineStart = false;
      continue;
    }
    if (t.text === "," ) {
      out = out.replace(/\s+$/, "") + ",";
      lineStart = false;
      continue;
    }
    const glue = lineStart || t.text === "." || prev?.text === "." || prev?.text === "(" || (t.text === "(" ) ? "" : " ";
    out += glue + word(t);
    if (up === "DISTINCT" && clause === "SELECT" && prev?.v === "SELECT") nl(1);
    lineStart = false;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + (/;\s*$/.test(sql.trim()) || out.trim().endsWith(";") ? "" : ";");
}

function isBetweenAnd(toks: Tok[], i: number) {
  for (let k = i - 1; k >= 0 && k > i - 6; k--) {
    if (toks[k].v === "BETWEEN") return true;
    if (toks[k].v === "AND" || toks[k].v === "OR") return false;
  }
  return false;
}
