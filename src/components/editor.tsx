"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { suggestSql, type Suggestion } from "@/lib/complete";
import type { Model } from "@/lib/model";
import { tokenizeSql } from "@/lib/sql/tokens";
import { cx } from "./ui";

const FUNCS = new Set(["sum", "avg", "count", "min", "max", "round", "coalesce", "ifnull", "nullif", "strftime", "date", "datetime", "julianday", "lower", "upper", "length", "substr", "abs", "cast", "lag", "lead", "row_number", "rank", "dense_rank", "total", "group_concat", "replace", "trim", "instr", "printf", "iif"]);

/** SQL as highlighted React nodes (no HTML strings). */
function highlight(sql: string) {
  const toks = tokenizeSql(sql);
  const out: React.ReactNode[] = [];
  let at = 0;
  toks.forEach((t, i) => {
    if (t.start > at) out.push(sql.slice(at, t.start));
    const cls = t.kind === "kw" ? "sql-kw" : t.kind === "string" ? "sql-str" : t.kind === "number" ? "sql-num" : t.kind === "comment" ? "sql-com" : t.kind === "ident" && FUNCS.has(t.v) && toks[i + 1]?.text === "(" ? "sql-fn" : null;
    out.push(
      cls ? (
        <span key={i} className={cls}>
          {t.text}
        </span>
      ) : (
        t.text
      ),
    );
    at = t.end;
  });
  if (at < sql.length) out.push(sql.slice(at));
  // A trailing newline needs a character after it, or the last line collapses.
  out.push("\n");
  return out;
}

const KIND_TONE: Record<Suggestion["kind"], string> = { table: "text-accent", column: "text-info", keyword: "text-faint", function: "text-warning", measure: "text-accent", value: "text-success", date: "text-muted" };

/** Pixel position of the caret inside a textarea, measured with a mirror element. */
function caretXY(el: HTMLTextAreaElement, pos: number) {
  const mirror = document.createElement("div");
  const cs = getComputedStyle(el);
  for (const p of ["fontFamily", "fontSize", "lineHeight", "padding", "border", "letterSpacing", "whiteSpace", "overflowWrap", "tabSize", "boxSizing", "width"] as const) mirror.style[p] = cs[p];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.textContent = el.value.slice(0, pos);
  const mark = document.createElement("span");
  mark.textContent = "​";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const x = mark.offsetLeft;
  const y = mark.offsetTop - el.scrollTop;
  document.body.removeChild(mirror);
  return { x, y };
}

export function SqlEditor({ value, onChange, onRun, label, readOnly, model, minRows = 4 }: { value: string; onChange: (v: string) => void; onRun: () => void; label: string; readOnly?: boolean; model?: Model; minRows?: number }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const nodes = useMemo(() => highlight(value), [value]);
  const [menu, setMenu] = useState<{ items: Suggestion[]; start: number; x: number; y: number; i: number } | null>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(520, Math.max(minRows * 20 + 24, el.scrollHeight))}px`;
  }, [value, minRows]);

  // A value set from outside (Format, a new tab) closes any open suggestions.
  useEffect(() => {
    if (document.activeElement !== ta.current) setMenu(null);
  }, [value]);

  const refresh = (el: HTMLTextAreaElement) => {
    if (!model || readOnly) return;
    const pos = el.selectionStart;
    if (pos !== el.selectionEnd || !/[\w.]$/.test(el.value.slice(0, pos))) return setMenu(null);
    const s = suggestSql(el.value, pos, model);
    if (!s.items.length) return setMenu(null);
    const { x, y } = caretXY(el, pos);
    setMenu({ items: s.items, start: s.start, x: Math.min(x, el.clientWidth - 240), y: y + 22, i: 0 });
  };

  const accept = (s: Suggestion) => {
    const el = ta.current;
    if (!el || !menu) return;
    const pos = el.selectionStart;
    const next = value.slice(0, menu.start) + s.text + value.slice(pos);
    onChange(next);
    setMenu(null);
    const caret = menu.start + s.text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className={cx("relative rounded-lg border border-border bg-surface-2/50", !readOnly && "focus-within:border-accent")}>
      <div className="relative overflow-hidden rounded-lg">
        <pre ref={pre} aria-hidden className="editor-layer pointer-events-none absolute inset-0 m-0 overflow-hidden text-text">
          {nodes}
        </pre>
        <textarea
          ref={ta}
          value={value}
          aria-label={label}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-autocomplete={model ? "list" : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            refresh(e.target);
          }}
          onBlur={() => setTimeout(() => document.activeElement !== ta.current && setMenu(null), 120)}
          onClick={() => setMenu(null)}
          onScroll={(e) => {
            if (pre.current) pre.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            if (menu && !e.metaKey && !e.ctrlKey && !e.altKey) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setMenu({ ...menu, i: (menu.i + d + menu.items.length) % menu.items.length });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                accept(menu.items[menu.i]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(null);
                return;
              }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onRun();
            } else if (e.key === "Tab" && !e.shiftKey && !readOnly) {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: s, selectionEnd: en } = el;
              onChange(value.slice(0, s) + "  " + value.slice(en));
              requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
            } else if (e.key === "Escape") e.currentTarget.blur();
          }}
          className={cx("editor-layer relative block w-full resize-none overflow-auto bg-transparent text-transparent caret-[var(--text)] outline-none selection:bg-accent/20", readOnly && "cursor-text")}
        />
      </div>
      {menu && (
        <ul role="listbox" aria-label="Suggestions" className="absolute z-30 w-60 animate-pop overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop" style={{ left: Math.max(8, menu.x), top: menu.y }}>
          {menu.items.map((s, i) => (
            <li key={`${s.kind}${s.text}`} role="option" aria-selected={i === menu.i}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                className={cx("flex w-full items-center gap-2 px-2.5 py-1 text-left", i === menu.i ? "bg-accent-soft" : "hover:bg-surface-2")}
              >
                <span className={cx("w-14 shrink-0 text-[10.5px] font-medium uppercase", KIND_TONE[s.kind])}>{s.kind}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{s.label}</span>
                {s.detail && <span className="shrink-0 truncate text-[10.5px] text-faint">{s.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
