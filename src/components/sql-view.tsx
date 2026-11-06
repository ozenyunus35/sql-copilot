"use client";

import { ArrowRight, BarChart3, Bookmark, BookmarkCheck, Download, FileSpreadsheet, Lightbulb, ListTree, Pin, Play, Plus, Sparkles, Table2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Dataset } from "@/lib/engine";
import { useLang, useT } from "@/lib/i18n";
import type { Model } from "@/lib/model";
import { columnFormats, answerSentence } from "@/lib/present";
import { explain } from "@/lib/sql/explain";
import { formatSql } from "@/lib/sql/format";
import { snippets } from "@/lib/sql/snippets";
import { tokenizeSql } from "@/lib/sql/tokens";
import { answerSql, uid, type Answer } from "@/lib/workspace";
import { SqlEditor } from "./editor";
import { ExplainPanel, ResultTable, download, toCsv, toXlsx } from "./results";
import { SchemaTree, QueryList, type HistoryItem } from "./sidebar";
import { Button, Modal, cx } from "./ui";
import { chartShape, type ChartKind } from "./chart-shape";
import { Viz } from "./viz-lazy";

export interface SqlTab {
  id: string;
  name: string;
  sql: string;
}

const WRITE = new Set(["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "REPLACE", "TRUNCATE", "VACUUM", "ATTACH", "DETACH", "PRAGMA"]);

export function SqlView({ ds, model, tabs, setTabs, active, setActive, saved, onSave, onPin, history, onRun }: { ds: Dataset; model: Model; tabs: SqlTab[]; setTabs: (t: SqlTab[]) => void; active: string; setActive: (id: string) => void; saved: HistoryItem[]; onSave: (sql: string) => void; onPin: (a: Answer, chart: ChartKind) => void; history: HistoryItem[]; onRun: (sql: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const tab = tabs.find((x) => x.id === active) ?? tabs[0];
  const [result, setResult] = useState<Record<string, Answer>>({});
  const [view, setView] = useState<"table" | "chart" | "explain" | "plan">("table");
  const [pending, setPending] = useState<string | null>(null);
  const [side, setSide] = useState<"schema" | "saved" | "history">("schema");
  const a = result[tab.id];
  const formats = useMemo(() => (a?.res ? columnFormats(a.res, model, null) : []), [a?.res, model]);
  const chartable = !!a?.res && a.res.rows.length > 1 && !!chartShape(a.res, formats);
  const explanations = useMemo(() => (a?.sql ? explain(a.sql, model) : []), [a?.sql, model]);
  const issues = explanations.reduce((n, e) => n + e.lints.filter((l) => l.level !== "info").length, 0);
  const plan = useMemo(() => {
    if (!a?.sql || view !== "plan") return null;
    try {
      return ds.db.run(`EXPLAIN QUERY PLAN ${a.sql.replace(/;\s*$/, "")}`).rows.map((r) => ({ id: Number(r[0]), parent: Number(r[1]), detail: String(r[3]) }));
    } catch {
      return null;
    }
  }, [a?.sql, view, ds]);
  const isSaved = saved.some((s) => s.sql === tab.sql);

  const update = (sql: string) => setTabs(tabs.map((x) => (x.id === tab.id ? { ...x, sql } : x)));
  const execute = (sql: string, id = tab.id) => {
    const ans = answerSql(ds, sql);
    setResult((r) => ({ ...r, [id]: ans }));
    if (ans.error) setView("explain");
    else if (view === "plan" || view === "explain") setView("table");
    onRun(sql);
  };
  const run = () => {
    const first = tokenizeSql(tab.sql).find((x) => x.kind !== "comment");
    if (!tab.sql.trim()) return;
    if (first && WRITE.has(first.v)) return setPending(tab.sql);
    execute(tab.sql);
  };
  const addTab = (sql = "", name?: string) => {
    const id = `t${uid()}`;
    setTabs([...tabs, { id, name: name ?? `${lang === "tr" ? "Sorgu" : "Query"} ${tabs.length + 1}`, sql }]);
    setActive(id);
    return id;
  };

  return (
    <div className="mx-auto grid w-full max-w-[1400px] lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-[6.5rem] hidden h-[calc(100vh-6.5rem)] flex-col border-r border-border lg:flex">
        <div role="tablist" className="flex gap-0.5 border-b border-border px-2 pt-2">
          {(["schema", "saved", "history"] as const).map((x) => (
            <button key={x} role="tab" aria-selected={side === x} onClick={() => setSide(x)} className={cx("-mb-px border-b-2 px-2 pb-2 text-xs font-medium", side === x ? "border-accent text-text" : "border-transparent text-muted hover:text-text")}>
              {x === "schema" ? t("schema") : x === "saved" ? t("savedQueries") : t("history")}
            </button>
          ))}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
          {side === "schema" && <SchemaTree ds={ds} onInsert={(s) => addTab(s, s.match(/FROM\s+"?(\w+)/)?.[1])} />}
          {side === "saved" && <QueryList items={saved} empty={t("emptySaved")} onPick={(h) => addTab(h.sql, h.q?.slice(0, 24))} icon={Bookmark} />}
          {side === "history" && <QueryList items={history} empty={t("emptyHistory")} onPick={(h) => addTab(h.sql, h.q?.slice(0, 24))} icon={ListTree} />}
        </div>
      </aside>
      <div className="min-w-0 space-y-3 px-3 py-4 sm:px-6">
        {/* Tabs */}
        <div className="scroll-thin flex items-end gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Queries">
          {tabs.map((x) => (
            <div key={x.id} className={cx("group flex shrink-0 items-center rounded-t-md border border-b-0 text-xs", x.id === tab.id ? "border-border bg-surface text-text" : "border-transparent text-muted hover:text-text")}>
              <button role="tab" aria-selected={x.id === tab.id} onClick={() => setActive(x.id)} className="max-w-40 truncate py-1.5 pl-3 font-medium">
                {x.name}
              </button>
              {tabs.length > 1 ? (
                <button
                  onClick={() => {
                    const rest = tabs.filter((y) => y.id !== x.id);
                    setTabs(rest);
                    if (x.id === tab.id) setActive(rest[0].id);
                  }}
                  className="mr-1 ml-1 rounded p-0.5 text-faint hover:text-text"
                  aria-label={`${t("close")} ${x.name}`}
                >
                  <X className="size-3" />
                </button>
              ) : (
                <span className="w-3" />
              )}
            </div>
          ))}
          <button onClick={() => addTab()} className="mb-1 ml-1 grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text" aria-label={lang === "tr" ? "Yeni sorgu sekmesi" : "New query tab"}>
            <Plus className="size-3.5" />
          </button>
        </div>
        {/* Editor */}
        <div className="space-y-2">
          <SqlEditor value={tab.sql} onChange={update} onRun={run} label="SQL" model={model} minRows={8} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="primary" onClick={run}>
              <Play /> {t("run")} <kbd className="ml-1 hidden text-[10px] opacity-75 sm:inline">⌘↵</kbd>
            </Button>
            <Button size="sm" onClick={() => update(formatSql(tab.sql))}>
              <Sparkles /> {lang === "tr" ? "Biçimlendir" : "Format"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onSave(tab.sql)} aria-pressed={isSaved}>
              {isSaved ? <BookmarkCheck /> : <Bookmark />} {isSaved ? t("saved") : t("save")}
            </Button>
            <span className="ml-auto hidden text-xs text-faint sm:inline">{lang === "tr" ? "Yazarken tablo ve sütun önerilir; Tab ya da Enter ile seçin." : "Tables and columns are suggested as you type; Tab or Enter picks one."}</span>
          </div>
        </div>
        {/* Worked examples until something has run */}
        {!a && (
          <section aria-labelledby="examples-title" className="pt-2">
            <h2 id="examples-title" className="text-xs font-medium tracking-wide text-faint uppercase">
              {lang === "tr" ? "Örnek sorgular" : "Example queries"}
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {snippets(model, ds.kind === "demo").map((x) => (
                <li key={x.sql}>
                  <button onClick={() => {
                      execute(x.sql, addTab(x.sql, x.title[lang]));
                    }} className="group flex h-full w-full flex-col rounded-lg border border-border bg-surface p-3 text-left shadow-card transition-colors hover:border-border-strong">
                    <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
                      {x.title[lang]}
                      <ArrowRight className="size-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                    </span>
                    <span className="mt-0.5 text-xs text-muted">{x.note[lang]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Result */}
        {a && (
          <section className="animate-rise overflow-hidden rounded-xl border border-border bg-surface shadow-card" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <div className="min-w-0">
                {a.error ? <p className="font-medium text-danger">{t("errorTitle")}</p> : <p className="font-medium" data-testid="answer">{a.res ? answerSentence(a.res, formats, null, model, lang) : ""}</p>}
                {a.res && <p className="text-xs text-faint tabular-nums">{a.res.columns.length ? `${a.res.rows.length.toLocaleString(lang === "tr" ? "tr-TR" : "en-US")} ${t("rows")} · ` : ""}{a.res.ms.toFixed(1)} ms</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <div role="tablist" className="flex gap-0.5 rounded-md border border-border p-0.5">
                  {[
                    ...(a.res?.columns.length ? [{ id: "table" as const, label: t("table"), icon: Table2 }] : []),
                    ...(chartable ? [{ id: "chart" as const, label: t("chart"), icon: BarChart3 }] : []),
                    { id: "explain" as const, label: t("explanation"), icon: Lightbulb, badge: issues },
                    ...(a.res ? [{ id: "plan" as const, label: lang === "tr" ? "Plan" : "Plan", icon: ListTree }] : []),
                  ].map((x) => (
                    <button key={x.id} role="tab" aria-selected={view === x.id} onClick={() => setView(x.id)} className={cx("flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium", view === x.id ? "bg-surface-3 text-text" : "text-muted hover:text-text")}>
                      <x.icon className="size-3.5" /> {x.label}
                      {"badge" in x && !!x.badge && <span className="grid size-4 place-items-center rounded-full bg-warning/15 text-[10px] text-warning">{x.badge}</span>}
                    </button>
                  ))}
                </div>
                {a.res && a.res.columns.length > 0 && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => onPin(a, "auto")} aria-label={lang === "tr" ? "Panoya sabitle" : "Pin to dashboard"}>
                      <Pin />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => download("quarry-result.csv", toCsv(a.res!), "text/csv;charset=utf-8")} aria-label={`${t("exportCsv")} export`}>
                      <Download /> CSV
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => download("quarry-result.xlsx", await toXlsx(a.res!, formats, a.sql), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")} aria-label={`${t("exportXlsx")} export`}>
                      <FileSpreadsheet /> Excel
                    </Button>
                  </>
                )}
              </div>
            </div>
            {a.error && (
              <p className="border-b border-border bg-danger-soft px-4 py-2.5" role="alert">
                {a.error[lang]}
              </p>
            )}
            {view === "table" && a.res && a.res.columns.length > 0 && <ResultTable r={a.res} formats={formats} />}
            {view === "chart" && chartable && a.res && <Viz r={a.res} formats={formats} />}
            {view === "explain" && <ExplainPanel explanations={explanations} />}
            {view === "plan" && (
              <div className="p-4">
                <p className="mb-2 text-xs text-muted">{lang === "tr" ? "SQLite'ın bu sorguyu nasıl çalıştıracağı (EXPLAIN QUERY PLAN). SCAN tablonun tamamını okur; SEARCH bir indeks kullanır." : "How SQLite will run this query (EXPLAIN QUERY PLAN). SCAN reads the whole table; SEARCH uses an index."}</p>
                {plan ? (
                  <ul className="space-y-1 font-mono text-[12px]">
                    {plan.map((p) => {
                      let depth = 0;
                      for (let q = plan.find((x) => x.id === p.parent); q; q = plan.find((x) => x.id === q!.parent)) depth++;
                      return (
                        <li key={p.id} style={{ paddingLeft: depth * 16 }} className={cx(/^SCAN/.test(p.detail) ? "text-warning" : /^SEARCH/.test(p.detail) ? "text-success" : "text-muted")}>
                          {depth ? "└ " : ""}
                          {p.detail}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted">{lang === "tr" ? "Bu komut için plan yok." : "No plan for this statement."}</p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title={t("confirmWrite")}
        footer={
          <>
            <Button onClick={() => setPending(null)}>{t("cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const s = pending!;
                setPending(null);
                execute(s);
              }}
            >
              {t("confirm")}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-2">
            {explain(pending, model).map((e, i) => (
              <div key={i}>
                <p className="font-medium">{e.summary[lang]}</p>
                {e.lints.map((l, k) => (
                  <p key={k} className="mt-1 text-danger">
                    {l[lang]}
                  </p>
                ))}
              </div>
            ))}
            <p className="text-muted">{t("confirmWriteText")}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
