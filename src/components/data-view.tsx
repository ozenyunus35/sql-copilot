"use client";

import { BookOpen, Calculator, GraduationCap, Network, Table2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Dataset } from "@/lib/engine";
import { useLang } from "@/lib/i18n";
import type { Model } from "@/lib/model";
import { aliases } from "@/lib/nl/sql";
import { wordTargets, type Word } from "@/lib/workspace";
import { SqlEditor } from "./editor";
import { SchemaMap } from "./schema-map";
import { Badge, Button, Card, inputClass, cx } from "./ui";

type Section = "tables" | "measures" | "map" | "words";

const ROLE_LABEL: Record<string, [string, string]> = {
  id: ["key", "anahtar"],
  fk: ["link", "bağlantı"],
  name: ["name", "ad"],
  code: ["code", "kod"],
  category: ["category", "kategori"],
  money: ["money", "para"],
  quantity: ["quantity", "adet"],
  percent: ["percent", "yüzde"],
  number: ["number", "sayı"],
  date: ["date", "tarih"],
  text: ["text", "metin"],
  email: ["email", "e-posta"],
  flag: ["yes/no", "evet/hayır"],
};

export function DataView({ ds, model, words, setWords, onAsk }: { ds: Dataset; model: Model; words: Word[]; setWords: (w: Word[]) => void; onAsk: (q: string) => void }) {
  const { lang } = useLang();
  const tr = lang === "tr";
  const [section, setSection] = useState<Section>("tables");
  const [table, setTable] = useState(model.tables[0]?.name);
  const [phrase, setPhrase] = useState("");
  const [target, setTarget] = useState("");
  const targets = useMemo(() => wordTargets(model, lang), [model, lang]);
  const A = useMemo(() => aliases(model), [model]);
  const t = model.tables.find((x) => x.name === table) ?? model.tables[0];
  const nav: Array<{ id: Section; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "tables", label: tr ? "Tablolar" : "Tables", icon: Table2 },
    { id: "measures", label: tr ? "Ölçüler" : "Measures", icon: Calculator },
    { id: "map", label: tr ? "İlişkiler" : "Relations", icon: Network },
    { id: "words", label: tr ? "Öğretilen kelimeler" : "Taught words", icon: GraduationCap },
  ];
  const groups = [...new Set(targets.map((x) => x.group))];

  return (
    <div className="mx-auto w-full max-w-[1280px] px-3 py-5 sm:px-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tr ? "Veri sözlüğü" : "Data dictionary"}</h1>
        <p className="mt-0.5 max-w-3xl text-muted">
          {tr
            ? "Quarry'nin soruları anlamak için kullandığı model: her tablo ve sütunun anlamı, iki dilde karşılıkları, iş ölçülerinin SQL tanımları ve tabloların birbirine bağlanışı. Kendi kelimelerinizi de öğretebilirsiniz."
            : "The model Quarry reads questions with: what each table and column means, the words for them in English and Turkish, the exact SQL behind each business measure, and how tables connect. You can teach it your own words too."}
        </p>
      </div>
      <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto" role="tablist">
        {nav.map((n) => (
          <button key={n.id} role="tab" aria-selected={section === n.id} onClick={() => setSection(n.id)} className={cx("flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium", section === n.id ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text")}>
            <n.icon className="size-3.5" /> {n.label}
            {n.id === "words" && words.length > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-[10.5px] text-accent">{words.length}</span>}
          </button>
        ))}
      </div>

      {section === "tables" && (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {model.tables.map((x) => (
              <li key={x.name} className="shrink-0">
                <button onClick={() => setTable(x.name)} aria-current={x.name === t.name} className={cx("flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left", x.name === t.name ? "bg-accent-soft text-text" : "text-muted hover:bg-surface-2 hover:text-text")}>
                  <span className="font-mono text-[12.5px]">{x.name}</span>
                  <span className="text-[11px] text-faint tabular-nums">{x.rows.toLocaleString(tr ? "tr-TR" : "en-US")}</span>
                </button>
              </li>
            ))}
          </ul>
          <Card className="min-w-0 overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[14px] font-semibold">{t.name}</span>
                <span className="text-muted">{tr ? `${t.labelTr} · ${t.rows.toLocaleString("tr-TR")} satır` : `one row per ${t.label} · ${t.rows.toLocaleString("en-US")} rows`}</span>
              </p>
              <p className="mt-1 text-xs text-faint">
                {tr ? "Bu kelimelerle anılır: " : "Called: "}
                {t.terms.slice(0, 14).join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => onAsk(tr ? `kaç ${t.labelTr} var` : `how many ${t.plural}`)}>
                  {tr ? `Kaç ${t.labelTr} var?` : `How many ${t.plural}?`}
                </Button>
                {t.dateColumn && (
                  <Button size="sm" variant="ghost" onClick={() => onAsk(tr ? `aylık ${t.labelTr} sayısı` : `${t.plural} per month`)}>
                    {tr ? "Aylık sayı" : "Per month"}
                  </Button>
                )}
              </div>
            </div>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">{tr ? "Sütun" : "Column"}</th>
                    <th className="px-3 py-2 font-medium">{tr ? "Anlamı" : "Meaning"}</th>
                    <th className="px-3 py-2 font-medium">{tr ? "Rol" : "Role"}</th>
                    <th className="px-3 py-2 font-medium">{tr ? "Kelimeler ve değerler" : "Words and values"}</th>
                  </tr>
                </thead>
                <tbody>
                  {t.columns.map((c) => (
                    <tr key={c.name} className="border-b border-border/60 align-top">
                      <td className="px-4 py-2 font-mono whitespace-nowrap">
                        {c.name}
                        <span className="ml-1.5 text-[10.5px] text-faint">{c.type}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{tr ? c.labelTr : c.label}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge tone={c.role === "id" || c.role === "fk" ? "accent" : c.role === "money" ? "success" : c.role === "date" ? "info" : "neutral"}>{ROLE_LABEL[c.role]?.[tr ? 1 : 0] ?? c.role}</Badge>
                        {c.ref && <span className="ml-1.5 text-[11px] text-faint">→ {c.ref.table}.{c.ref.column}</span>}
                      </td>
                      <td className="max-w-[420px] px-3 py-2 text-muted">
                        <span className="line-clamp-2">{c.terms.slice(0, 8).join(", ")}</span>
                        {c.values && c.values.length > 0 && c.role === "category" && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {c.values.slice(0, 10).map((v) => (
                              <button key={v} onClick={() => onAsk(tr ? `${v} için kaç ${t.labelTr}` : `how many ${t.plural} with ${c.name} ${v}`)} className="rounded border border-border px-1.5 text-[11px] text-text hover:border-accent hover:text-accent">
                                {v}
                              </button>
                            ))}
                            {c.values.length > 10 && <span className="text-[11px] text-faint">+{c.values.length - 10}</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {section === "measures" && (
        <div className="grid gap-3 md:grid-cols-2">
          {model.metrics.map((m) => {
            const sql = m.sql.replace(/\{([a-z_0-9]+)\}/gi, (_, x: string) => A[x] ?? x);
            const where = m.where?.replace(/\{([a-z_0-9]+)\}/gi, (_, x: string) => A[x] ?? x);
            return (
              <Card key={m.id} className="flex min-w-0 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{tr ? m.labelTr : m.label}</p>
                    <p className="text-xs text-muted">{tr ? m.noteTr : m.note}</p>
                  </div>
                  <Badge tone="accent">{m.unit}</Badge>
                </div>
                <div className="mt-3">
                  <SqlEditor value={`${sql}${where ? `\n-- ${tr ? "her zaman" : "always"}: WHERE ${where}` : ""}${m.date ? `\n-- ${tr ? "tarih" : "dates"}: ${m.date}` : ""}`} onChange={() => {}} onRun={() => {}} label={m.label} readOnly minRows={1} />
                </div>
                <p className="mt-2 line-clamp-2 text-[11.5px] text-faint">
                  {tr ? "Kelimeler: " : "Words: "}
                  {m.terms.slice(0, 12).join(", ")}
                </p>
                <div className="mt-auto pt-2">
                  <button className="text-xs font-medium text-accent hover:underline" onClick={() => onAsk(tr ? `bu yıl aylık ${m.labelTr.toLocaleLowerCase("tr")}` : `monthly ${m.label.toLowerCase()} this year`)}>
                    {tr ? "Aylık göster →" : "Show monthly →"}
                  </button>
                </div>
              </Card>
            );
          })}
          {!model.metrics.length && <p className="text-muted">{tr ? "Bu veri setinde ölçü yok." : "No measures in this dataset."}</p>}
        </div>
      )}

      {section === "map" && <SchemaMap model={model} />}

      {section === "words" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="p-4">
            <p className="flex items-center gap-2 font-medium">
              <BookOpen className="size-4 text-accent" /> {tr ? "Quarry'ye bir kelime öğretin" : "Teach Quarry a word"}
            </p>
            <p className="mt-1 text-muted">{tr ? "Ekibinizin kullandığı terimleri tanıtın: “ciro” yerine “top line”, “kurumsal” yerine “enterprise”. Kelimeler bu tarayıcıda, bu veri seti için saklanır." : "Add the terms your team uses: “top line” for revenue, “enterprise” for the Corporate segment. Words are kept in this browser, for this dataset."}</p>
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!phrase.trim() || !target) return;
                setWords([...words.filter((w) => w.phrase.toLowerCase() !== phrase.trim().toLowerCase()), { phrase: phrase.trim(), target }]);
                setPhrase("");
              }}
            >
              <label className="block text-xs font-medium text-muted" htmlFor="teach-phrase">
                {tr ? "Şunu dediğimde" : "When I say"}
              </label>
              <input id="teach-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={60} className={inputClass} placeholder={tr ? "örn. büyük hesaplar" : "e.g. enterprise"} />
              <label className="block text-xs font-medium text-muted" htmlFor="teach-target">
                {tr ? "Şunu kastediyorum" : "I mean"}
              </label>
              <select id="teach-target" value={target} onChange={(e) => setTarget(e.target.value)} className={cx(inputClass, "pr-2")}>
                <option value="">{tr ? "Seçin…" : "Choose…"}</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {targets
                      .filter((x) => x.group === g)
                      .map((x) => (
                        <option key={x.target} value={x.target}>
                          {x.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <Button type="submit" variant="primary" disabled={!phrase.trim() || !target}>
                {tr ? "Öğret" : "Teach"}
              </Button>
            </form>
          </Card>
          <Card className="p-4">
            <p className="font-medium">{tr ? "Öğretilen kelimeler" : "Taught words"}</p>
            {words.length ? (
              <ul className="mt-2 divide-y divide-border">
                {words.map((w) => (
                  <li key={w.phrase} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">“{w.phrase}”</span> <span className="text-muted">→ {targets.find((x) => x.target === w.target)?.label ?? w.target}</span>
                    </span>
                    <button onClick={() => onAsk(w.phrase)} className="text-xs text-accent hover:underline">
                      {tr ? "Dene" : "Try"}
                    </button>
                    <button onClick={() => setWords(words.filter((x) => x !== w))} className="rounded p-1 text-faint hover:text-danger" aria-label={`${tr ? "Kaldır" : "Remove"} ${w.phrase}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted">{tr ? "Henüz kelime yok." : "No words yet."}</p>
            )}
            <p className="mt-3 text-xs text-faint">{ds.kind === "demo" ? (tr ? "Örnek: “enterprise” → segment = Corporate, sonra “revenue from enterprise customers” diye sorun." : "Example: “enterprise” → segment = Corporate, then ask “revenue from enterprise customers”.") : ""}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
