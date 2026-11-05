"use client";

import { useMemo, useRef } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QueryResult } from "@/lib/db";
import { useLang, useT } from "@/lib/i18n";
import { formatCell, type ColumnFormat } from "@/lib/present";
import { autoKind, axisFormat, chartShape, type ChartKind } from "./chart-shape";



const PALETTE = ["var(--accent)", "var(--info)", "var(--success)", "var(--warning)", "#a970d6", "#5aa5a5", "#d4708f", "#8a8f99"];

type TipItem = { name?: string | number; value?: unknown; color?: string; payload?: { fill?: string } };
function Tip({ active, payload, label, f, locale }: { active?: boolean; payload?: TipItem[]; label?: string | number; f: ColumnFormat; locale: string }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter((p, i) => p.value !== undefined && p.value !== null && payload.findIndex((q) => q.name === p.name && q.value !== undefined && q.value !== null) === i);
  const total = items.length > 1 ? items.reduce((a, p) => a + (Number(p.value) || 0), 0) : null;
  return (
    <div className="min-w-36 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <div className="mb-1 font-medium text-text">{label}</div>}
      {items.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-px">
          <span className="size-2 shrink-0 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="min-w-0 flex-1 truncate text-muted">{p.name}</span>
          <span className="font-medium text-text tabular-nums">{formatCell(Number(p.value), f, locale)}</span>
        </div>
      ))}
      {total !== null && (
        <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1 text-muted">
          <span>{locale === "tr-TR" ? "Toplam" : "Total"}</span>
          <span className="font-medium text-text tabular-nums">{formatCell(total, f, locale)}</span>
        </div>
      )}
    </div>
  );
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
      if ((today.startsWith(x) && x.length < 10) || x === q) {
        s.data[s.data.length - 1] = { ...last, x: `${x} ${lang === "tr" ? "(devam)" : "(so far)"}` };
        return { ...s, open: true };
      }
    }
    return s ? { ...s, open: false } : s;
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
      content={(p) => <Tip active={p.active} payload={p.payload as unknown as TipItem[]} label={kk === "pie" ? undefined : (p.label as string)} f={f} locale={locale} />}
      isAnimationActive={false}
    />
  );
  const legend = shape.series.length > 1 ? <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11.5, color: "var(--muted)", paddingTop: 6 }} /> : null;
  const h = height ?? (kk === "hbar" ? Math.min(560, Math.max(200, shape.data.length * (compact ? 22 : 28) + 48)) : kk === "pie" ? 300 : compact ? 220 : 320);
  const stacked = shape.pivot && (kk === "bar" || kk === "hbar" || kk === "area");
  const yWidth = Math.min(190, Math.max(70, Math.max(...shape.data.map((d) => String(d.x).length)) * 6.4));
  // A period still filling up is drawn dashed, so a half-finished month doesn't read as a collapse.
  const dashed = shape.open && !shape.pivot && shape.series.length === 1 && (kk === "line" || kk === "area") && shape.data.length > 2;
  const key0 = shape.series[0].key;
  const lineData = dashed
    ? shape.data.map((d, i, all) => ({ ...d, [key0]: i === all.length - 1 ? (null as unknown as number) : d[key0], [`${key0}__open`]: i >= all.length - 2 ? d[key0] : (null as unknown as number) }))
    : shape.data;
  const openLine = (i: number, area: boolean) =>
    dashed && i === 0 ? (area ? <Area key="open" type="monotone" dataKey={`${key0}__open`} name={shape.series[0].label} stroke={PALETTE[0]} strokeWidth={1.75} strokeDasharray="4 4" fill="none" animationDuration={600} legendType="none" /> : <Line key="open" type="monotone" dataKey={`${key0}__open`} name={shape.series[0].label} stroke={PALETTE[0]} strokeWidth={1.75} strokeDasharray="4 4" dot={false} animationDuration={600} legendType="none" />) : null;
  const labels = !compact && !stacked && shape.series.length === 1 && shape.data.length <= 15;
  const desc = `${{ bar: "Bar", hbar: "Bar", line: "Line", area: "Area", pie: "Pie" }[kk]} chart of ${shape.series.map((s) => (shape.pivot ? s.label : s.key.replace(/_/g, " "))).join(", ")} by ${r.columns[shape.x]}`;

  return (
    <div ref={box} className="px-2 pt-3 pb-1" style={{ height: h }} role="img" aria-label={label ?? desc} data-chart>
      <ResponsiveContainer width="100%" height="100%">
        {kk === "line" ? (
          <LineChart data={lineData} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={24} tick={tickStyle} />
            <YAxis tickLine={false} axisLine={false} width={56} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f, locale)} />
            {tooltip}
            {legend}
            {shape.series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.75} dot={shape.data.length <= 24 ? { r: 2.5, strokeWidth: 0, fill: PALETTE[i % PALETTE.length] } : false} activeDot={{ r: 4 }} animationDuration={600} />
            ))}
            {openLine(0, false)}
          </LineChart>
        ) : kk === "area" ? (
          <AreaChart data={lineData} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
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
            <YAxis tickLine={false} axisLine={false} width={56} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f, locale)} />
            {tooltip}
            {legend}
            {shape.series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId={stacked ? "s" : undefined} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.75} fill={`url(#fill-${i})`} animationDuration={600} />
            ))}
            {openLine(0, true)}
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
          <BarChart data={shape.data} layout="vertical" margin={{ top: 4, right: labels ? 44 : 20, bottom: 0, left: 4 }} barCategoryGap="24%">
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f, locale)} />
            <YAxis type="category" dataKey="x" tickLine={false} axisLine={false} width={yWidth} tick={{ fill: "var(--muted)", fontSize: 11.5 }} interval={0} />
            {tooltip}
            {legend}
            {shape.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? "s" : undefined} fill={PALETTE[i % PALETTE.length]} radius={stacked ? 0 : [0, 3, 3, 0]} animationDuration={600}>
                {labels && <LabelList dataKey={s.key} position="right" offset={6} fill="var(--muted)" fontSize={11} formatter={(v: unknown) => axisFormat(Number(v), f, locale)} />}
              </Bar>
            ))}
          </BarChart>
        ) : (
          <BarChart data={shape.data} margin={{ top: 6, right: 16, bottom: 0, left: 4 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="x" tickLine={false} axisLine={false} tick={tickStyle} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} width={56} tick={tickStyle} tickFormatter={(v: number) => axisFormat(v, f, locale)} />
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
