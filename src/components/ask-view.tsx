"use client";

import { ArrowUp, Banknote, Boxes, CornerDownRight, Cpu, Globe2, Languages, Receipt, ShieldCheck, Upload, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { suggestQuestion, type Suggestion } from "@/lib/complete";
import type { Dataset } from "@/lib/engine";
import { examples } from "@/lib/examples";
import { useLang, useT } from "@/lib/i18n";
import type { Model } from "@/lib/model";
import type { Answer, Pin } from "@/lib/workspace";
import { AnswerCard } from "./answer-card";
import { Kpi } from "./dashboard";
import { cx } from "./ui";
import type { ChartKind } from "./viz";

const TOPICS = {
  en: [
    { icon: Banknote, title: "Sales", qs: ["Monthly revenue this year", "Top 5 customers by revenue last quarter", "Revenue this year vs last year"] },
    { icon: Receipt, title: "Receivables", qs: ["Who owes us the most?", "Overdue invoices by country", "Average days to pay by segment"] },
    { icon: Boxes, title: "Products", qs: ["Gross margin by category", "Best selling products this year", "Products never sold"] },
    { icon: Wallet, title: "Costs", qs: ["Expenses by category this year", "Top 5 vendors by spend", "Monthly expenses this year"] },
  ],
  tr: [
    { icon: Banknote, title: "Satış", qs: ["Bu yıl aylık ciro", "Son 6 ayda en çok harcayan 5 müşteri", "Bu yıl ile geçen yıl ciro karşılaştırması"] },
    { icon: Receipt, title: "Alacaklar", qs: ["Bize en çok borcu olan müşteri kim", "Ülkelere göre vadesi geçmiş faturalar", "Segmentlere göre ortalama ödeme süresi"] },
    { icon: Boxes, title: "Ürünler", qs: ["Kategorilere göre brüt kâr marjı", "Bu yıl en çok satan 10 ürün", "Hiç satılmamış ürünler"] },
    { icon: Wallet, title: "Giderler", qs: ["Bu yıl gider türüne göre giderler", "Harcamaya göre ilk 5 tedarikçi", "Bu yıl aylık giderler"] },
  ],
};

export function AskBar({ model, onAsk, base, onClearBase, autoFocus, big }: { model: Model; onAsk: (q: string, fresh: boolean) => void; base?: string | null; onClearBase?: () => void; autoFocus?: boolean; big?: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ items: Suggestion[]; start: number; i: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && window.matchMedia("(min-width: 768px)").matches) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const submit = () => {
    if (!q.trim()) return;
    onAsk(q.trim(), false);
    setQ("");
    setMenu(null);
  };
  const accept = (s: Suggestion) => {
    if (!menu) return;
    const caret = input.current?.selectionStart ?? q.length;
    const next = q.slice(0, menu.start) + s.text + " " + q.slice(caret).trimStart();
    setQ(next);
    setMenu(null);
    requestAnimationFrame(() => {
      const pos = menu.start + s.text.length + 1;
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className="relative">
      {base && (
        <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[11.5px] text-faint">
          <CornerDownRight className="size-3 shrink-0 text-accent" />
          <span className="min-w-0 truncate">
            {lang === "tr" ? "Önceki soruya devam edebilirsiniz:" : "You can follow up on:"} <span className="text-muted">“{base}”</span>
          </span>
          <button onClick={onClearBase} className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded px-1 hover:bg-surface-2 hover:text-text">
            <X className="size-3" /> {t("newQuestion")}
          </button>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (menu && menu.items[menu.i] && menu.i >= 0) return;
          submit();
        }}
        className={cx("flex items-center gap-2 rounded-2xl border border-border bg-surface pr-2 pl-4 shadow-card transition-colors focus-within:border-accent", big ? "h-14" : "h-12")}
      >
        <input
          ref={input}
          value={q}
          maxLength={300}
          role="combobox"
          aria-expanded={!!menu}
          aria-controls="ask-suggestions"
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            const s = suggestQuestion(e.target.value, e.target.selectionStart ?? e.target.value.length, model, lang);
            setMenu(s.items.length ? { items: s.items, start: s.start, i: -1 } : null);
          }}
          onBlur={() => setTimeout(() => document.activeElement !== input.current && setMenu(null), 120)}
          onKeyDown={(e) => {
            if (!menu) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const d = e.key === "ArrowDown" ? 1 : -1;
              // -1 means "nothing picked": Enter then asks the question as typed.
              const n = menu.items.length;
              const i = menu.i + d;
              setMenu({ ...menu, i: i >= n ? -1 : i < -1 ? n - 1 : i });
            } else if ((e.key === "Tab" || e.key === "Enter") && menu.i >= 0) {
              e.preventDefault();
              accept(menu.items[menu.i]);
            } else if (e.key === "Tab") {
              e.preventDefault();
              accept(menu.items[0]);
            } else if (e.key === "Escape") setMenu(null);
          }}
          placeholder={t("askPlaceholder")}
          aria-label={t("ask")}
          className={cx("min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint", big ? "text-[15px]" : "text-[14px]")}
        />
        <kbd className="hidden rounded border border-border px-1.5 text-[10.5px] text-faint sm:block">/</kbd>
        <button type="submit" disabled={!q.trim()} aria-label={t("ask")} className={cx("grid shrink-0 place-items-center rounded-xl bg-accent text-accent-fg transition-opacity disabled:opacity-40", big ? "size-10" : "size-8")}>
          <ArrowUp className="size-4" />
        </button>
      </form>
      {menu && (
        <ul id="ask-suggestions" role="listbox" className="absolute inset-x-0 bottom-full z-30 mb-2 animate-pop overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-pop">
          {menu.items.map((s, i) => (
            <li key={`${s.kind}${s.text}`} role="option" aria-selected={i === menu.i}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                className={cx("flex w-full items-center gap-3 px-3 py-1.5 text-left", i === menu.i ? "bg-accent-soft" : "hover:bg-surface-2")}
              >
                <span className="w-16 shrink-0 text-[10.5px] font-medium tracking-wide text-faint uppercase">{{ table: lang === "tr" ? "tablo" : "table", column: lang === "tr" ? "sütun" : "column", measure: lang === "tr" ? "ölçü" : "measure", value: lang === "tr" ? "değer" : "value", date: lang === "tr" ? "tarih" : "date", keyword: "sql", function: "fn" }[s.kind]}</span>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {s.detail && <span className="hidden max-w-[45%] shrink-0 truncate text-[11px] text-faint sm:block">{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Welcome({ ds, model, pins, onAsk, onUpload }: { ds: Dataset; model: Model; pins: Pin[]; onAsk: (q: string) => void; onUpload: () => void }) {
  const { lang } = useLang();
  const tr = lang === "tr";
  const kpis = pins.filter((p) => p.chart === "kpi").slice(0, 4);
  const rows = model.tables.reduce((s, t) => s + t.rows, 0);
  const topics = ds.kind === "demo" ? TOPICS[lang] : [{ icon: Globe2, title: ds.name, qs: examples(model, lang) }];
  return (
    <div className="animate-enter space-y-7 pt-2 sm:pt-6">
      <div className="text-center">
        <h1 className="text-[26px] leading-8 font-semibold tracking-[-0.02em] sm:text-[32px] sm:leading-10">{tr ? "Verinize ne sormak istersiniz?" : "What would you like to know?"}</h1>
        <p className="mx-auto mt-2 max-w-xl text-[14px] text-muted">
          {ds.kind === "demo"
            ? tr
              ? "Brightwater Supply Co. hayali bir toptancı: son üç yılın müşterileri, faturaları, ödemeleri, ürünleri ve giderleri. Türkçe ya da İngilizce sorun; Quarry SQL'i yazar, çalıştırır ve açıklar."
              : "Brightwater Supply Co. is a fictional wholesaler with three years of customers, invoices, payments, products and expenses. Ask in English or Turkish; Quarry writes the SQL, runs it and explains it."
            : tr
              ? `${ds.name}: ${model.tables.length} tablo, ${rows.toLocaleString("tr-TR")} satır. Sütun adlarındaki kelimelerle sorun.`
              : `${ds.name}: ${model.tables.length} table${model.tables.length > 1 ? "s" : ""}, ${rows.toLocaleString("en-US")} rows. Ask using the words in your column names.`}
        </p>
        <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11.5px] text-faint">
          <li className="inline-flex items-center gap-1">
            <Cpu className="size-3.5" /> {tr ? "Yapay zekâ servisi yok, kurallarla çalışır" : "No AI service: a rule-based engine"}
          </li>
          <li className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5" /> {tr ? "Veri tarayıcıdan çıkmaz" : "Data never leaves your browser"}
          </li>
          <li className="inline-flex items-center gap-1">
            <Languages className="size-3.5" /> English · Türkçe
          </li>
        </ul>
      </div>
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((p) => (
            <Kpi key={p.id} ds={ds} model={model} title={p.title} sql={p.sql} question={p.question} onClick={() => p.question && onAsk(p.question)} />
          ))}
        </div>
      )}
      <div className={cx("grid gap-3", topics.length > 1 ? "sm:grid-cols-2" : "")}>
        {topics.map((tp) => (
          <div key={tp.title} className="rounded-xl border border-border bg-surface p-3.5 shadow-card">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
              <tp.icon className="size-3.5 text-accent" /> {tp.title}
            </p>
            <ul className="space-y-0.5">
              {tp.qs.map((q) => (
                <li key={q}>
                  <button onClick={() => onAsk(q)} className="w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2 hover:text-accent">
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {ds.kind === "demo" && (
        <button onClick={onUpload} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-4 py-3 text-muted transition-colors hover:border-accent hover:text-accent">
          <Upload className="size-4" /> {tr ? "Ya da kendi CSV, Excel, JSON veya SQLite dosyanızı yükleyin" : "Or upload your own CSV, Excel, JSON or SQLite file"}
        </button>
      )}
    </div>
  );
}

export function AskView({ ds, model, thread, pins, onAsk, onRemove, onPin, onOpenSql, onUpload, onClear }: { ds: Dataset; model: Model; thread: Answer[]; pins: Pin[]; onAsk: (q: string, fresh: boolean) => void; onRemove: (id: string) => void; onPin: (a: Answer, chart: ChartKind) => void; onOpenSql: (sql: string) => void; onUpload: () => void; onClear: () => void }) {
  const { lang } = useLang();
  const end = useRef<HTMLDivElement>(null);
  const [fresh, setFresh] = useState(false);
  const last = thread[thread.length - 1];
  const base = !fresh && last?.plan && last.question ? last.question : null;
  const count = thread.length;
  useEffect(() => {
    if (count) end.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [count]);
  const lastId = useMemo(() => thread[thread.length - 1]?.id, [thread]);
  return (
    <div className="flex min-h-[calc(100vh-6.5rem)] flex-col">
      <div className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-3 pt-4 pb-6 sm:px-6">
        {!thread.length ? (
          <Welcome ds={ds} model={model} pins={pins} onAsk={(q) => onAsk(q, true)} onUpload={onUpload} />
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-faint">
              <span>{lang === "tr" ? `${thread.length} soru` : `${thread.length} question${thread.length > 1 ? "s" : ""}`}</span>
              <button onClick={onClear} className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-text">
                {lang === "tr" ? "Akışı temizle" : "Clear thread"}
              </button>
            </div>
            {thread.map((a, i) => (
              <div key={a.id} ref={i === thread.length - 1 ? end : undefined} className="scroll-mt-28">
                <AnswerCard
                  a={a}
                  ds={ds}
                  model={model}
                  last={a.id === lastId}
                  onFollowUp={(q) => {
                    setFresh(false);
                    onAsk(q, false);
                  }}
                  onPin={onPin}
                  onOpenSql={onOpenSql}
                  onRemove={onRemove}
                />
              </div>
            ))}
          </>
        )}
      </div>
      <div className="sticky bottom-0 z-20 bg-gradient-to-t from-bg via-bg/95 to-bg/0 pt-6 pb-3 sm:pb-5">
        <div className="mx-auto w-full max-w-4xl px-3 sm:px-6">
          <AskBar
            model={model}
            big={!thread.length}
            autoFocus
            base={base}
            onClearBase={() => setFresh(true)}
            onAsk={(q) => {
              onAsk(q, fresh);
              setFresh(false);
            }}
          />
          <p className="mt-1.5 hidden text-center text-[11px] text-faint sm:block">{lang === "tr" ? "Sorular yalnızca veri okur · Tab tamamlar · / ile odaklanın" : "Questions only read data · Tab completes · press / to focus"}</p>
        </div>
      </div>
    </div>
  );
}
