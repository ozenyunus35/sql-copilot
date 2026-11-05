"use client";

import { useMemo, useRef } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QueryResult } from "@/lib/db";
import { useLang, useT } from "@/lib/i18n";
import { formatCell, type ColumnFormat } from "@/lib/present";

export type ChartKind = "auto" | "bar" | "hbar" | "line" | "area" | "pie";

const PALETTE = ["var(--accent)", "var(--info)", "var(--success)", "var(--warning)", "#a970d6", "#5aa5a5", "#d4708f", "#8a8f99"];

export interface Shape {
  x: number;
  /** One series per numeric column, or per value of a second label column (pivot). */
  series: Array<{ key: string; label: string }>;
  data: Array<Record<string, string | number>>;
  time: boolean;
  format: ColumnFormat;
  pivot: boolean;
}

/** Works out what can be charted: a label column and numbers, or two labels and one number (pivot). */
export function chartShape(r: QueryResult, formats: ColumnFormat[]): Shape | null {
  if (r.rows.length < 1 || r.rows.length > 1000) return null;
  const labels = formats.map((f, j) => (["text", "period", "date"].includes(f) ? j : -1)).filter((j) => j >= 0);
  const nums = formats.map((f, j) => (["money", "number", "integer", "days", "percent"].includes(f) && !["share_pct", "change_pct"].includes(r.columns[j]) ? j : -1)).filter((j) => j >= 0);
  if (!labels.length || !nums.length) return null;
  // Time first on the x axis when there is one.
  const x = labels.find((j) => formats[j] === "period" || formats[j] === "date") ?? labels[0];
  const time = formats[x] === "period" || formats[x] === "date";
  const other = labels.find((j) => j !== x);
  if (other !== undefined && nums.length === 1) {
    const y = nums[0];
    const keys = [...new Set(r.rows.map((row) => String(row[other] ?? "—")))];
    if (keys.length <= 12) {
      const byX = new Map<string, Record<string, string | number>>();
      for (const row of r.rows) {
        const xv = String(row[x] ?? "—");
        const rec = byX.get(xv) ?? { x: xv };
        rec[String(row[other] ?? "—")] = Number(row[y]) || 0;
        byX.set(xv, rec);
      }
      return { x, series: keys.map((k) => ({ key: k, label: k })), data: [...byX.values()], time, format: formats[y], pivot: true };
    }
  }
  const same = nums.filter((j) => formats[j] === formats[nums[0]]).slice(0, 4);
  const data = r.rows.map((row) => ({ x: String(row[x] ?? "—"), ...Object.fromEntries(same.map((j) => [r.columns[j], Number(row[j]) || 0])) }));
  return { x, series: same.map((j) => ({ key: r.columns[j], label: r.columns[j] })), data, time, format: formats[same[0]], pivot: false };
}

/** The chart drawn when the user hasn't picked one. */
export function autoKind(s: Shape): Exclude<ChartKind, "auto"> {
  if (s.time) return s.data.length <= 4 ? "bar" : s.pivot ? "line" : "area";
  const longest = Math.max(...s.data.map((d) => String(d.x).length));
  return longest > 8 || s.data.length > 8 ? "hbar" : "bar";
}

export function axisFormat(v: number, f: ColumnFormat) {
  const abs = Math.abs(v);
  const n = abs >= 1e6 ? `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : abs >= 1e3 ? `${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k` : `${Math.round(v * 10) / 10}`;
  return f === "money" ? `$${n}` : f === "percent" ? `${n}%` : n;
}

export function Viz({ r, formats, kind = "auto", height, compact = false, label, today }: { r: QueryResult; formats: ColumnFormat[]; kind?: ChartKind; height?: number; compact?: boolean; label?: string; today?: string }) {
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const shape = useMemo(() => {
    const s = chartShape(r, formats);
    // The period that contains today is still filling up: say so on its label.
    if (s?.time && today && s.data.length > 1) {
      const last = s.data[s.data.length - 1];
      const x = String(last.x);
      const q = `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) + 2) / 3)}`;
      if ((today.startsWith(x) && x.length < 10) || x === q) s.data[s.data.length - 1] = { ...last, x: `${x} ${lang === "tr" ? "(devam)" : "(so far)"}` };
    }
    return s;
  }, [r, formats, today, lang]);
  const box = useRef<HTMLDivElement>(null);
  if (!shape || shape.data.length < 1) return <p className="px-4 py-12 text-center text-muted">{t("noChart")}</p>;
  const k = kind === "auto" ? autoKind(shape) : kind;
  const pieOk = !shape.pivot && shape.series.length === 1 && shape.data.length <= 12 && shape.data.every((d) => Number(d[shape.series[0].key]) >= 0);
  const kk = k === "pie" && !pieOk ? "bar" : k;
  const f = shape.format;
  const tickStyle = { fill: "var(--faint)", fontSize: 11 };
  const tooltip = (
    <Tooltip
      cursor={kk === "bar" || kk === "hbar" ? { fill: "var(--surface-2)" } : { stroke: "var(--border-strong)" }}
      contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, boxShadow: "var(--shadow-pop)" }}
      labelStyle={{ color: "var(--text)", fontWeight: 500 }}
      itemStyle={{ color: "var(--muted)", padding: 0 }}
      formatter={(v) => formatCell(Number(v), f, locale)}
    />
  );
  const legend = shape.series.length > 1 ? <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11.5, color: "var(--muted)", paddingTop: 6 }} /> : null;
  const h = height ?? (kk === "hbar" ? Math.min(560, Math.max(200, shape.data.length * (compact ? 22 : 28) + 48)) : kk === "pie" ? 300 : compact ? 220 : 320);
  const stacked = shape.pivot && (kk === "bar" || kk === "hbar" || kk === "area");
  const yWidth = Math.min(190, Math.max(70, Math.max(...shape.data.map((d) => String(d.x).length)) * 6.4));
  const desc = `${{ bar: "Bar", hbar: "Bar", line: "Line", area: "Area", pie: "Pie" }[kk]} chart of ${shape.series.map((s) => s.label).join(", ")} by ${r.columns[shape.x]}`;

  return (
    <div ref={box} className="px-2 pt-3 pb-1" style={{ height: h }} role="img" aria-label={label ?? desc} data-chart>
      <ResponsiveContainer width="100%" height="100%">
        {kk === "line" ? (
          <LineChart data={shape.data} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={24} tick={tickStyle} />
            <YAxis tickLine={false} axisLine={false} width={56} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f)} />
            {tooltip}
            {legend}
            {shape.series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.75} dot={shape.data.length <= 24 ? { r: 2.5, strokeWidth: 0, fill: PALETTE[i % PALETTE.length] } : false} activeDot={{ r: 4 }} animationDuration={600} />
            ))}
          </LineChart>
        ) : kk === "area" ? (
          <AreaChart data={shape.data} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
            <defs>
              {shape.series.map((s, i) => (
                <linearGradient key={s.key} id={`fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={24} tick={tickStyle} />
            <YAxis tickLine={false} axisLine={false} width={56} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f)} />
            {tooltip}
            {legend}
            {shape.series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId={stacked ? "s" : undefined} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.75} fill={`url(#fill-${i})`} animationDuration={600} />
            ))}
          </AreaChart>
        ) : kk === "pie" ? (
          <PieChart>
            {tooltip}
            <Legend iconType="circle" iconSize={7} layout={compact ? "horizontal" : "vertical"} align={compact ? "center" : "right"} verticalAlign={compact ? "bottom" : "middle"} wrapperStyle={{ fontSize: 11.5, color: "var(--muted)" }} />
            <Pie data={shape.data} dataKey={shape.series[0].key} nameKey="x" innerRadius="55%" outerRadius="85%" paddingAngle={1.5} stroke="var(--surface)" animationDuration={600}>
              {shape.data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : kk === "hbar" ? (
          <BarChart data={shape.data} layout="vertical" margin={{ top: 4, right: 20, bottom: 0, left: 4 }} barCategoryGap="24%">
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f)} />
            <YAxis type="category" dataKey="x" tickLine={false} axisLine={false} width={yWidth} tick={{ fill: "var(--muted)", fontSize: 11.5 }} interval={0} />
            {tooltip}
            {legend}
            {shape.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? "s" : undefined} fill={PALETTE[i % PALETTE.length]} radius={stacked ? 0 : [0, 3, 3, 0]} animationDuration={600} />
            ))}
          </BarChart>
        ) : (
          <BarChart data={shape.data} margin={{ top: 6, right: 16, bottom: 0, left: 4 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tickLine={false} axisLine={false} tick={tickStyle} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} width={56} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f)} />
            {tooltip}
            {legend}
            {shape.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? "s" : undefined} fill={PALETTE[i % PALETTE.length]} radius={stacked ? 0 : [3, 3, 0, 0]} animationDuration={600} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Saves the chart inside `root` as a PNG, with theme colours resolved so it looks the same outside the app. */
export async function chartPng(root: HTMLElement, name: string) {
  const svg = root.querySelector("[data-chart] svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return false;
  const css = getComputedStyle(document.documentElement);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 320;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  let text = new XMLSerializer().serializeToString(clone);
  text = text.replace(/var\((--[\w-]+)\)/g, (_, v: string) => css.getPropertyValue(v).trim() || "#888");
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  await new Promise((ok, fail) => {
    img.onload = ok;
    img.onerror = fail;
    img.src = url;
  });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css.getPropertyValue("--surface").trim() || "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = name;
  a.click();
  return true;
}
