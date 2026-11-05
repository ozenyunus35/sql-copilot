"use client";

import { Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef } from "react";
import { initials } from "@/lib/format";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        size === "sm" ? "h-7 px-2.5" : "h-8 px-3",
        variant === "primary" && "bg-accent text-accent-fg hover:bg-accent/90",
        variant === "secondary" && "border border-border bg-surface text-text shadow-card hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-text",
        variant === "danger" && "bg-danger text-white hover:bg-danger/90",
        className,
      )}
      {...props}
    />
  );
});

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-lg border border-border bg-surface shadow-card", className)} {...props} />;
}

/** Card header row: title on the left, optional meta or link on the right. */
export function CardHeader({ title, meta, icon: Icon }: { title: string; meta?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
      <h2 className="flex items-center gap-2 text-[13px] font-medium">
        {Icon && <Icon className="size-3.5 text-muted" aria-hidden />}
        {title}
      </h2>
      {meta && <div className="shrink-0 text-xs text-muted">{meta}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-faint",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
} as const;
export type Tone = keyof typeof TONES;

/** Quiet status label: a small coloured dot and plain text, no filled pill. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const label = typeof children === "string" && /^[a-z-]+$/.test(children) ? children[0].toUpperCase() + children.slice(1).replace("-", " ") : children;
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-md border border-border px-1.5 text-xs whitespace-nowrap text-muted">
      <span className={cx("size-1.5 rounded-full", TONES[tone])} aria-hidden />
      {label}
    </span>
  );
}

/** Neutral initials avatar; `square` for companies. */
export function Avatar({ name, size = 24, square = false }: { name: string; size?: number; square?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center border border-border-strong bg-surface-3 font-medium text-muted", square ? "rounded-md" : "rounded-full")}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)) }}
    >
      {initials(name)}
    </span>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => React.ReactNode }) {
  const id = useId();
  const msgId = error || hint ? `${id}-msg` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children(id, msgId)}
      {(error || hint) && (
        <p id={msgId} className={cx("text-xs", error ? "text-danger" : "text-faint")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] shadow-card transition-colors placeholder:text-faint hover:border-border-strong focus:border-accent focus:outline-none aria-[invalid=true]:border-danger";

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-xl border-0 bg-surface p-0 text-text shadow-pop", wide ? "max-w-6xl" : "max-w-md")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex h-12 items-center justify-between gap-4 border-b border-border px-4">
            <h2 id={titleId} className="truncate text-[13px] font-semibold">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text" aria-label="Close dialog">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: React.ComponentType<{ className?: string }>; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <Icon className="mb-3 size-6 text-faint" />
      <p className="font-medium">{title}</p>
      {text && <p className="mt-1 max-w-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Usage meter. `warn` turns it amber at 85% and red at 95% (for quotas, not for progress). */
export function Meter({ value, max, label, className, warn = true }: { value: number; max: number; label: string; className?: string; warn?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = warn && pct >= 95 ? "bg-danger" : warn && pct >= 85 ? "bg-warning" : "bg-accent";
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${Math.round(pct)}%`} className={cx("h-1 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div className={cx("h-full rounded-full transition-[width] duration-300", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-20 text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Thin trend line for metric tiles. Decorative: the number next to it carries the meaning. */
export function Sparkline({ data, className, color = "var(--accent)" }: { data: number[]; className?: string; color?: string }) {
  if (data.length < 2) return null;
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...data);
  const line = data.map((v, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cx("h-7 w-full overflow-visible", className)} aria-hidden>
      <path d={line} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Change versus the previous period, e.g. +12%. */
export function Delta({ current, previous, label = "vs previous 7 days" }: { current: number; previous: number; label?: string }) {
  const pct = previous === 0 ? (current === 0 ? 0 : 100) : Math.round(((current - previous) / previous) * 100);
  return (
    <span className="text-xs text-muted" title={label}>
      <span className={cx("font-medium tabular-nums", pct > 0 ? "text-success" : pct < 0 ? "text-danger" : "text-muted")}>
        {pct > 0 ? "+" : ""}
        {pct}%
      </span>{" "}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
