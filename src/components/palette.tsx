"use client";

import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { fold } from "@/lib/nl/text";
import { cx } from "./ui";

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
  run: () => void;
}

/** ⌘K: jump anywhere, run an action, or ask what you typed. */
export function Palette({ open, onClose, commands, onAsk }: { open: boolean; onClose: () => void; commands: Command[]; onAsk: (q: string) => void }) {
  const { lang } = useLang();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ("");
      setI(0);
      requestAnimationFrame(() => input.current?.focus());
    }
    if (!open && d.open) d.close();
  }, [open]);
  const list = useMemo(() => {
    const f = fold(q.trim());
    const hits = f ? commands.filter((c) => fold(c.label).includes(f) || fold(c.group).includes(f)) : commands;
    const ask: Command[] = q.trim() ? [{ id: "ask", label: q.trim(), group: lang === "tr" ? "Sor" : "Ask", icon: ArrowRight, run: () => onAsk(q.trim()) }] : [];
    return [...ask, ...hits].slice(0, 40);
  }, [q, commands, onAsk, lang]);
  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  let lastGroup = "";
  return (
    <dialog ref={dialog} onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()} aria-label={lang === "tr" ? "Komut paleti" : "Command palette"} className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-xl border-0 bg-surface p-0 text-text shadow-pop">
      {open && (
        <div>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-faint" />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setI(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setI((x) => Math.min(list.length - 1, x + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setI((x) => Math.max(0, x - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  pick(list[i]);
                }
              }}
              placeholder={lang === "tr" ? "Soru yazın, sayfaya gidin ya da bir işlem seçin…" : "Type a question, jump to a page or run an action…"}
              className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
              aria-label={lang === "tr" ? "Komut ara" : "Search commands"}
            />
            <kbd className="rounded border border-border px-1.5 text-[10.5px] text-faint">esc</kbd>
          </div>
          <ul className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5" role="listbox">
            {list.map((c, k) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <li key={c.id + k} role="option" aria-selected={k === i}>
                  {header && <p className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">{header}</p>}
                  <button onMouseEnter={() => setI(k)} onClick={() => pick(c)} className={cx("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left", k === i ? "bg-accent-soft text-text" : "text-text")}>
                    {c.icon && <c.icon className="size-3.5 shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="text-[11px] text-faint">{c.hint}</span>}
                    {k === i && <CornerDownLeft className="size-3.5 text-faint" />}
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="px-3 py-6 text-center text-muted">{lang === "tr" ? "Sonuç yok" : "No results"}</li>}
          </ul>
        </div>
      )}
    </dialog>
  );
}
