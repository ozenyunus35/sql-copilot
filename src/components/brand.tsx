import { cx } from "./ui";

/** Quarry's mark: a cut stone with a query cursor. */
export function QuarryMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-md bg-text text-bg", className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" style={{ width: size * 0.66, height: size * 0.66 }} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9.5 9 4.5h6l5 5v5l-5 5H9l-5-5z" />
        <path d="m13.5 13.5 3.5 3.5" />
        <circle cx="11" cy="11" r="2.6" />
      </svg>
    </span>
  );
}
