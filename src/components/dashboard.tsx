"use client";

import { ArrowDownRight, ArrowUpRight, GripVertical, LayoutDashboard, Maximize2, Minimize2, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Dataset } from "@/lib/engine";
import { previousPeriod } from "@/lib/insights";
import { useLang } from "@/lib/i18n";
import type { Model } from "@/lib/model";
import { parse } from "@/lib/nl/parse";
import { columnFormats, formatCell } from "@/lib/present";
import type { Pin } from "@/lib/workspace";
import { IconButton } from "./answer-card";
import { ResultTable } from "./results";
import { Button, EmptyState, cx } from "./ui";
import { Viz } from "./viz-lazy";

function money(v: number, money: boolean, locale: string) {
  return money ? v.toLocaleString(locale, { style: "currency", currency: "USD", notation: Math.abs(v) >= 1e6 ? "compact" : "standard", maximumFractionDigits: Math.abs(v) >= 1e6 ? 2 : 0 }) : v.toLocaleString(locale, { maximumFractionDigits: 1 });
}

/** A headline number with the change from the period before, when the question has a date range. */
export function Kpi({ ds, model, title, sql, question, onClick }: { ds: Dataset; model: Model; title: string; sql: string; question?: string; onClick?: () => void }) {
  const { lang } = useLang();
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  const data = useMemo(() => {
    try {
      const r = ds.db.run(sql, 2);
      const v = r.rows[0]?.[0];
      if (typeof v !== "number") return null;
      const f = columnFormats(r, model, null)[0];
      const plan = question ? parse(question, model).plan ?? null : null;
      const prev = previousPeriod(plan, model, ds.db, v);
      return { v, f, prev };
    } catch {
      return null;
    }
  }, [ds, model, sql, question]);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cx("flex h-full w-full min-w-0 flex-col rounded-xl border border-border bg-surface p-4 text-left shadow-card", onClick && "transition-colors hover:border-border-strong")}>
      <span className="truncate text-xs font-medium text-muted">{title}</span>
      <span className="mt-1.5 text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums">{data ? (data.f === "days" ? formatCell(data.v, "days", locale) : money(data.v, data.f === "money", locale)) : "—"}</span>
      {data?.prev ? (
        <span className={cx("mt-1 flex items-start gap-0.5 text-[11.5px] leading-4 tabular-nums", data.prev.tone === "up" ? "text-success" : data.prev.tone === "down" ? "text-danger" : "text-faint")}>
          {data.prev.tone === "up" ? <ArrowUpRight className="mt-0.5 size-3 shrink-0" /> : data.prev.tone === "down" ? <ArrowDownRight className="mt-0.5 size-3 shrink-0" /> : null}
          {data.prev[lang].split(" (")[0]}
        </span>
      ) : (
        <span className="mt-1 text-[11.5px] text-faint">{lang === "tr" ? "tüm zamanlar" : "all time"}</span>
      )}
    </Tag>
  );
}

function PinCard({ ds, model, pin, onRemove, onResize, onAsk, dragProps }: { ds: Dataset; model: Model; pin: Pin; onRemove: () => void; onResize: () => void; onAsk: () => void; dragProps: React.HTMLAttributes<HTMLDivElement> }) {
  const { lang } = useLang();
  const r = useMemo(() => {
    try {
      return ds.db.run(pin.sql);
    } catch {
      return null;
    }
  }, [ds, pin.sql]);
  const formats = useMemo(() => (r ? columnFormats(r, model, null) : []), [r, model]);
  return (
    <section className={cx("group flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-card", pin.width === 2 && "lg:col-span-2")} aria-label={pin.title} {...dragProps}>
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        <GripVertical className="size-3.5 shrink-0 cursor-grab text-faint opacity-0 group-hover:opacity-100" aria-hidden />
        <button onClick={onAsk} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:text-accent" title={pin.question ?? pin.sql}>
          {pin.title}
        </button>
        <span className="flex opacity-60 group-hover:opacity-100">
          <IconButton label={pin.width === 2 ? (lang === "tr" ? "Daralt" : "Make narrow") : lang === "tr" ? "Genişlet" : "Make wide"} onClick={onResize}>
            {pin.width === 2 ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
          <IconButton label={lang === "tr" ? "Panodan kaldır" : "Remove from dashboard"} onClick={onRemove}>
            <Trash2 />
          </IconButton>
        </span>
      </header>
      <div className="min-h-0 flex-1">
        {!r ? (
          <p className="p-4 text-muted">{lang === "tr" ? "Bu sorgu artık çalışmıyor." : "This query no longer runs."}</p>
        ) : pin.chart === "table" ? (
          <ResultTable r={r} formats={formats} />
        ) : (
          <Viz r={r} formats={formats} kind={pin.chart === "kpi" ? "auto" : pin.chart} compact height={pin.chart === "pie" ? 260 : 240} label={pin.title} today={model.today} />
        )}
      </div>
    </section>
  );
}

export function Dashboard({ ds, model, pins, setPins, onAsk, onReset }: { ds: Dataset; model: Model; pins: Pin[]; setPins: (p: Pin[]) => void; onAsk: (q: string) => void; onReset: () => void }) {
  const { lang } = useLang();
  const [drag, setDrag] = useState<string | null>(null);
  const kpis = pins.filter((p) => p.chart === "kpi");
  const charts = pins.filter((p) => p.chart !== "kpi");
  const move = (from: string, to: string) => {
    if (from === to) return;
    const list = [...pins];
    const a = list.findIndex((p) => p.id === from);
    const b = list.findIndex((p) => p.id === to);
    const [x] = list.splice(a, 1);
    list.splice(b, 0, x);
    setPins(list);
  };
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4 px-3 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{lang === "tr" ? "Pano" : "Dashboard"}</h1>
          <p className="mt-0.5 text-muted">{lang === "tr" ? "Sabitlediğiniz cevaplar, veriyle birlikte güncel. Başlığa tıklayınca soru açılır; kartları sürükleyerek sıralayın." : "Answers you pinned, always computed from the current data. Click a title to open the question; drag cards to reorder."}</p>
        </div>
        {ds.kind === "demo" && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            <RefreshCw /> {lang === "tr" ? "Varsayılan panoya dön" : "Reset to the default dashboard"}
          </Button>
        )}
      </div>
      {!pins.length ? (
        <div className="rounded-xl border border-dashed border-border-strong">
          <EmptyState icon={LayoutDashboard} title={lang === "tr" ? "Pano boş" : "Nothing pinned yet"} text={lang === "tr" ? "Bir soru sorun ve cevap kartındaki raptiye düğmesiyle buraya ekleyin." : "Ask a question, then use the pin button on its answer to add it here."} />
        </div>
      ) : (
        <>
          {kpis.length > 0 && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {kpis.map((p) => (
                <div key={p.id} className="group relative">
                  <Kpi ds={ds} model={model} title={p.title} sql={p.sql} question={p.question} onClick={() => p.question && onAsk(p.question)} />
                  <button onClick={() => setPins(pins.filter((x) => x.id !== p.id))} className="absolute top-2 right-2 hidden rounded p-1 text-faint hover:text-danger group-hover:block focus-visible:block" aria-label={lang === "tr" ? "Panodan kaldır" : "Remove from dashboard"}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {charts.map((p) => (
              <PinCard
                key={p.id}
                ds={ds}
                model={model}
                pin={p}
                onAsk={() => (p.question ? onAsk(p.question) : undefined)}
                onRemove={() => setPins(pins.filter((x) => x.id !== p.id))}
                onResize={() => setPins(pins.map((x) => (x.id === p.id ? { ...x, width: x.width === 2 ? 1 : 2 } : x)))}
                dragProps={{
                  draggable: true,
                  onDragStart: () => setDrag(p.id),
                  onDragOver: (e) => e.preventDefault(),
                  onDrop: () => drag && move(drag, p.id),
                  onDragEnd: () => setDrag(null),
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
