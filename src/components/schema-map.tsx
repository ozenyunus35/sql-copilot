"use client";

import { Key, Link2 } from "lucide-react";
import { useMemo } from "react";
import { useLang } from "@/lib/i18n";
import type { Model } from "@/lib/model";

const W = 220;
const ROW = 20;
const HEAD = 34;
const GAP_X = 90;
const GAP_Y = 28;
const MAX_COLS = 9;

/**
 * Tables as cards and relations as lines from each foreign key to the key it points at.
 * Tables are placed in columns by how far down the chain of relations they sit: lookup tables on
 * the left, the tables that point at them to the right.
 */
export function SchemaMap({ model }: { model: Model }) {
  const { lang } = useLang();
  const layout = useMemo(() => {
    const depth = new Map<string, number>();
    const visit = (t: string, seen: Set<string>): number => {
      if (depth.has(t)) return depth.get(t)!;
      if (seen.has(t)) return 0;
      seen.add(t);
      const parents = model.relations.filter((r) => r.from.table === t && r.to.table !== t).map((r) => r.to.table);
      const d = parents.length ? Math.max(...parents.map((p) => visit(p, seen))) + 1 : 0;
      depth.set(t, d);
      return d;
    };
    for (const t of model.tables) visit(t.name, new Set());
    const cols: string[][] = [];
    for (const t of model.tables) (cols[depth.get(t.name)!] ??= []).push(t.name);
    const pos = new Map<string, { x: number; y: number; h: number }>();
    cols.forEach((names, ci) => {
      let y = 16;
      for (const n of names) {
        const t = model.tables.find((x) => x.name === n)!;
        const shown = Math.min(MAX_COLS, t.columns.length) + (t.columns.length > MAX_COLS ? 1 : 0);
        const h = HEAD + shown * ROW + 8;
        pos.set(n, { x: 16 + ci * (W + GAP_X), y, h });
        y += h + GAP_Y;
      }
    });
    const width = 32 + cols.length * W + (cols.length - 1) * GAP_X;
    const height = Math.max(...[...pos.values()].map((p) => p.y + p.h)) + 16;
    return { pos, width, height };
  }, [model]);

  const colY = (table: string, column: string) => {
    const t = model.tables.find((x) => x.name === table)!;
    const i = Math.min(MAX_COLS, Math.max(0, t.columns.findIndex((c) => c.name === column)));
    const p = layout.pos.get(table)!;
    return p.y + HEAD + i * ROW + ROW / 2;
  };

  return (
    <div className="scroll-thin overflow-auto rounded-md border border-border bg-surface-2/40">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" style={{ minWidth: Math.min(layout.width, 760), maxWidth: layout.width }} role="img" aria-label={`Schema map: ${model.tables.length} tables, ${model.relations.length} relations`} className="block">
        {model.relations.map((r, i) => {
          const a = layout.pos.get(r.from.table);
          const b = layout.pos.get(r.to.table);
          if (!a || !b) return null;
          const y1 = colY(r.from.table, r.from.column);
          const y2 = colY(r.to.table, r.to.column);
          const leftward = b.x < a.x;
          const x1 = leftward ? a.x : a.x + W;
          const x2 = leftward ? b.x + W : b.x;
          const mid = (x1 + x2) / 2;
          const d = a.x === b.x ? `M${a.x + W},${y1} C${a.x + W + 50},${y1} ${b.x + W + 50},${y2} ${b.x + W},${y2}` : `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="var(--border-strong)" strokeWidth={1.25} />
              <circle cx={a.x === b.x ? a.x + W : x1} cy={y1} r={2.5} fill="var(--border-strong)" />
              <circle cx={a.x === b.x ? b.x + W : x2} cy={y2} r={2.5} fill="var(--accent)" />
            </g>
          );
        })}
        {model.tables.map((t) => {
          const p = layout.pos.get(t.name)!;
          const shown = t.columns.slice(0, MAX_COLS);
          return (
            <g key={t.name} transform={`translate(${p.x},${p.y})`}>
              <rect width={W} height={p.h} rx={7} fill="var(--surface)" stroke="var(--border)" />
              <rect width={W} height={HEAD - 6} rx={7} fill="var(--surface-2)" />
              <rect y={HEAD - 13} width={W} height={7} fill="var(--surface-2)" />
              <line x1={0} x2={W} y1={HEAD - 6} y2={HEAD - 6} stroke="var(--border)" />
              <text x={12} y={18} fontSize={12} fontWeight={600} fill="var(--text)" fontFamily="var(--font-jetbrains-mono)">
                {t.name}
              </text>
              <text x={W - 12} y={18} fontSize={10.5} textAnchor="end" fill="var(--faint)">
                {t.rows.toLocaleString(lang === "tr" ? "tr-TR" : "en-US")}
              </text>
              {shown.map((c, i) => (
                <g key={c.name} transform={`translate(0,${HEAD + i * ROW})`}>
                  {(c.role === "id" || c.role === "fk") && (
                    <foreignObject x={10} y={4} width={12} height={12}>
                      {c.role === "id" ? <Key className="size-3 text-accent" /> : <Link2 className="size-3 text-accent" />}
                    </foreignObject>
                  )}
                  <text x={28} y={14} fontSize={11.5} fill={c.role === "id" || c.role === "fk" ? "var(--text)" : "var(--muted)"} fontFamily="var(--font-jetbrains-mono)">
                    {c.name.length > 20 ? `${c.name.slice(0, 19)}…` : c.name}
                  </text>
                  <text x={W - 12} y={14} fontSize={10.5} textAnchor="end" fill="var(--faint)">
                    {c.type}
                  </text>
                </g>
              ))}
              {t.columns.length > MAX_COLS && (
                <text x={28} y={HEAD + MAX_COLS * ROW + 14} fontSize={10.5} fill="var(--faint)">
                  +{t.columns.length - MAX_COLS} more
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
