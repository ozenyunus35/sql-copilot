"use client";

import { BookOpen, Code, Command as CommandIcon, Database, HelpCircle, LayoutDashboard, Loader2, MessageSquareText, Moon, RotateCcw, SquareTerminal, Table2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { listSaved, loadDemo, openSaved, removeSaved, type Dataset } from "@/lib/engine";
import { examples } from "@/lib/examples";
import { LangContext, type Lang, useT } from "@/lib/i18n";
import { answerQuestion, defaultPins, load, runSql, slim, store, uid, withWords, type Answer, type Pin, type Word } from "@/lib/workspace";
import { AskView } from "./ask-view";
import { QuarryMark } from "./brand";
import { Dashboard } from "./dashboard";
import { DataView } from "./data-view";
import { Palette, type Command } from "./palette";
import type { HistoryItem } from "./sidebar";
import { SqlView, type SqlTab } from "./sql-view";
import { ThemeToggle } from "./theme-toggle";
import { useToast } from "./toast";
import { Button, Modal, cx } from "./ui";
import { UploadDialog } from "./upload";
import type { ChartKind } from "./chart-shape";
import { preloadViz } from "./viz-lazy";

const REPO = "https://github.com/ozenyunus35/sql-copilot";
type View = "ask" | "sql" | "dashboard" | "data";

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
      <Workspace lang={lang} setLang={setLang} />
    </LangContext.Provider>
  );
}

const defaultTabs = (lang: Lang): SqlTab[] => [
  {
    id: "t1",
    name: lang === "tr" ? "Sorgu 1" : "Query 1",
    sql: "-- Revenue and invoices per segment this year\nSELECT\n  c.segment,\n  COUNT(*) AS invoices,\n  ROUND(SUM(i.total), 2) AS revenue\nFROM invoices AS i\nJOIN customers AS c ON c.id = i.customer_id\nWHERE i.status <> 'void'\n  AND i.issued_at >= date('now', 'start of year')\nGROUP BY c.segment\nORDER BY revenue DESC;",
  },
];

function Workspace({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = useT();
  const { toast } = useToast();
  const tr = lang === "tr";
  const [ds, setDs] = useState<Dataset | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string }>>([]);
  const [view, setView] = useState<View>("ask");
  const [thread, setThread] = useState<Answer[]>([]);
  const [pins, setPinsState] = useState<Pin[]>([]);
  const [words, setWordsState] = useState<Word[]>([]);
  const [tabs, setTabsState] = useState<SqlTab[]>(() => defaultTabs("en"));
  const [activeTab, setActiveTab] = useState("t1");
  const [saved, setSaved] = useState<HistoryItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const booted = useRef(false);

  const model = useMemo(() => (ds ? withWords(ds.model, words) : null), [ds, words]);

  const setPins = (p: Pin[]) => {
    setPinsState(p);
    if (ds) store(`quarry:pins:${ds.id}`, p);
  };
  const setWords = (w: Word[]) => {
    setWordsState(w);
    if (ds) store(`quarry:words:${ds.id}`, w);
  };
  const setTabs = (x: SqlTab[]) => {
    setTabsState(x);
    if (ds) store(`quarry:tabs:${ds.id}`, x);
  };
  const saveThread = (d: Dataset, x: Answer[]) => store(`quarry:thread:${d.id}`, x.slice(-30).map(slim));

  const pushHistory = useCallback((h: Omit<HistoryItem, "id" | "at">) => {
    setHistory((prev) => {
      const next = [{ ...h, id: uid(), at: new Date().toISOString() }, ...prev.filter((x) => !(x.sql === h.sql && x.q === h.q))].slice(0, 80);
      store("quarry:history", next);
      return next;
    });
  }, []);

  /** Opens a dataset with its thread (re-run against the data), pins, words and SQL tabs from this browser. */
  const openDataset = useCallback((d: Dataset, l: Lang) => {
    setDs(d);
    const w = load<Word[]>(`quarry:words:${d.id}`, []);
    setWordsState(w);
    const m = withWords(d.model, w);
    const storedPins = load<Pin[] | null>(`quarry:pins:${d.id}`, null);
    setPinsState(storedPins ?? defaultPins(m, l));
    const tb = load<SqlTab[] | null>(`quarry:tabs:${d.id}`, null);
    const tabsNow = tb?.length ? tb : defaultTabs(l);
    setTabsState(tabsNow);
    setActiveTab(tabsNow[0].id);
    const th = load<Answer[]>(`quarry:thread:${d.id}`, []);
    setThread(th.map((a) => (a.sql ? { ...a, ...runSql(d, a.sql) } : a)));
  }, []);

  const ask = useCallback(
    (q: string, fresh = false, d: Dataset | null = ds) => {
      if (!d || !q.trim()) return;
      const m = d === ds && model ? model : withWords(d.model, load<Word[]>(`quarry:words:${d.id}`, []));
      setView("ask");
      setThread((prev) => {
        const last = [...prev].reverse().find((x) => x.plan && x.question);
        const base = !fresh && last ? { plan: last.plan!, question: last.question! } : undefined;
        const a = answerQuestion(d, m, q, base);
        if (a.plan && a.plan.lang !== readLang()) setTimeout(() => setLang(a.plan!.lang), 0);
        pushHistory({ q: a.question, sql: a.sql, dataset: d.id, rows: a.res?.rows.length });
        const next = [...prev, a].slice(-30);
        saveThread(d, next);
        return next;
      });
    },
    [ds, model, pushHistory, setLang],
  );

  // Boot: SQLite and the demo data, saved uploads, then a shared question if the link has one.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    setHistory(load("quarry:history", []));
    setSaved(load("quarry:saved", []));
    listSaved().then((x) => setUploads(x));
    const l = readLang();
    loadDemo()
      .then((d) => {
        openDataset(d, l);
        preloadViz();
        const hash = new URLSearchParams(location.hash.slice(1));
        const hq = hash.get("q");
        const hs = hash.get("sql");
        const hv = hash.get("view") as View | null;
        if (hq) ask(hq, true, d);
        else if (hs) {
          const id = `t${uid()}`;
          setTabsState((x) => [...x, { id, name: l === "tr" ? "Paylaşılan" : "Shared", sql: hs }]);
          setActiveTab(id);
          setView("sql");
        } else if (hv && ["ask", "sql", "dashboard", "data"].includes(hv)) setView(hv);
      })
      .catch((e: Error) => setBootError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The open view lives in the address, so a reload or a copied link lands on the same page.
  useEffect(() => {
    if (!ds) return;
    const h = view === "ask" ? "" : `#view=${view}`;
    if (location.hash !== h) window.history.replaceState(null, "", location.pathname + location.search + h);
  }, [view, ds]);

  // ⌘K / Ctrl+K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const switchTo = async (id: string) => {
    if (id === "upload") return setUploadOpen(true);
    const d = id === "demo" ? await loadDemo() : await openSaved(id);
    if (!d) return toast(tr ? "Veri seti açılamadı." : "That dataset could not be opened.", "error");
    openDataset(d, lang);
    setView("ask");
  };

  const pin = (a: Answer, chart: ChartKind) => {
    if (!ds || !a.res) return;
    const single = a.res.rows.length === 1 && a.res.columns.length === 1 && typeof a.res.rows[0][0] === "number";
    const p: Pin = { id: uid(), title: a.question ?? (tr ? "SQL sorgusu" : "SQL query"), question: a.question, sql: a.sql, chart: single ? "kpi" : a.res.rows.length > 1 && chart !== "auto" ? chart : a.plan?.kind === "aggregate" || !a.plan ? "auto" : "table", width: 1 };
    setPins([...pins, p]);
    toast(tr ? "Panoya eklendi." : "Added to the dashboard.");
  };

  const openSql = (sql: string) => {
    const id = `t${uid()}`;
    setTabs([...tabs, { id, name: tr ? `Sorgu ${tabs.length + 1}` : `Query ${tabs.length + 1}`, sql }]);
    setActiveTab(id);
    setView("sql");
  };

  const toggleSave = (sql: string) => {
    if (!sql.trim() || !ds) return;
    const has = saved.some((s) => s.sql === sql);
    const next = has ? saved.filter((s) => s.sql !== sql) : [{ id: uid(), sql, at: new Date().toISOString(), dataset: ds.id }, ...saved].slice(0, 100);
    setSaved(next);
    store("quarry:saved", next);
    if (!has) toast(t("saved"));
  };

  const clearThread = () => {
    setThread([]);
    if (ds) saveThread(ds, []);
  };

  const NAV: Array<{ id: View; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "ask", label: tr ? "Sor" : "Ask", icon: MessageSquareText },
    { id: "sql", label: "SQL", icon: SquareTerminal },
    { id: "dashboard", label: tr ? "Pano" : "Dashboard", icon: LayoutDashboard },
    { id: "data", label: tr ? "Veri" : "Data", icon: Table2 },
  ];

  const commands: Command[] = !ds || !model
    ? []
    : [
        ...NAV.map((n) => ({ id: `nav-${n.id}`, label: n.label, group: tr ? "Git" : "Go to", icon: n.icon, run: () => setView(n.id) })),
        { id: "upload", label: t("upload"), group: tr ? "İşlemler" : "Actions", icon: Upload, run: () => setUploadOpen(true) },
        { id: "lang", label: tr ? "Switch to English" : "Türkçeye geç", group: tr ? "İşlemler" : "Actions", icon: BookOpen, run: () => setLang(tr ? "en" : "tr") },
        { id: "theme", label: tr ? "Temayı değiştir" : "Toggle theme", group: tr ? "İşlemler" : "Actions", icon: Moon, run: () => (document.querySelector("[data-theme-toggle]") as HTMLButtonElement | null)?.click() },
        { id: "clear", label: tr ? "Soru akışını temizle" : "Clear the question thread", group: tr ? "İşlemler" : "Actions", icon: Trash2, run: clearThread },
        ...examples(model, lang).map((q, i) => ({ id: `ex${i}`, label: q, group: tr ? "Örnek sorular" : "Example questions", icon: MessageSquareText, run: () => ask(q, true) })),
        ...model.tables.map((x) => ({ id: `tb-${x.name}`, label: x.name, group: tr ? "Tablolar" : "Tables", icon: Table2, hint: x.rows.toLocaleString(tr ? "tr-TR" : "en-US"), run: () => openSql(`SELECT *\nFROM ${x.name}\nLIMIT 100;`) })),
      ];

  if (bootError)
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-sm">
          <p className="font-medium">SQLite could not start in this browser.</p>
          <p className="mt-1 text-muted">{bootError}</p>
        </div>
      </main>
    );

  const datasetSelect = (cls: string) => (
    <select value={ds?.id ?? "demo"} onChange={(e) => switchTo(e.target.value)} className={cls} aria-label={t("dataset")}>
      <option value="demo">Brightwater ({t("demoData").toLowerCase()})</option>
      {uploads.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
      <option value="upload">{t("upload")}…</option>
    </select>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-2 px-3 sm:px-5">
          <button onClick={() => setView("ask")} className="flex shrink-0 items-center gap-2 font-semibold tracking-[-0.01em]" aria-label="Quarry">
            <QuarryMark />
            <span>Quarry</span>
          </button>
          <nav className="ml-3 hidden items-center gap-0.5 md:flex" aria-label={tr ? "Bölümler" : "Sections"}>
            {NAV.map((n) => (
              <button key={n.id} onClick={() => setView(n.id)} aria-current={view === n.id ? "page" : undefined} className={cx("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors", view === n.id ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text")}>
                <n.icon className="size-3.5" /> {n.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setPaletteOpen(true)} className="hidden h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[12.5px] text-faint hover:text-muted xl:flex" aria-label={tr ? "Komut paleti" : "Command palette"}>
              <CommandIcon className="size-3.5" /> {tr ? "Ara ya da sor" : "Search or ask"} <kbd className="rounded border border-border px-1 text-[10px]">⌘K</kbd>
            </button>
            <div className="relative hidden sm:block">
              <Database className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
              {datasetSelect("h-8 max-w-60 rounded-md border border-border bg-surface pr-7 pl-7 text-[12.5px]")}
            </div>
            <Button size="sm" onClick={() => setUploadOpen(true)} aria-label={t("upload")}>
              <Upload /> <span className="hidden xl:inline">{t("upload")}</span>
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
        {/* Sections on small screens */}
        <nav className="flex border-t border-border md:hidden" aria-label={tr ? "Bölümler" : "Sections"}>
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setView(n.id)} aria-current={view === n.id ? "page" : undefined} className={cx("-mb-px flex h-10 flex-1 items-center justify-center gap-1.5 border-b-2 text-[12.5px] font-medium", view === n.id ? "border-accent text-text" : "border-transparent text-muted")}>
              <n.icon className="size-3.5" /> {n.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        {!ds || !model ? (
          <div className="mx-auto max-w-4xl space-y-4 px-4 py-10" role="status" aria-label={t("loading")}>
            <div className="skeleton mx-auto h-9 w-2/3 rounded-lg" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-24 rounded-xl" />
              ))}
            </div>
            <div className="skeleton h-56 rounded-xl" />
            <p className="flex items-center justify-center gap-2 text-muted">
              <Loader2 className="size-4 animate-spin" /> {t("loading")}
            </p>
          </div>
        ) : view === "ask" ? (
          <>
            {ds.kind === "upload" && <div className="mx-auto max-w-4xl px-3 pt-3 sm:hidden">{datasetSelect("h-8 w-full rounded-md border border-border bg-surface px-2 text-[12.5px]")}</div>}
            <AskView
              ds={ds}
              model={model}
              thread={thread}
              pins={pins}
              onAsk={(q, fresh) => ask(q, fresh)}
              onRemove={(id) =>
                setThread((x) => {
                  const n = x.filter((a) => a.id !== id);
                  saveThread(ds, n);
                  return n;
                })
              }
              onPin={pin}
              onOpenSql={openSql}
              onUpload={() => setUploadOpen(true)}
              onClear={clearThread}
            />
          </>
        ) : view === "sql" ? (
          <SqlView ds={ds} model={model} tabs={tabs} setTabs={setTabs} active={activeTab} setActive={setActiveTab} saved={saved.filter((s) => s.dataset === ds.id)} onSave={toggleSave} onPin={pin} history={history.filter((h) => h.dataset === ds.id)} onRun={(sql) => pushHistory({ sql, dataset: ds.id })} />
        ) : view === "dashboard" ? (
          <Dashboard ds={ds} model={model} pins={pins} setPins={setPins} onAsk={(q) => ask(q, true)} onReset={() => setPins(defaultPins(model, lang))} />
        ) : (
          <DataView ds={ds} model={model} words={words} setWords={setWords} onAsk={(q) => ask(q, true)} />
        )}
      </main>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onLoaded={(d) => {
          setUploads((u) => [{ id: d.id, name: d.name }, ...u]);
          openDataset(d, lang);
          setView("ask");
        }}
      />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} onAsk={(q) => ask(q)} />
      <Modal open={aboutOpen} onClose={() => setAboutOpen(false)} title={t("about")} wide>
        <div className="grid gap-6 text-muted md:grid-cols-2">
          <div className="space-y-3">
            <p>{t("aboutText")}</p>
            <p className="font-medium text-text">{t("accuracy")}</p>
            <table className="w-full text-[12.5px]">
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-1.5">{tr ? "Saklı set 2, ilk çalıştırma (56 soru)" : "Holdout 2, first run (56 questions)"}</td>
                  <td className="py-1.5 text-right font-medium text-text tabular-nums">82%</td>
                </tr>
                <tr>
                  <td className="py-1.5">{tr ? "Görülmemiş rastgele sorular (3 × 300)" : "Unseen random questions (3 × 300)"}</td>
                  <td className="py-1.5 text-right font-medium text-text tabular-nums">98–99%</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-faint">{tr ? "Her cevap, elle yazılmış doğru SQL'in sonucuyla karşılaştırılarak ölçüldü. Ayrıntılar README'de." : "Each answer was checked against the result of a hand-written reference query. Details in the README."}</p>
          </div>
          <div className="space-y-3">
            <p className="font-medium text-text">{t("keyboard")}</p>
            <ul className="space-y-1.5 text-[12.5px]">
              {[
                ["/", tr ? "Soru kutusuna git" : "Focus the question box"],
                ["⌘K", tr ? "Komut paleti" : "Command palette"],
                ["Tab", tr ? "Öneriyi tamamla" : "Complete a suggestion"],
                ["⌘↵", tr ? "SQL'i çalıştır" : "Run the SQL"],
              ].map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-3">
                  <span>{v}</span>
                  <kbd className="rounded border border-border px-1.5 text-[11px]">{k}</kbd>
                </li>
              ))}
            </ul>
            {ds?.kind === "upload" && (
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
                  openDataset(await loadDemo(), lang);
                  toast(t("resetDone"));
                }}
              >
                <RotateCcw /> {t("resetDb")}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
