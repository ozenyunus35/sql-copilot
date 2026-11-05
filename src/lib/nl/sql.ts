import { table as tableOf, type MetricModel, type Model, type TableModel } from "../model";
import { pathBetween } from "./parse";
import type { Filter, Group, Measure, Plan } from "./plan";

/** Short, readable table aliases: customers c, invoices i, invoice_lines il, payments pa. */
export function aliases(model: Model): Record<string, string> {
  const out: Record<string, string> = {};
  const taken = new Set<string>(["as", "on", "in", "is", "or", "by", "if", "to", "do", "of", "pay"]);
  for (const t of model.tables) {
    const words = t.name.toLowerCase().replace(/[^a-z0-9_]/g, "_").split("_").filter(Boolean);
    const initials = words.map((w) => w[0]).join("") || "t";
    const base = words[0] ?? "t";
    const cands = [initials, base.slice(0, 2), base.slice(0, 3), `${initials}${words.length}`, `t${Object.keys(out).length + 1}`];
    const a = cands.find((c) => /^[a-z]/.test(c) && !taken.has(c)) ?? `t${Object.keys(out).length + 1}`;
    taken.add(a);
    out[t.name] = a;
  }
  return out;
}

/** Quotes an identifier only when it needs it. */
export const ident = (s: string) => (/^[a-z_][a-z0-9_]*$/.test(s) && !RESERVED.has(s) ? s : `"${s.replace(/"/g, '""')}"`);
const RESERVED = new Set(["order", "group", "select", "from", "where", "table", "index", "by", "limit", "values", "default", "check", "key", "primary", "references", "date", "time", "case", "when", "end", "to", "as", "and", "or", "not", "null", "is", "in", "on", "join", "all", "having", "union", "transaction", "column", "desc", "asc", "count", "sum", "max", "min", "avg", "user", "type"]);
const lit = (v: string | number) => (typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

interface Built {
  sql: string;
  /** Output column names, in order. */
  columns: string[];
  /** Notes about how the SQL was shaped (finer measure, de-duplication). */
  notes: Array<{ en: string; tr: string }>;
}

/** Builds SQL for a plan. The query is read-only and formatted for people to read. */
export function toSql(model: Model, input: Plan): Built {
  const plan: Plan = structuredClone(input);
  const A = aliases(model);
  const notes: Built["notes"] = [];
  const metric = (id: string) => model.metrics.find((m) => m.id === id) as MetricModel;
  const sub = (sql: string) => sql.replace(/\{([a-z_0-9]+)\}/gi, (_, t: string) => A[t] ?? t);

  if (plan.kind === "anti") return anti(model, plan, A);

  const T = tableOf(model, plan.subject);
  if (plan.kind === "list") return list(model, plan, A);

  // ---- Aggregates ----
  const measureTable = (m: Measure) => (m.kind === "metric" ? metric(m.metric).table : m.table);
  let base = measureTable(plan.measures[0]);
  const used = () => {
    const s = new Set<string>();
    for (const g of plan.groups) s.add(g.kind === "entity" ? g.table : g.table);
    for (const f of plan.filters) s.add(f.table);
    for (const m of plan.measures) {
      s.add(measureTable(m));
      if (m.kind === "metric") for (const j of metric(m.metric).joins ?? []) s.add(j);
    }
    s.delete(base);
    return s;
  };
  // Moving from the one side to the many side of a relation repeats rows: SUM would double count.
  const fansOut = (from: string, to: string) => {
    const p = pathBetween(model, from, to);
    if (!p) return true;
    for (let i = 0; i < p.length - 1; i++) if (model.relations.some((r) => r.to.table === p[i] && r.from.table === p[i + 1])) return true;
    return false;
  };
  // A group or filter below the measure's grain: use the measure's finer version if there is one.
  for (const g of plan.groups) {
    const t = g.table;
    if (t !== base && fansOut(base, t)) {
      const m0 = plan.measures[0];
      if (m0.kind === "metric" && metric(m0.metric).finer && !fansOut(metric(metric(m0.metric).finer!).table, t)) {
        const finer = metric(metric(m0.metric).finer!);
        notes.push({ en: `Used ${finer.label.toLowerCase()} (${finer.note.toLowerCase()}), because ${tableOf(model, t).plural} are counted per invoice line`, tr: `${tableOf(model, t).labelTr} fatura satırı düzeyinde olduğu için ${finer.labelTr.toLocaleLowerCase("tr")} kullanıldı (${finer.noteTr.toLocaleLowerCase("tr")})` });
        plan.measures[0] = { kind: "metric", metric: finer.id };
        base = finer.table;
      }
    }
  }
  // Filters on the many side become EXISTS conditions, so they don't repeat rows either.
  const exists: string[] = [];
  const joinFilters: Filter[] = [];
  for (const f of plan.filters) {
    if (f.table !== base && fansOut(base, f.table) && !plan.groups.some((g) => g.table === f.table) && !plan.measures.some((m) => m.kind === "metric" && (metric(m.metric).joins ?? []).includes(f.table))) {
      const m0 = plan.measures[0];
      if (m0.kind === "metric" && metric(m0.metric).finer && !fansOut(metric(metric(m0.metric).finer!).table, f.table) && metric(m0.metric).table === "invoices" && ["products", "invoice_lines"].includes(f.table)) {
        const finer = metric(metric(m0.metric).finer!);
        notes.push({ en: `Used ${finer.label.toLowerCase()}, because the filter is on ${tableOf(model, f.table).plural}`, tr: `Filtre ${tableOf(model, f.table).labelTr} üzerinde olduğu için ${finer.labelTr.toLocaleLowerCase("tr")} kullanıldı` });
        plan.measures[0] = { kind: "metric", metric: finer.id };
        base = finer.table;
        joinFilters.push(f);
        continue;
      }
      exists.push(existsClause(model, A, base, f.table, [f]));
    } else joinFilters.push(f);
  }
  // Counting rows of the base table across a fan-out join must count each row once.
  const needsDistinct = [...used()].some((t) => fansOut(base, t));

  const joins = joinClauses(model, A, base, used());
  const select: string[] = [];
  const groupBy: string[] = [];
  const outCols: string[] = [];
  const names = new Set<string>();
  const name = (n: string) => {
    let x = n.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "value";
    if (/^\d/.test(x)) x = `c_${x}`;
    let y = x;
    for (let i = 2; names.has(y); i++) y = `${x}_${i}`;
    names.add(y);
    return y;
  };
  const groupExprs: string[] = [];
  for (const g of plan.groups) {
    const e = groupExpr(model, A, g);
    const n = name(e.name);
    select.push(`${e.expr} AS ${ident(n)}`);
    groupBy.push(...e.groupBy);
    groupExprs.push(ident(n));
    outCols.push(n);
  }
  const measureExprs: string[] = [];
  const measureNames: string[] = [];
  for (const m of plan.measures) {
    const e = measureExpr(model, A, m, needsDistinct, sub);
    const n = name(e.name);
    select.push(`${e.expr} AS ${ident(n)}`);
    measureExprs.push(e.expr);
    measureNames.push(ident(n));
    outCols.push(n);
  }
  if (plan.share && measureExprs[0] && plan.groups.length) {
    select.push(`ROUND(100.0 * ${measureExprs[0]} / SUM(${measureExprs[0]}) OVER (), 1) AS share_pct`);
    outCols.push("share_pct");
  }
  if (plan.growth && measureExprs[0] && plan.groups.some((g) => g.kind === "time")) {
    const by = groupExpr(model, A, plan.groups.find((g) => g.kind === "time")!).expr;
    const prev = `LAG(${measureExprs[0]}) OVER (ORDER BY ${by})`;
    select.push(`ROUND(100.0 * (${measureExprs[0]} - ${prev}) / NULLIF(${prev}, 0), 1) AS change_pct`);
    outCols.push("change_pct");
  }

  const where: string[] = [];
  for (const m of plan.measures) if (m.kind === "metric" && metric(m.metric).where) where.push(sub(metric(m.metric).where!));
  for (const f of joinFilters) where.push(filterSql(model, A, f));
  where.push(...exists);

  const having = plan.having
    ? plan.having.value2 !== undefined
      ? `${measureExprs[0]} BETWEEN ${plan.having.value} AND ${plan.having.value2}`
      : `${measureExprs[0]} ${plan.having.op} ${plan.having.value}`
    : null;

  let order: string | null = null;
  if (plan.order) {
    if (plan.order.by === "measure") order = `${measureNames[0]} ${plan.order.dir.toUpperCase()}`;
    else if (plan.order.by === "group" && groupExprs.length) order = groupExprs.map((g) => `${g} ${plan.order!.dir.toUpperCase()}`).join(", ");
  }
  // Ties on the measure fall back to the group, so results don't shuffle between runs.
  if (order && plan.order?.by === "measure" && groupExprs.length) order += `, ${groupExprs[0]}`;

  const lines = [`SELECT`, select.map((s) => `  ${s}`).join(",\n"), `FROM ${ident(base)} AS ${A[base]}`, ...joins];
  if (where.length) lines.push(`WHERE ${where.join("\n  AND ")}`);
  if (groupBy.length) lines.push(`GROUP BY ${[...new Set(groupBy)].join(", ")}`);
  if (having) lines.push(`HAVING ${having}`);

  if (plan.countGroups || plan.averageGroups) {
    const inner = lines.join("\n").split("\n").map((l) => `  ${l}`).join("\n");
    if (plan.countGroups) {
      const ent = plan.groups.find((g) => g.kind === "entity");
      const n = ent ? tableOf(model, ent.table).plural.replace(/\s+/g, "_") : "groups";
      return { sql: `SELECT COUNT(*) AS ${ident(n)}\nFROM (\n${inner}\n) AS g;`, columns: [n], notes };
    }
    const mn = measureNames[0];
    const n = `avg_${mn.replace(/"/g, "")}`;
    return { sql: `SELECT ROUND(AVG(${mn}), 2) AS ${ident(n)}\nFROM (\n${inner}\n) AS g;`, columns: [n], notes };
  }
  if (order) lines.push(`ORDER BY ${order}`);
  if (plan.limit) lines.push(`LIMIT ${plan.limit}`);
  void T;
  return { sql: lines.join("\n") + ";", columns: outCols, notes };
}

function groupExpr(model: Model, A: Record<string, string>, g: Group): { expr: string; name: string; groupBy: string[] } {
  const c = (t: string, x: string) => `${A[t]}.${ident(x)}`;
  if (g.kind === "entity") {
    const t = tableOf(model, g.table);
    const nameCol = t.nameColumn ?? t.columns.find((x) => x.role === "code")?.name ?? t.pk ?? t.columns[0].name;
    return { expr: c(t.name, nameCol), name: t.label.replace(/\s+/g, "_"), groupBy: [...(t.pk && t.pk !== nameCol ? [c(t.name, t.pk)] : []), c(t.name, nameCol)] };
  }
  if (g.kind === "column") {
    const cm = tableOf(model, g.table).columns.find((x) => x.name === g.column)!;
    return { expr: c(g.table, g.column), name: cm.name, groupBy: [c(g.table, g.column)] };
  }
  if (g.kind === "time") {
    const x = c(g.table, g.column);
    const expr = {
      day: `date(${x})`,
      week: `date(${x}, 'weekday 0', '-6 days')`,
      month: `strftime('%Y-%m', ${x})`,
      quarter: `strftime('%Y', ${x}) || '-Q' || ((CAST(strftime('%m', ${x}) AS INTEGER) + 2) / 3)`,
      year: `strftime('%Y', ${x})`,
    }[g.grain];
    return { expr, name: g.grain === "week" ? "week_starting" : g.grain, groupBy: [expr] };
  }
  const x = c(g.table, g.column);
  const cases = g.ranges.map((r) => `    WHEN ${r.from && r.to ? `${x} BETWEEN ${lit(r.from)} AND ${lit(r.to)}` : r.from ? `${x} >= ${lit(r.from)}` : `${x} <= ${lit(r.to!)}`} THEN ${lit(r.label)}`).join("\n");
  const expr = `CASE\n${cases}\n  END`;
  return { expr, name: "period", groupBy: [expr] };
}

function measureExpr(model: Model, A: Record<string, string>, m: Measure, distinct: boolean, sub: (s: string) => string): { expr: string; name: string } {
  if (m.kind === "metric") {
    const x = model.metrics.find((y) => y.id === m.metric)!;
    let e = sub(x.sql);
    if (x.unit === "money" && e.startsWith("SUM(")) e = `ROUND(${e}, 2)`;
    return { expr: e, name: x.id };
  }
  const t = tableOf(model, m.table);
  if (m.kind === "count") {
    const e = distinct && t.pk ? `COUNT(DISTINCT ${A[t.name]}.${ident(t.pk)})` : "COUNT(*)";
    return { expr: e, name: t.plural.replace(/\s+/g, "_") };
  }
  const c = `${A[t.name]}.${ident(m.column)}`;
  const role = t.columns.find((x) => x.name === m.column)?.role;
  const fn = m.agg.toUpperCase();
  const e = m.agg === "avg" || (m.agg === "sum" && role === "money") ? `ROUND(${fn}(${c}), 2)` : `${fn}(${c})`;
  return { expr: e, name: `${m.agg === "sum" ? "total" : m.agg}_${m.column}` };
}

export function filterSql(model: Model, A: Record<string, string>, f: Filter): string {
  const cm = tableOf(model, f.table).columns.find((x) => x.name === f.column)!;
  const c = `${A[f.table]}.${ident(f.column)}`;
  const v = (x: string) => (cm.type === "integer" || cm.type === "real" ? (Number.isFinite(Number(x)) ? x : lit(x)) : lit(x));
  if (f.kind === "value") {
    if (f.values.length === 1) return `${c} ${f.negate ? "<>" : "="} ${v(f.values[0])}`;
    return `${c} ${f.negate ? "NOT IN" : "IN"} (${f.values.map(v).join(", ")})`;
  }
  if (f.kind === "like") return `${c} ${f.negate ? "NOT LIKE" : "LIKE"} ${lit(`%${f.text}%`)}`;
  if (f.kind === "compare") return f.value2 !== undefined ? `${c} BETWEEN ${f.value} AND ${f.value2}` : `${c} ${f.op} ${f.value}`;
  // Dates: stored as YYYY-MM-DD text; columns with a time part are compared by their date.
  const dc = cm.type === "date" && model.source === "demo" ? c : `date(${c})`;
  if (f.from && f.to) return f.from === f.to ? `${dc} = ${lit(f.from)}` : `${dc} BETWEEN ${lit(f.from)} AND ${lit(f.to)}`;
  if (f.from) return `${dc} >= ${lit(f.from)}`;
  return `${dc} <= ${lit(f.to!)}`;
}

/** JOIN lines that bring every needed table in, following the relations from the base table. */
function joinClauses(model: Model, A: Record<string, string>, base: string, needed: Set<string>, left = false): string[] {
  const joined = new Set([base]);
  const out: string[] = [];
  for (const t of needed) {
    const path = pathBetween(model, base, t);
    if (!path) continue;
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      if (joined.has(b)) continue;
      const r = model.relations.find((x) => (x.from.table === a && x.to.table === b) || (x.from.table === b && x.to.table === a))!;
      const on = `${A[r.to.table]}.${ident(r.to.column)} = ${A[r.from.table]}.${ident(r.from.column)}`;
      out.push(`${left ? "LEFT JOIN" : "JOIN"} ${ident(b)} AS ${A[b]} ON ${on}`);
      joined.add(b);
    }
  }
  return out;
}

/** EXISTS (...) linking the base table to rows of another table that match the filters. */
function existsClause(model: Model, A: Record<string, string>, base: string, target: string, filters: Filter[], negate = false): string {
  const path = pathBetween(model, base, target)!;
  // Inner aliases get a "2" so they never shadow the outer query's.
  const inner: Record<string, string> = Object.fromEntries(Object.entries(A).map(([k, v]) => [k, `${v}2`]));
  const first = path[1];
  const r0 = model.relations.find((x) => (x.from.table === base && x.to.table === first) || (x.from.table === first && x.to.table === base))!;
  const link = r0.from.table === first ? `${inner[first]}.${ident(r0.from.column)} = ${A[base]}.${ident(r0.to.column)}` : `${inner[first]}.${ident(r0.to.column)} = ${A[base]}.${ident(r0.from.column)}`;
  const joins: string[] = [];
  for (let i = 2; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const r = model.relations.find((x) => (x.from.table === a && x.to.table === b) || (x.from.table === b && x.to.table === a))!;
    joins.push(`JOIN ${ident(b)} AS ${inner[b]} ON ${inner[r.to.table]}.${ident(r.to.column)} = ${inner[r.from.table]}.${ident(r.from.column)}`);
  }
  const conds = [link, ...filters.map((f) => filterSql(model, inner, f))];
  const body = [`SELECT 1 FROM ${ident(first)} AS ${inner[first]}`, ...joins.map((j) => `    ${j}`), `    WHERE ${conds.join(" AND ")}`].join("\n");
  return `${negate ? "NOT " : ""}EXISTS (\n    ${body}\n  )`;
}

/** Columns to show for a table's rows; a foreign key shows the related row's name. */
function listSelect(model: Model, A: Record<string, string>, t: TableModel, extra: Array<{ table: string; column: string }>) {
  const select: string[] = [];
  const display: string[] = [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (expr: string, n: string) => {
    if (seen.has(n)) return;
    seen.add(n);
    select.push(n === expr.split(".").pop() ? expr : `${expr} AS ${ident(n)}`);
    out.push(n);
  };
  const cols = [...t.listColumns, ...extra.filter((e) => e.table === t.name).map((e) => e.column)];
  for (const c of cols) {
    const cm = t.columns.find((x) => x.name === c);
    if (!cm) continue;
    if (cm.role === "fk" && cm.ref) {
      const rt = tableOf(model, cm.ref.table);
      const show = rt.nameColumn ?? rt.columns.find((x) => x.role === "code")?.name;
      if (show) {
        display.push(rt.name);
        add(`${A[rt.name]}.${ident(show)}`, rt.label.replace(/\s+/g, "_"));
        continue;
      }
    }
    add(`${A[t.name]}.${ident(c)}`, c);
  }
  // Columns of related tables asked for by name ("customer emails"), when they join one-to-one or many-to-one.
  for (const e of extra) {
    if (e.table === t.name) continue;
    const p = pathBetween(model, t.name, e.table);
    if (!p) continue;
    let manyToOne = true;
    for (let i = 0; i < p.length - 1; i++) if (!model.relations.some((r) => r.from.table === p[i] && r.to.table === p[i + 1])) manyToOne = false;
    if (!manyToOne) continue;
    display.push(e.table);
    add(`${A[e.table]}.${ident(e.column)}`, `${tableOf(model, e.table).label.replace(/\s+/g, "_")}_${e.column}`);
  }
  return { select, display, out };
}

function list(model: Model, plan: Plan, A: Record<string, string>): Built {
  const t = tableOf(model, plan.subject);
  const { select, display, out } = listSelect(model, A, t, plan.columns);
  const where: string[] = [];
  const needed = new Set<string>(display);
  const fansOut = (from: string, to: string) => {
    const p = pathBetween(model, from, to);
    if (!p) return true;
    for (let i = 0; i < p.length - 1; i++) if (model.relations.some((r) => r.to.table === p[i] && r.from.table === p[i + 1])) return true;
    return false;
  };
  // Filters on the same table or a parent go in WHERE; on child tables they become EXISTS.
  const byTable = new Map<string, Filter[]>();
  for (const f of plan.filters) {
    if (f.table === t.name || !fansOut(t.name, f.table)) {
      if (f.table !== t.name) needed.add(f.table);
      where.push(filterSql(model, A, f));
    } else byTable.set(f.table, [...(byTable.get(f.table) ?? []), f]);
  }
  for (const [tb, fs] of byTable) where.push(existsClause(model, A, t.name, tb, fs));
  needed.delete(t.name);
  const joins = joinClauses(model, A, t.name, needed, true);
  const lines = [`SELECT`, select.map((s) => `  ${s}`).join(",\n"), `FROM ${ident(t.name)} AS ${A[t.name]}`, ...joins];
  if (where.length) lines.push(`WHERE ${where.join("\n  AND ")}`);
  if (plan.order?.by === "column" && plan.order.column) lines.push(`ORDER BY ${A[plan.order.table ?? t.name]}.${ident(plan.order.column)} ${plan.order.dir.toUpperCase()}${t.pk && plan.order.column !== t.pk ? `, ${A[t.name]}.${ident(t.pk)}${plan.order.dir === "desc" ? " DESC" : ""}` : ""}`);
  if (plan.limit) lines.push(`LIMIT ${plan.limit}`);
  return { sql: lines.join("\n") + ";", columns: out, notes: [] };
}

function anti(model: Model, plan: Plan, A: Record<string, string>): Built {
  const t = tableOf(model, plan.subject);
  const { select, display, out } = listSelect(model, A, t, plan.columns);
  const where: string[] = [];
  const needed = new Set<string>(display);
  for (const f of plan.filters) {
    if (f.table !== t.name) needed.add(f.table);
    where.push(filterSql(model, A, f));
  }
  if (plan.anti) where.push(existsClause(model, A, t.name, plan.anti.table, plan.anti.filters, true));
  needed.delete(t.name);
  const joins = joinClauses(model, A, t.name, needed, true);
  const lines = [`SELECT`, select.map((s) => `  ${s}`).join(",\n"), `FROM ${ident(t.name)} AS ${A[t.name]}`, ...joins];
  if (where.length) lines.push(`WHERE ${where.join("\n  AND ")}`);
  if (plan.order?.by === "column" && plan.order.column) lines.push(`ORDER BY ${A[t.name]}.${ident(plan.order.column)} ${plan.order.dir.toUpperCase()}`);
  if (plan.limit) lines.push(`LIMIT ${plan.limit}`);
  return { sql: lines.join("\n") + ";", columns: out, notes: [] };
}
