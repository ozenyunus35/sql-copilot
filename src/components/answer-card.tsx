"use client";

import { ArrowDownRight, ArrowUpRight, BarChart3, Check, Code2, Copy, CornerDownRight, Download, FileSpreadsheet, ImageDown, Lightbulb, Link2, Minus, Pin, SquareTerminal, Table2, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Dataset } from "@/lib/engine";
import { useLang, useT } from "@/lib/i18n";
import { insights, previousPeriod, type Insight } from "@/lib/insights";
import type { Model } from "@/lib/model";
import { answerSentence, columnFormats } from "@/lib/present";
import { explain } from "@/lib/sql/explain";
import { followUps, type Answer } from "@/lib/workspace";
import { SqlEditor } from "./editor";
import { ExplainPanel, ResultTable, download, toCsv, toXlsx } from "./results";
import { useToast } from "./toast";
import { cx } from "./ui";
import { chartPng, chartShape, type ChartKind } from "./chart-shape";
import { Viz } from "./viz-lazy";

type View = "chart" | "table" | "sql" | "explain";

const CHARTS: Array<{ id: ChartKind; en: string; tr: string }> = [
  { id: "auto", en: "Auto", tr: "Otomatik" },
  { id: "bar", en: "Bars", tr: "Sütun" },
  { id: "hbar", en: "Rows", tr: "Çubuk" },
  { id: "line", en: "Line", tr: "Çizgi" },
  { id: "area", en: "Area", tr: "Alan" },
  { id: "pie", en: "Donut", tr: "Halka" },
];

export function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={active} className={cx("grid size-7 place-items-center rounded-md transition-colors [&_svg]:size-3.5", active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text")}>
      {children}
    </button>
  );
}

function InsightLine({ i, lang }: { i: Insight; lang: "en" | "tr" }) {
  const Icon = i.tone === "up" ? ArrowUpRight : i.tone === "down" ? ArrowDownRight : Minus;
  return (
    <li className="flex gap-2">
      <Icon className={cx("mt-0.5 size-3.5 shrink-0", i.tone === "up" ? "text-success" : i.tone === "down" ? "text-danger" : "text-faint")} aria-hidden />
      <span>{i[lang]}</span>
    </li>
  );
}

export function AnswerCard({ a, ds, model, onFollowUp, onPin, onOpenSql, onRemove, last }: { a: Answer; ds: Dataset; model: Model; onFollowUp: (q: string) => void; onPin: (a: Answer, chart: ChartKind) => void; onOpenSql: (sql: string) => void; onRemove: (id: string) => void; last: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const box = useRef<HTMLDivElement>(null);
  const formats = useMemo(() => (a.res ? columnFormats(a.res, model, a.plan) : []), [a.res, model, a.plan]);
  const shape = useMemo(() => (a.res ? chartShape(a.res, formats) : null), [a.res, formats]);
  const chartable = !!shape && !!a.res && a.res.rows.length > 1;
  const [view, setView] = useState<View>(chartable && a.plan?.kind === "aggregate" ? "chart" : a.error ? "explain" : "table");
  const [kind, setKind] = useState<ChartKind>("auto");
  const [copied, setCopied] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const explanations = useMemo(() => (a.sql ? explain(a.sql, model) : []), [a.sql, model]);
  const issues = explanations.reduce((n, e) => n + e.lints.filter((l) => l.level !== "info").length, 0);
  const sentence = a.res ? answerSentence(a.res, formats, a.plan, model, lang) : null;
  const notes = useMemo(() => {
    if (!a.res) return [];
    const list = insights(a.res, formats, a.plan, model);
    if (a.res.rows.length === 1 && a.res.columns.length === 1 && typeof a.res.rows[0][0] === "number") {
      const p = previousPeriod(a.plan, model, ds.db, a.res.rows[0][0] as number);
      if (p) list.unshift(p);
    }
    return list;
  }, [a.res, formats, a.plan, model, ds.db]);
  const next = useMemo(() => followUps(a, model, lang), [a, model, lang]);
  const meaning = a.notes.filter((n) => n.kind !== "ignored" && !(n.kind === "shape" && /^Follow-up/.test(n.en)));
  const follow = a.notes.find((n) => n.kind === "shape" && /^Follow-up/.test(n.en));
  const pct = Math.round(a.confidence * 100);
  const locale = lang === "tr" ? "tr-TR" : "en-US";

  const tabs: Array<{ id: View; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    ...(chartable ? [{ id: "chart" as const, label: t("chart"), icon: BarChart3 }] : []),
    ...(a.res && a.res.columns.length ? [{ id: "table" as const, label: t("table"), icon: Table2 }] : []),
    ...(a.sql ? [{ id: "sql" as const, label: "SQL", icon: Code2 }] : []),
    ...(a.sql ? [{ id: "explain" as const, label: t("explanation"), icon: Lightbulb, badge: issues }] : []),
  ];

  return (
    <article ref={box} className="animate-rise rounded-xl border border-border bg-surface shadow-card" aria-label={a.question ?? "SQL"} data-testid="answer-card">
      {/* Question */}
      <header className="flex items-start gap-3 px-4 pt-3.5 sm:px-5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-[11px] font-semibold text-muted" aria-hidden>
          {a.question ? "Q" : <SquareTerminal className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={cx("text-[14px] font-medium break-words", !a.question && "font-mono text-[12px] text-muted")}>{a.question ?? a.sql.replace(/\s+/g, " ").slice(0, 140)}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
            {follow && (
              <span className="inline-flex items-center gap-1 text-accent">
                <CornerDownRight className="size-3" />
                {lang === "tr" ? "devam sorusu" : "follow-up"}
              </span>
            )}
            {a.question && a.plan && (
              <button onClick={() => setShowNotes((v) => !v)} className="hover:text-text" aria-expanded={showNotes}>
                {t("understood")} ·{" "}
                <span className={pct >= 85 ? "text-success" : pct >= 60 ? "text-warning" : "text-danger"}>
                  {t("confidence").toLowerCase()} {pct}%
                </span>
              </button>
            )}
            {a.res && (
              <span className="tabular-nums">
                {a.res.columns.length ? `${a.res.rows.length.toLocaleString(locale)} ${a.res.rows.length === 1 ? t("row") : t("rows")} · ` : ""}
                {a.res.ms.toFixed(1)} ms
              </span>
            )}
          </p>
        </div>
        <IconButton label={t("remove")} onClick={() => onRemove(a.id)}>
          <Trash2 />
        </IconButton>
      </header>

      {/* How it was read */}
      {a.question && (showNotes || last) && meaning.length > 0 && (
        <div className="mx-4 mt-2.5 flex flex-wrap gap-1.5 sm:mx-5" data-testid="understood">
          {meaning.map((n, i) => (
            <span key={i} className={cx("rounded-md border px-2 py-0.5 text-[11.5px]", n.kind === "measure" ? "border-accent/30 bg-accent-soft text-text" : "border-border bg-surface-2/60 text-muted")}>
              {n[lang]}
            </span>
          ))}
          {a.buildNotes.map((n, i) => (
            <span key={`b${i}`} className="rounded-md border border-border bg-surface-2/60 px-2 py-0.5 text-[11.5px] text-muted">
              {n[lang]}
            </span>
          ))}
        </div>
      )}
      {a.question && (showNotes || last) && (a.alternatives.length > 0 || a.ignored.length > 0) && (
        <div className="mx-4 mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] sm:mx-5">
          {a.ignored.length > 0 && (
            <span className="text-faint">
              {t("notUsed")}: {a.ignored.join(", ")}
            </span>
          )}
          {a.alternatives.length > 0 && <span className="text-faint">{t("didYouMean")}:</span>}
          {a.alternatives.map((alt) => (
            <button key={alt.question} onClick={() => onFollowUp(alt.question)} className="rounded-md px-1.5 py-0.5 text-accent hover:bg-accent-soft">
              {alt[lang]}
            </button>
          ))}
        </div>
      )}

      {/* Answer */}
      {a.error ? (
        <div className="m-4 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 sm:mx-5" role="alert">
          <p className="font-medium text-danger">{a.sql ? t("errorTitle") : t("noAnswer")}</p>
          <p className="mt-0.5 text-text/85">{a.error[lang]}</p>
        </div>
      ) : (
        <div className="px-4 pt-3 sm:px-5">
          {sentence && (
            <p className="text-[17px] leading-6 font-semibold tracking-[-0.01em]" data-testid="answer">
              {sentence}
            </p>
          )}
          {notes.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12.5px] text-muted" data-testid="insights">
              {notes.map((n, i) => (
                <InsightLine key={i} i={n} lang={lang} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Views */}
      {tabs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-border bg-surface-2/40 px-3 py-1.5 sm:px-4">
          <div role="tablist" aria-label={t("explanation")} className="flex gap-0.5">
            {tabs.map((x) => (
              <button key={x.id} role="tab" aria-selected={view === x.id} onClick={() => setView(x.id)} className={cx("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors", view === x.id ? "bg-surface text-text shadow-card ring-1 ring-border" : "text-muted hover:text-text")}>
                <x.icon className="size-3.5" />
                {x.label}
                {!!x.badge && <span className="grid size-4 place-items-center rounded-full bg-warning/15 text-[10px] text-warning tabular-nums">{x.badge}</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            {view === "chart" && chartable && (
              <select value={kind} onChange={(e) => setKind(e.target.value as ChartKind)} className="mr-1 h-7 rounded-md border border-border bg-surface px-1.5 text-xs" aria-label={lang === "tr" ? "Grafik türü" : "Chart type"}>
                {CHARTS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c[lang]}
                  </option>
                ))}
              </select>
            )}
            {a.res && !a.error && (
              <IconButton label={lang === "tr" ? "Panoya sabitle" : "Pin to dashboard"} onClick={() => onPin(a, view === "chart" ? kind : "auto")}>
                <Pin />
              </IconButton>
            )}
            {a.sql && (
              <IconButton
                label={copied ? t("copied") : `${t("copy")} SQL`}
                onClick={async () => {
                  await navigator.clipboard?.writeText(a.sql).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }}
              >
                {copied ? <Check /> : <Copy />}
              </IconButton>
            )}
            {a.sql && (
              <IconButton label={t("editInSql")} onClick={() => onOpenSql(a.sql)}>
                <SquareTerminal />
              </IconButton>
            )}
            {a.res && a.res.columns.length > 0 && (
              <>
                <IconButton label={`${t("exportCsv")} export`} onClick={() => download(`quarry-${a.id}.csv`, toCsv(a.res!), "text/csv;charset=utf-8")}>
                  <Download />
                </IconButton>
                <IconButton label={`${t("exportXlsx")} export`} onClick={async () => download(`quarry-${a.id}.xlsx`, await toXlsx(a.res!, formats, a.sql), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
                  <FileSpreadsheet />
                </IconButton>
              </>
            )}
            {view === "chart" && chartable && (
              <IconButton label={lang === "tr" ? "Grafiği PNG indir" : "Download chart as PNG"} onClick={() => box.current && chartPng(box.current, `quarry-${a.id}.png`)}>
                <ImageDown />
              </IconButton>
            )}
            {a.question && ds.kind === "demo" && (
              <IconButton
                label={t("share")}
                onClick={async () => {
                  const url = `${location.origin}${location.pathname}#q=${encodeURIComponent(a.question!)}`;
                  await navigator.clipboard?.writeText(url).catch(() => {});
                  toast(t("shareCopied"));
                }}
              >
                <Link2 />
              </IconButton>
            )}
          </div>
        </div>
      )}
      <div className={cx(view !== "table" && view !== "sql" && "pb-1")}>
        {view === "chart" && chartable && a.res && <Viz r={a.res} formats={formats} kind={kind} today={model.today} />}
        {view === "table" && a.res && a.res.columns.length > 0 && <ResultTable r={a.res} formats={formats} />}
        {view === "sql" && a.sql && (
          <div className="p-3">
            <SqlEditor value={a.sql} onChange={() => {}} onRun={() => onOpenSql(a.sql)} label="SQL" readOnly />
          </div>
        )}
        {view === "explain" && <ExplainPanel explanations={explanations} />}
      </div>

      {/* Next questions */}
      {last && next.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5 sm:px-5">
          <span className="text-[11.5px] text-faint">{lang === "tr" ? "Devam et:" : "Follow up:"}</span>
          {next.map((q) => (
            <button key={q} onClick={() => onFollowUp(q)} className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-accent/50 hover:text-accent">
              {q}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
