"use client";

import { lazy, Suspense, type ComponentProps } from "react";

// Recharts is the biggest piece of the app; it loads the first time a chart is shown.
const load = () => import("./viz");
const Inner = lazy(() => load().then((m) => ({ default: m.Viz })));
type Props = ComponentProps<typeof Inner>;

/** Starts fetching the chart code without drawing anything. */
export const preloadViz = () => void load();

export function Viz(props: Props) {
  return (
    <Suspense fallback={<div className="m-3 animate-pulse rounded-lg bg-surface-2/60" style={{ height: (props.height ?? 280) - 24 }} aria-hidden />}>
      <Inner {...props} />
    </Suspense>
  );
}
