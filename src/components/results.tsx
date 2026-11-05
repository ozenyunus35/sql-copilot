"use client";

import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, Download, FileSpreadsheet, Info, Lightbulb, OctagonAlert, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Cell, QueryResult } from "@/lib/db";
import { useLang, useT } from "@/lib/i18n";
import type { Model } from "@/lib/model";
import type { Plan } from "@/lib/nl/plan";
import { chooseChart, columnFormats, formatCell, type ColumnFormat } from "@/lib/present";
import type { Explanation } from "@/lib/sql/explain";
import { cx } from "./ui";

export type ResultTab = "chart" | "table" | "explain";

const SERIES = ["var(--accent)", "var(--info)", "var(--success)"];

export function ResultTabs({ tab, setTab, hasChart, issues }: { tab: ResultTab; setTab: (t: ResultTab) => void; hasChart: boolean; issues: number }) {
  const t = useT();
  const tabs: Array<{ id: ResultTab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    ...(hasChart ? [{ id: "chart" as const, label: t("chart"), icon: BarChart3 }] : []),
    { id: "table", label: t("table"), icon: Table2 },
    { id: "explain", label: t("explanation"), icon: Lightbulb, badge: issues },
  ];
  return (
    <div role="tablist" aria-label={t("table")} className="flex gap-0.5 rounded-md border border-border p-0.5">
      {tabs.map((x) => (
        <button
          key={x.id}
          role="tab"
          aria-selected={tab === x.id}
          onClick={() => setTab(x.id)}
          className={cx("flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors", tab === x.id ? "bg-surface-3 text-text" : "text-muted hover:text-text")}
        >
          <x.icon className="size-3.5" />
          {x.label}
          {!!x.badge && <span className="grid size-4 place-items-center rounded-full bg-warning/15 text-[10px] text-warning tabular-nums">{x.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function useFormats(r: QueryResult | null, model: Model | null, plan: Plan | null) {
  return useMemo(() => (r ? columnFormats(r, model, plan) : []), [r, model, plan]);
}

/** The result grid: sticky header, click a header to sort, numbers right-aligned. */
export function ResultTable({ r, formats }: { r: QueryResult; formats: ColumnFormat[] }) {
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(300);
  const rows = useMemo(() => {
    if (!sort) return r.rows;
    const cmp = (a: Cell, b: Cell) => (a === null ? 1 : b === null ? -1 : typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), locale));
    return [...r.rows].sort((a, b) => cmp(a[sort.col], b[sort.col]) * sort.dir);
  }, [r.rows, sort, locale]);
  const numeric = formats.map((f) => ["money", "number", "integer", "percent", "days"].includes(f));
  return (
    <div>
      <div className="scroll-thin max-h-[480px] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              {r.columns.map((c, j) => (
                <th key={j} scope="col" className={cx("sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 font-medium whitespace-nowrap text-muted", numeric[j] ? "text-right" : "text-left")}>
                  <button
                    className={cx("inline-flex items-center gap-1 hover:text-text", numeric[j] && "flex-row-reverse")}
                    onClick={() => setSort((s) => (s?.col === j ? (s.dir === 1 ? { col: j, dir: -1 } : null) : { col: j, dir: numeric[j] ? -1 : 1 }))}
                    aria-label={`Sort by ${c}`}
                  >
                    <span className="font-mono text-[11.5px]">{c}</span>
                    {sort?.col === j && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, i) => (
              <tr key={i} className="hover:bg-surface-2/70">
                {row.map((v, j) => (
                  <td key={j} className={cx("border-b border-border/60 px-3 py-1.5 whitespace-nowrap", numeric[j] ? "text-right tabular-nums" : "max-w-[320px] truncate", v === null && "text-faint")} title={typeof v === "string" && v.length > 40 ? v : undefined}>
                    {formatCell(v, formats[j], locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="border-t border-border px-3 py-2 text-center">
          <button className="text-xs font-medium text-accent hover:underline" onClick={() => setLimit((l) => l + 500)}>
            {lang === "tr" ? `${(rows.length - limit).toLocaleString(locale)} satır daha göster` : `Show ${Math.min(500, rows.length - limit).toLocaleString(locale)} more of ${(rows.length - limit).toLocaleString(locale)}`}
          </button>
        </div>
      )}
      {r.truncated && <p className="border-t border-border px-3 py-2 text-xs text-muted">{t("truncated", { n: r.rows.length.toLocaleString(locale) })}</p>}
    </div>
  );
}

function axisFormat(v: number, f: ColumnFormat) {
  const abs = Math.abs(v);
  const n = abs >= 1e6 ? `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : abs >= 1e3 ? `${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k` : `${Math.round(v * 10) / 10}`;
  return f === "money" ? `$${n}` : f === "percent" ? `${n}%` : n;
}

export function ResultChart({ r, formats }: { r: QueryResult; formats: ColumnFormat[] }) {
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const spec = chooseChart(r, formats);
  if (!spec) return <p className="px-4 py-12 text-center text-muted">{t("noChart")}</p>;
  const data = r.rows.map((row) => ({ x: String(row[spec.x] ?? "—"), ...Object.fromEntries(spec.ys.map((j) => [r.columns[j], row[j] ?? 0])) }));
  const f = formats[spec.ys[0]];
  const tooltip = (
    <Tooltip
      cursor={spec.type === "bar" ? { fill: "var(--surface-2)" } : { stroke: "var(--border-strong)" }}
      contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, boxShadow: "var(--shadow-pop)" }}
      labelStyle={{ color: "var(--text)", fontWeight: 500 }}
      itemStyle={{ color: "var(--muted)" }}
      formatter={(v) => formatCell(Number(v), f, locale)}
    />
  );
  const height = spec.horizontal ? Math.min(560, Math.max(220, data.length * 28 + 40)) : 300;
  return (
    <div className="px-2 pt-4 pb-2" style={{ height }} role="img" aria-label={`${spec.type === "line" ? "Line" : "Bar"} chart of ${spec.ys.map((j) => r.columns[j]).join(", ")} by ${r.columns[spec.x]}`}>
      <ResponsiveContainer width="100%" height="100%">
        {spec.type === "line" ? (
          <LineChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "var(--faint)", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--faint)", fontSize: 11 }} tickFormatter={(v: number) => axisFormat(v, f)} />
            {tooltip}
            {spec.ys.map((j, k) => (
              <Line key={j} type="monotone" dataKey={r.columns[j]} stroke={SERIES[k]} strokeWidth={1.75} dot={data.length <= 24 ? { r: 2.5, strokeWidth: 0, fill: SERIES[k] } : false} activeDot={{ r: 4 }} animationDuration={700} />
            ))}
          </LineChart>
        ) : spec.horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, bottom: 0, left: 4 }} barCategoryGap="24%">
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "var(--faint)", fontSize: 11 }} tickFormatter={(v: number) => axisFormat(v, f)} />
            <YAxis type="category" dataKey="x" tickLine={false} axisLine={false} width={Math.min(180, Math.max(70, Math.max(...data.map((d) => d.x.length)) * 6.4))} tick={{ fill: "var(--muted)", fontSize: 11.5 }} interval={0} />
            {tooltip}
            {spec.ys.map((j, k) => (
              <Bar key={j} dataKey={r.columns[j]} fill={SERIES[k]} radius={[0, 3, 3, 0]} animationDuration={600} />
            ))}
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: 4 }} barCategoryGap="26%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tickLine={false} axisLine={false} tick={{ fill: "var(--faint)", fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--faint)", fontSize: 11 }} tickFormatter={(v: number) => axisFormat(v, f)} />
            {tooltip}
            {spec.ys.map((j, k) => (
              <Bar key={j} dataKey={r.columns[j]} fill={SERIES[k]} radius={[3, 3, 0, 0]} animationDuration={600} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

const LINT_ICON = { error: OctagonAlert, warning: AlertTriangle, info: Info } as const;
const LINT_TONE = { error: "text-danger", warning: "text-warning", info: "text-info" } as const;

export function ExplainPanel({ explanations }: { explanations: Explanation[] }) {
  const t = useT();
  const { lang } = useLang();
  if (!explanations.length) return null;
  return (
    <div className="space-y-5 p-4">
      {explanations.map((e, k) => (
        <div key={k} className="space-y-4">
          <p className="text-[13.5px] font-medium">{e.summary[lang]}</p>
          {e.steps.length > 0 && (
            <ol className="space-y-2.5">
              {e.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border text-[10.5px] font-medium text-muted tabular-nums">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium tracking-wide text-faint uppercase">{s.title[lang]}</p>
                    <p className="mt-0.5 text-muted">{s.detail[lang]}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div>
            <p className="mb-1.5 text-xs font-medium tracking-wide text-faint uppercase">{t("issues")}</p>
            {e.lints.length ? (
              <ul className="space-y-1.5">
                {e.lints.map((l, i) => {
                  const Icon = LINT_ICON[l.level];
                  return (
                    <li key={i} className="flex gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2">
                      <Icon className={cx("mt-0.5 size-3.5 shrink-0", LINT_TONE[l.level])} aria-hidden />
                      <span>
                        <span className="sr-only">{l.level}: </span>
                        {l[lang]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted">{t("noIssues")}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** CSV with a BOM so Excel reads UTF-8, and formula-like cells defused. */
export function toCsv(r: QueryResult) {
  const cell = (v: Cell) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [r.columns, ...r.rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export async function toXlsx(r: QueryResult, formats: ColumnFormat[], sql: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Quarry";
  const ws = wb.addWorksheet("Result");
  ws.addRow(r.columns).font = { bold: true };
  for (const row of r.rows) ws.addRow(row.map((v) => (v instanceof Uint8Array ? null : v)));
  r.columns.forEach((c, j) => {
    const col = ws.getColumn(j + 1);
    col.width = Math.min(40, Math.max(10, c.length + 2, ...r.rows.slice(0, 200).map((row) => String(row[j] ?? "").length + 2)));
    if (formats[j] === "money") col.numFmt = '"$"#,##0.00';
    else if (formats[j] === "percent") col.numFmt = '0.0"%"';
    else if (formats[j] === "integer") col.numFmt = "#,##0";
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const q = wb.addWorksheet("SQL");
  sql.split("\n").forEach((l) => q.addRow([l]));
  q.getColumn(1).width = 100;
  return wb.xlsx.writeBuffer();
}

export const ExportIcons = { Download, FileSpreadsheet };
