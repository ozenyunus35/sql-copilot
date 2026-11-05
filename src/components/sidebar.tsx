"use client";

import { Bookmark, Calendar, ChevronRight, Clock, Hash, Key, Link2, ListTree, Mail, Network, Tag, Text, ToggleLeft, Trash2, Type } from "lucide-react";
import { useMemo, useState } from "react";
import type { Dataset } from "@/lib/engine";
import { useLang, useT } from "@/lib/i18n";
import type { ColumnModel, TableModel } from "@/lib/model";
import { ident } from "@/lib/nl/sql";
import { cx } from "./ui";

export interface HistoryItem {
  id: string;
  q?: string;
  sql: string;
  at: string;
  dataset: string;
  rows?: number;
}

const ROLE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  id: Key,
  fk: Link2,
  name: Type,
  code: Hash,
  category: Tag,
  money: Hash,
  quantity: Hash,
  percent: Hash,
  number: Hash,
  date: Calendar,
  text: Text,
  email: Mail,
  flag: ToggleLeft,
};

function Profile({ ds, t, c }: { ds: Dataset; t: TableModel; c: ColumnModel }) {
  const tr = useT();
  const { lang } = useLang();
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const stats = useMemo(() => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    try {
      const base = ds.db.run(`SELECT COUNT(*), COUNT(${q(c.name)}), COUNT(DISTINCT ${q(c.name)}) FROM ${q(t.name)}`).rows[0];
      const [total, filled, distinct] = base.map(Number);
      let range: string | null = null;
      let top: Array<[string, number]> = [];
      if (["money", "quantity", "percent", "number"].includes(c.role) || c.type === "date") {
        const r = ds.db.run(`SELECT MIN(${q(c.name)}), MAX(${q(c.name)}), AVG(${q(c.name)}) FROM ${q(t.name)}`).rows[0];
        range = c.type === "date" ? `${r[0]} → ${r[1]}` : `${tr("min")} ${Number(r[0]).toLocaleString(locale)} · ${tr("max")} ${Number(r[1]).toLocaleString(locale)} · ${tr("avg")} ${Number(r[2]).toLocaleString(locale, { maximumFractionDigits: 2 })}`;
      } else if (distinct <= 400) top = ds.db.run(`SELECT ${q(c.name)}, COUNT(*) n FROM ${q(t.name)} WHERE ${q(c.name)} IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 6`).rows.map((x) => [String(x[0]), Number(x[1])]);
      return { total, filled, distinct, range, top };
    } catch {
      return null;
    }
  }, [ds, t, c, tr, locale]);
  if (!stats) return null;
  return (
    <div className="mt-1 mb-2 ml-6 space-y-1 rounded-md border border-border bg-surface-2/60 px-2.5 py-2 text-[11.5px] text-muted">
      <p>
        {stats.distinct.toLocaleString(locale)} {tr("distinct")} · {(stats.total - stats.filled).toLocaleString(locale)} {tr("empty")}
      </p>
      {stats.range && <p className="tabular-nums">{stats.range}</p>}
      {stats.top.length > 0 && (
        <ul className="space-y-0.5">
          {stats.top.map(([v, n]) => (
            <li key={v} className="flex justify-between gap-2">
              <span className="truncate text-text">{v}</span>
              <span className="tabular-nums">{n.toLocaleString(locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SchemaTree({ ds, onInsert }: { ds: Dataset; onInsert: (s: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [col, setCol] = useState<string | null>(null);
  return (
    <ul className="space-y-0.5">
      {ds.model.tables.map((tb) => {
        const isOpen = open[tb.name] ?? false;
        return (
          <li key={tb.name}>
            <div className="group flex items-center rounded-md hover:bg-surface-2">
              <button onClick={() => setOpen((o) => ({ ...o, [tb.name]: !isOpen }))} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
                <ChevronRight className={cx("size-3.5 shrink-0 text-faint transition-transform", isOpen && "rotate-90")} />
                <ListTree className="size-3.5 shrink-0 text-muted" />
                <span className="truncate font-mono text-[12px]">{tb.name}</span>
                <span className="ml-auto pl-2 text-[11px] text-faint tabular-nums">{tb.rows.toLocaleString(lang === "tr" ? "tr-TR" : "en-US")}</span>
              </button>
              <button onClick={() => onInsert(`SELECT *\nFROM ${ident(tb.name)}\nLIMIT 100;`)} className="mr-1 hidden rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-soft group-hover:block focus-visible:block" aria-label={`${t("insert")}: ${tb.name}`}>
                SQL
              </button>
            </div>
            {isOpen && (
              <ul className="mb-1 ml-3 border-l border-border pl-2">
                {tb.columns.map((c) => {
                  const Icon = ROLE_ICON[c.role] ?? Hash;
                  const key = `${tb.name}.${c.name}`;
                  return (
                    <li key={c.name}>
                      <button onClick={() => setCol(col === key ? null : key)} aria-expanded={col === key} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-surface-2" title={`${lang === "tr" ? c.labelTr : c.label} · ${c.type}${c.ref ? ` → ${c.ref.table}.${c.ref.column}` : ""}`}>
                        <Icon className={cx("size-3 shrink-0", c.role === "id" || c.role === "fk" ? "text-accent" : "text-faint")} aria-hidden />
                        <span className="truncate font-mono text-[11.5px]">{c.name}</span>
                        <span className="ml-auto shrink-0 pl-2 text-[10.5px] text-faint">{c.ref ? `→ ${c.ref.table}` : c.type}</span>
                      </button>
                      {col === key && <Profile ds={ds} t={tb} c={c} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function QueryList({ items, empty, onPick, onRemove, icon: Icon }: { items: HistoryItem[]; empty: string; onPick: (h: HistoryItem) => void; onRemove?: (h: HistoryItem) => void; icon: React.ComponentType<{ className?: string }> }) {
  if (!items.length) return <p className="px-2 py-6 text-center text-xs text-faint">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {items.map((h) => (
        <li key={h.id} className="group flex items-start rounded-md hover:bg-surface-2">
          <button onClick={() => onPick(h)} className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left">
            <Icon className="mt-0.5 size-3.5 shrink-0 text-faint" />
            <span className="min-w-0">
              <span className={cx("line-clamp-2", !h.q && "font-mono text-[11.5px]")}>{h.q ?? h.sql.replace(/\s+/g, " ")}</span>
              <span className="text-[11px] text-faint">{new Date(h.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
            </span>
          </button>
          {onRemove && (
            <button onClick={() => onRemove(h)} className="mt-1 mr-1 hidden rounded p-1 text-faint hover:text-danger group-hover:block focus-visible:block" aria-label="Remove">
              <Trash2 className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export type SideTab = "schema" | "history" | "saved";

export function Sidebar({ ds, tab, setTab, history, saved, onInsert, onPick, onUnsave, onMap }: { ds: Dataset; tab: SideTab; setTab: (t: SideTab) => void; history: HistoryItem[]; saved: HistoryItem[]; onInsert: (s: string) => void; onPick: (h: HistoryItem) => void; onUnsave: (h: HistoryItem) => void; onMap: () => void }) {
  const t = useT();
  const tabs: Array<{ id: SideTab; label: string }> = [
    { id: "schema", label: t("schema") },
    { id: "history", label: t("history") },
    { id: "saved", label: t("savedQueries") },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label={t("schema")} className="flex gap-0.5 border-b border-border px-2 pt-2">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={cx("-mb-px border-b-2 px-2 pb-2 text-xs font-medium", tab === x.id ? "border-accent text-text" : "border-transparent text-muted hover:text-text")}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "schema" && (
          <>
            <SchemaTree ds={ds} onInsert={onInsert} />
            <button onClick={onMap} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text">
              <Network className="size-3.5" /> {t("map")}
            </button>
          </>
        )}
        {tab === "history" && <QueryList items={history} empty={t("emptyHistory")} onPick={onPick} icon={Clock} />}
        {tab === "saved" && <QueryList items={saved} empty={t("emptySaved")} onPick={onPick} onRemove={onUnsave} icon={Bookmark} />}
      </div>
    </div>
  );
}
