"use client";

import { useEffect, useMemo, useRef } from "react";
import { tokenizeSql } from "@/lib/sql/tokens";

const FUNCS = new Set(["sum", "avg", "count", "min", "max", "round", "coalesce", "ifnull", "nullif", "strftime", "date", "datetime", "julianday", "lower", "upper", "length", "substr", "abs", "cast", "lag", "lead", "row_number", "rank", "dense_rank", "total", "group_concat", "replace", "trim", "instr", "printf", "iif"]);

/** SQL as highlighted HTML-free React nodes. */
function highlight(sql: string) {
  const toks = tokenizeSql(sql);
  const out: React.ReactNode[] = [];
  let at = 0;
  toks.forEach((t, i) => {
    if (t.start > at) out.push(sql.slice(at, t.start));
    const cls = t.kind === "kw" ? "sql-kw" : t.kind === "string" ? "sql-str" : t.kind === "number" ? "sql-num" : t.kind === "comment" ? "sql-com" : t.kind === "ident" && FUNCS.has(t.v) && toks[i + 1]?.text === "(" ? "sql-fn" : null;
    out.push(cls ? (
      <span key={i} className={cls}>
        {t.text}
      </span>
    ) : (
      t.text
    ));
    at = t.end;
  });
  if (at < sql.length) out.push(sql.slice(at));
  // A trailing newline needs a character after it, or the last line collapses.
  out.push("\n");
  return out;
}

export function SqlEditor({ value, onChange, onRun, label }: { value: string; onChange: (v: string) => void; onRun: () => void; label: string }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const nodes = useMemo(() => highlight(value), [value]);
  const lines = Math.max(4, value.split("\n").length);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(460, Math.max(108, el.scrollHeight))}px`;
  }, [value]);

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-surface-2/50 focus-within:border-accent">
      <pre ref={pre} aria-hidden className="editor-layer pointer-events-none absolute inset-0 m-0 overflow-hidden text-text">
        {nodes}
      </pre>
      <textarea
        ref={ta}
        value={value}
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={lines}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (pre.current) pre.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onRun();
          } else if (e.key === "Tab" && !e.shiftKey) {
            // Two spaces instead of leaving the editor; Escape then Tab moves on.
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: en } = el;
            const next = value.slice(0, s) + "  " + value.slice(en);
            onChange(next);
            requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
          } else if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="editor-layer relative block w-full resize-none overflow-auto bg-transparent text-transparent caret-[var(--text)] outline-none selection:bg-accent/20"
      />
    </div>
  );
}
