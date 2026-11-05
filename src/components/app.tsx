"use client";

import { ArrowRight, Bookmark, BookmarkCheck, Check, Code, Copy, Database, HelpCircle, Link2, Loader2, Menu, Play, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { QueryResult } from "@/lib/db";
import { listSaved, loadDemo, openSaved, removeSaved, type Dataset } from "@/lib/engine";
import { examples } from "@/lib/examples";
import { LangContext, type Lang, useLang, useT } from "@/lib/i18n";
import type { ParseResult, Plan } from "@/lib/nl/plan";
import { parse } from "@/lib/nl/parse";
import { toSql } from "@/lib/nl/sql";
import { answerSentence, chooseChart, columnFormats } from "@/lib/present";
import { explain, explainError, type Bi } from "@/lib/sql/explain";
import { tokenizeSql } from "@/lib/sql/tokens";
import { QuarryMark } from "./brand";
import { SqlEditor } from "./editor";
import { ExplainPanel, ExportIcons, ResultChart, ResultTable, ResultTabs, download, toCsv, toXlsx, useFormats, type ResultTab } from "./results";
import { SchemaMap } from "./schema-map";
import { Sidebar, type HistoryItem, type SideTab } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { useToast } from "./toast";
import { Button, Card, Modal, cx } from "./ui";
import { UploadDialog } from "./upload";

interface Run {
  res?: QueryResult;
  error?: Bi;
  plan: Plan | null;
  sql: string;
  notes: Bi[];
}

const REPO = "https://github.com/ozenyunus35/sql-copilot";
const WRITE = new Set(["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "REPLACE", "TRUNCATE", "VACUUM", "ATTACH", "DETACH", "PRAGMA"]);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

const LANG_EVENT = "quarry:lang";
function readLang(): Lang {
  const saved = load<Lang | null>("quarry:lang", null);
  return saved ?? (navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en");
}
function subscribeLang(cb: () => void) {
  window.addEventListener(LANG_EVENT, cb);
  return () => window.removeEventListener(LANG_EVENT, cb);
}

export function App() {
  const lang = useSyncExternalStore(subscribeLang, readLang, () => "en" as Lang);
  const setLang = useCallback((l: Lang) => {
    store("quarry:lang", l);
    window.dispatchEvent(new Event(LANG_EVENT));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <Workbench lang={lang} setLang={setLang} />
    </LangContext.Provider>
  );
}

function Workbench({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = useT();
  const { toast } = useToast();
  const [ds, setDs] = useState<Dataset | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string }>>([]);
  const [question, setQuestion] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [sql, setSql] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [tab, setTab] = useState<ResultTab>("chart");
  const [side, setSide] = useState<SideTab>("schema");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [saved, setSaved] = useState<HistoryItem[]>([]);
  const [mapOpen, setMapOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const askRef = useRef<HTMLInputElement>(null);
  const booted = useRef(false);

  const pushHistory = useCallback(
    (h: Omit<HistoryItem, "id" | "at">) => {
      setHistory((prev) => {
        const next = [{ ...h, id: `${Date.now()}`, at: new Date().toISOString() }, ...prev.filter((x) => !(x.sql === h.sql && x.q === h.q))].slice(0, 60);
        store("quarry:history", next);
        return next;
      });
    },
    [],
  );

  const execute = useCallback(
    (d: Dataset, text: string, plan: Plan | null, notes: Bi[], q?: string) => {
      try {
        const res = d.db.run(text);
        setRun({ res, plan, sql: text, notes });
        const chartable = plan?.kind === "aggregate" && !!chooseChart(res, columnFormats(res, d.model, plan)) && res.rows.length > 1;
        setTab(chartable ? "chart" : "table");
        pushHistory({ q, sql: text, dataset: d.id, rows: res.rows.length });
      } catch (e) {
        setRun({ error: explainError((e as Error).message, d.model), plan, sql: text, notes });
        setTab("explain");
      }
    },
    [pushHistory],
  );

  const ask = useCallback(
    (q: string, d: Dataset | null = ds, prefer?: Record<string, string>) => {
      if (!d || !q.trim()) return;
      const [text, override] = q.split("\u0000");
      const pref = override ? Object.fromEntries([override.split("=")]) : prefer;
      setQuestion(text);
      const r = parse(text, d.model, { prefer: pref });
      setParsed(r);
      if (!r.ok || !r.plan) {
        setRun({ error: r.reason ?? { en: "No answer.", tr: "Cevap yok." }, plan: null, sql: "", notes: [] });
        return;
      }
      if (r.plan.lang !== lang) setLang(r.plan.lang);
      const built = toSql(d.model, r.plan);
      setSql(built.sql);
      execute(d, built.sql, r.plan, built.notes, text);
    },
    [ds, execute, lang, setLang],
  );

  // Boot: SQLite, the demo data, saved uploads, then a first question so the page opens on an answer.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    setHistory(load("quarry:history", []));
    setSaved(load("quarry:saved", []));
    listSaved().then((x) => setUploads(x));
    loadDemo()
      .then((d) => {
        setDs(d);
        const hash = new URLSearchParams(location.hash.slice(1));
        const hq = hash.get("q");
        const hs = hash.get("sql");
        if (hs) {
          setSql(hs);
          setParsed(null);
          execute(d, hs, null, []);
        } else {
          const l = load<Lang | null>("quarry:lang", null) ?? (navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en");
          ask(hq ?? examples(d.model, l)[1], d);
        }
      })
      .catch((e: Error) => setBootError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTo = async (id: string) => {
    if (id === "upload") return setUploadOpen(true);
    const d = id === "demo" ? await loadDemo() : await openSaved(id);
    if (!d) return toast(lang === "tr" ? "Veri seti açılamadı." : "That dataset could not be opened.", "error");
    openDataset(d);
  };
  const openDataset = (d: Dataset) => {
    setDs(d);
    setParsed(null);
    setRun(null);
    setSql("");
    setQuestion("");
    const ex = examples(d.model, lang);
    if (d.kind === "upload" && ex[0]) ask(ex[0], d);
    else if (d.kind === "demo") ask(ex[1], d);
  };

  const runSql = () => {
    if (!ds || !sql.trim()) return;
    const first = tokenizeSql(sql).find((x) => x.kind !== "comment");
    if (first && WRITE.has(first.v)) return setPendingWrite(sql);
    const keepPlan = run?.sql === sql ? run.plan : null;
    if (!keepPlan) {
      setParsed(null);
      setQuestion("");
    }
    execute(ds, sql, keepPlan, keepPlan ? run!.notes : []);
  };

  const share = async () => {
    if (ds?.kind !== "demo") return toast(t("shareUploads"), "error");
    const url = `${location.origin}${location.pathname}#${question && run?.plan ? `q=${encodeURIComponent(question)}` : `sql=${encodeURIComponent(sql)}`}`;
    try {
      await navigator.clipboard.writeText(url);
      window.history.replaceState(null, "", url);
      toast(t("shareCopied"));
    } catch {
      toast(url);
    }
  };

  const isSaved = saved.some((s) => s.sql === sql && (s.q ?? "") === (run?.plan ? question : ""));
  const toggleSave = () => {
    if (!sql.trim()) return;
    const next = isSaved ? saved.filter((s) => !(s.sql === sql)) : [{ id: `${Date.now()}`, q: run?.plan ? question : undefined, sql, at: new Date().toISOString(), dataset: ds?.id ?? "demo" }, ...saved].slice(0, 100);
    setSaved(next);
    store("quarry:saved", next);
    if (!isSaved) toast(t("saved"));
  };

  const pick = (h: HistoryItem) => {
    setDrawer(false);
    if (h.q) ask(h.q);
    else if (ds) {
      setSql(h.sql);
      setParsed(null);
      execute(ds, h.sql, null, []);
    }
  };

  const formats = useFormats(run?.res ?? null, ds?.model ?? null, run?.plan ?? null);
  const explanations = useMemo(() => (run?.sql && ds ? explain(run.sql, ds.model) : []), [run, ds]);
  const issues = explanations.reduce((n, e) => n + e.lints.filter((l) => l.level !== "info").length, 0);
  const answer = run?.res ? answerSentence(run.res, formats, run.plan, ds?.model ?? null, lang) : null;
  const hasChart = !!run?.res && !!chooseChart(run.res, formats);
  const ex = ds ? examples(ds.model, lang) : [];
  const exOther = ds?.model.source === "demo" ? examples(ds.model, lang === "en" ? "tr" : "en").slice(0, 2) : [];

  if (bootError)
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-sm">
          <p className="font-medium">SQLite could not start in this browser.</p>
          <p className="mt-1 text-muted">{bootError}</p>
        </div>
      </main>
    );

  const sidebar = ds && (
    <Sidebar ds={ds} tab={side} setTab={setSide} history={history.filter((h) => h.dataset === ds.id)} saved={saved.filter((h) => h.dataset === ds.id)} onInsert={(s) => { setSql(s); setParsed(null); setDrawer(false); execute(ds, s, null, []); }} onPick={pick} onUnsave={(h) => { const next = saved.filter((x) => x.id !== h.id); setSaved(next); store("quarry:saved", next); }} onMap={() => { setDrawer(false); setMapOpen(true); }} />
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
          <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setDrawer(true)} aria-label={t("tables")}>
            <Menu className="size-4" />
          </button>
          <a href="#" onClick={(e) => { e.preventDefault(); if (ds) openDataset(ds); }} className="flex items-center gap-2 font-semibold tracking-[-0.01em]">
            <QuarryMark />
            <span>Quarry</span>
          </a>
          <span className="hidden text-muted md:inline">·</span>
          <span className="hidden truncate text-muted md:inline">{t("tagline")}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <label className="sr-only" htmlFor="dataset">
              {t("dataset")}
            </label>
            <div className="relative hidden sm:block">
              <Database className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
              <select id="dataset" value={ds?.id ?? "demo"} onChange={(e) => switchTo(e.target.value)} className="h-8 max-w-60 rounded-md border border-border bg-surface pr-7 pl-7 text-[12.5px]">
                <option value="demo">Brightwater ({t("demoData").toLowerCase()})</option>
                {uploads.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                <option value="upload">{t("upload")}…</option>
              </select>
            </div>
            <Button size="sm" onClick={() => setUploadOpen(true)} aria-label={t("upload")}>
              <Upload /> <span className="hidden sm:inline">{t("upload")}</span>
            </Button>
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label={t("language")}>
              {(["en", "tr"] as Lang[]).map((l) => (
                <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={cx("h-6 rounded px-1.5 text-[11px] font-semibold uppercase", lang === l ? "bg-surface-3 text-text" : "text-muted hover:text-text")}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => setAboutOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text" aria-label={t("about")}>
              <HelpCircle className="size-4" />
            </button>
            <ThemeToggle />
            <a href={REPO} target="_blank" rel="noreferrer" className="hidden rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text sm:block" aria-label={t("source")}>
              <Code className="size-4" />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] border-r border-border lg:block">{sidebar}</aside>

        <main className="min-w-0 space-y-4 px-3 py-4 sm:px-6 sm:py-6">
          {!ds ? (
            <div className="space-y-4" role="status" aria-label={t("loading")}>
              <div className="skeleton h-12 rounded-lg" />
              <div className="skeleton h-40 rounded-lg" />
              <div className="skeleton h-72 rounded-lg" />
              <p className="flex items-center justify-center gap-2 text-muted">
                <Loader2 className="size-4 animate-spin" /> {t("loading")}
              </p>
            </div>
          ) : (
            <>
              {/* Ask */}
              <section aria-label={t("ask")} className="animate-enter">
                {ds.kind === "demo" && <p className="mb-3 max-w-3xl text-muted">{t("welcome")}</p>}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask(question);
                  }}
                  className="flex gap-2"
                >
                  <div className="relative min-w-0 flex-1">
                    <Sparkles className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-accent" aria-hidden />
                    <input
                      ref={askRef}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      maxLength={300}
                      placeholder={t("askPlaceholder")}
                      aria-label={t("ask")}
                      className="h-11 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-[14px] shadow-card transition-colors placeholder:text-faint hover:border-border-strong focus:border-accent focus:outline-none"
                    />
                  </div>
                  <Button variant="primary" type="submit" className="h-11 px-4">
                    {t("ask")} <ArrowRight />
                  </Button>
                </form>
                <div className="scroll-thin -mx-3 mt-2.5 flex items-center gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
                  <span className="mr-0.5 shrink-0 text-xs text-faint">{t("examples")}:</span>
                  {[...ex, ...exOther].map((x) => (
                    <button key={x} onClick={() => ask(x)} className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-xs whitespace-nowrap text-muted transition-colors hover:border-border-strong hover:text-text">
                      {x}
                    </button>
                  ))}
                </div>
                {parsed && (parsed.ok || parsed.ignored.length > 0) && <Understood p={parsed} onAlt={(q) => ask(q)} />}
              </section>

              {/* Result */}
              {run && (
                <Card className="animate-rise overflow-hidden" aria-live="polite">
                  {run.error ? (
                    <div className="p-4">
                      <p className="font-medium text-danger">{run.sql ? t("errorTitle") : t("noAnswer")}</p>
                      <p className="mt-1 text-muted">{run.error[lang]}</p>
                      {parsed && !parsed.ok && parsed.ignored.length > 0 && <p className="mt-2 text-xs text-faint">{t("notUsed")}: {parsed.ignored.join(", ")}</p>}
                      {run.sql && explanations.length > 0 && <ExplainPanel explanations={explanations} />}
                    </div>
                  ) : run.res ? (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                        <div className="min-w-0">
                          {answer && <p className="text-[15px] font-medium tracking-[-0.005em]" data-testid="answer">{answer}</p>}
                          <p className="mt-0.5 text-xs text-faint tabular-nums">
                            {run.res.columns.length ? `${run.res.rows.length.toLocaleString(lang === "tr" ? "tr-TR" : "en-US")} ${run.res.rows.length === 1 ? t("row") : t("rows")} · ` : ""}
                            {run.res.ms.toFixed(1)} {t("ms")}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ResultTabs tab={tab === "chart" && !hasChart ? "table" : tab} setTab={setTab} hasChart={hasChart} issues={issues} />
                          {run.res.columns.length > 0 && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => download("quarry-result.csv", toCsv(run.res!), "text/csv;charset=utf-8")} aria-label={`${t("exportCsv")} export`}>
                                <ExportIcons.Download /> {t("exportCsv")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={async () => download("quarry-result.xlsx", await toXlsx(run.res!, formats, run.sql), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")} aria-label={`${t("exportXlsx")} export`}>
                                <ExportIcons.FileSpreadsheet /> {t("exportXlsx")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {(tab === "chart" && hasChart) ? <ResultChart r={run.res} formats={formats} /> : tab === "explain" ? <ExplainPanel explanations={explanations} /> : run.res.columns.length ? <ResultTable key={run.sql} r={run.res} formats={formats} /> : <p className="p-4 text-muted">{answer}</p>}
                    </>
                  ) : null}
                </Card>
              )}
              {/* SQL */}
              <Card className="animate-enter">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-[13px] font-medium">{t("sqlTitle")}</h2>
                    <span className="hidden text-xs text-faint sm:inline">{t("sqlHint")}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard?.writeText(sql).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} aria-label={t("copy")}>
                      {copied ? <Check /> : <Copy />} <span className="hidden sm:inline">{copied ? t("copied") : t("copy")}</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={toggleSave} aria-pressed={isSaved} aria-label={t("save")}>
                      {isSaved ? <BookmarkCheck /> : <Bookmark />} <span className="hidden sm:inline">{isSaved ? t("saved") : t("save")}</span>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={share} aria-label={t("share")}>
                      <Link2 /> <span className="hidden sm:inline">{t("share")}</span>
                    </Button>
                    <Button size="sm" variant="primary" onClick={runSql}>
                      <Play /> {t("run")}
                    </Button>
                  </div>
                </div>
                <div className="p-3">
                  <SqlEditor value={sql} onChange={setSql} onRun={runSql} label={t("sqlTitle")} />
                  {run?.notes.map((n, i) => (
                    <p key={i} className="mt-2 text-xs text-muted">
                      {n[lang]}
                    </p>
                  ))}
                </div>
              </Card>

              <p className="pb-2 text-center text-xs text-faint">{t("readOnlyNote")}</p>
            </>
          )}
        </main>
      </div>

      {/* Mobile drawer */}
      {drawer && ds && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label={t("close")} onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-80 animate-drawer flex-col border-r border-border bg-bg">
            <div className="flex h-12 items-center justify-between border-b border-border px-3">
              <select value={ds.id} onChange={(e) => { setDrawer(false); switchTo(e.target.value); }} className="h-8 max-w-56 rounded-md border border-border bg-surface px-2 text-[12.5px]" aria-label={t("dataset")}>
                <option value="demo">Brightwater ({t("demoData").toLowerCase()})</option>
                {uploads.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                <option value="upload">{t("upload")}…</option>
              </select>
              <button onClick={() => setDrawer(false)} className="rounded-md p-1.5 text-muted" aria-label={t("close")}>
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">{sidebar}</div>
          </div>
        </div>
      )}

      {ds && (
        <Modal open={mapOpen} onClose={() => setMapOpen(false)} title={`${t("map")} · ${ds.name}`} wide>
          <SchemaMap model={ds.model} />
        </Modal>
      )}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onLoaded={(d) => {
          setUploads((u) => [{ id: d.id, name: d.name }, ...u]);
          openDataset(d);
        }}
      />
      <Modal
        open={!!pendingWrite}
        onClose={() => setPendingWrite(null)}
        title={t("confirmWrite")}
        footer={
          <>
            <Button onClick={() => setPendingWrite(null)}>{t("cancel")}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const s = pendingWrite!;
                setPendingWrite(null);
                if (ds) execute(ds, s, null, []);
              }}
            >
              {t("confirm")}
            </Button>
          </>
        }
      >
        {pendingWrite && ds && (
          <div className="space-y-2">
            {explain(pendingWrite, ds.model).map((e, i) => (
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
      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title={t("about")}>
        <div className="space-y-3 text-muted">
          <p>{t("aboutText")}</p>
          {ds && ds.kind === "upload" && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <span className="min-w-0 truncate text-text">{ds.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await removeSaved(ds.id);
                  setUploads((u) => u.filter((x) => x.id !== ds.id));
                  setAboutOpen(false);
                  switchTo("demo");
                }}
              >
                {t("remove")}
              </Button>
            </div>
          )}
          {ds?.kind === "demo" && (
            <Button
              size="sm"
              onClick={async () => {
                setAboutOpen(false);
                openDataset(await loadDemo());
                toast(t("resetDone"));
              }}
            >
              <RotateCcw /> {t("resetDb")}
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Understood({ p, onAlt }: { p: ParseResult; onAlt: (q: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const notes = p.plan?.notes.filter((n) => n.kind !== "ignored") ?? [];
  const pct = Math.round(p.confidence * 100);
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 animate-enter" data-testid="understood">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-faint">{t("understood")}</span>
        {notes.map((n, i) => (
          <span key={i} className={cx("rounded-md border px-2 py-0.5 text-xs", n.kind === "measure" ? "border-accent/30 bg-accent-soft text-text" : "border-border bg-surface text-muted")}>
            {n[lang]}
          </span>
        ))}
        {p.ok && (
          <span className={cx("ml-auto text-[11px] tabular-nums", pct >= 85 ? "text-success" : pct >= 60 ? "text-warning" : "text-danger")} title={t("confidence")}>
            {t("confidence")} {pct}%
          </span>
        )}
      </div>
      {p.ignored.length > 0 && (
        <p className="mt-1.5 text-xs text-faint">
          {t("notUsed")}: {p.ignored.join(", ")}
        </p>
      )}
      {p.alternatives.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-faint">{t("didYouMean")}:</span>
          {p.alternatives.map((a) => (
            <button key={a.question} onClick={() => onAlt(a.question)} className="rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent-soft">
              {a[lang]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
