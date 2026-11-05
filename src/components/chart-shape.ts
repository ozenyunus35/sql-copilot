import type { QueryResult } from "@/lib/db";
import type { ColumnFormat } from "@/lib/present";

// Chart decisions that don't need the chart library, so they can load before it.

export type ChartKind = "auto" | "bar" | "hbar" | "line" | "area" | "pie";

export interface Shape {
  x: number;
  /** One series per numeric column, or per value of a second label column (pivot). */
  series: Array<{ key: string; label: string }>;
  data: Array<Record<string, string | number>>;
  time: boolean;
  format: ColumnFormat;
  pivot: boolean;
  open?: boolean;
}

/** Works out what can be charted: a label column and numbers, or two labels and one number (pivot). */
export function chartShape(r: QueryResult, formats: ColumnFormat[]): Shape | null {
  if (r.rows.length < 1 || r.rows.length > 1000) return null;
  const labels = formats.map((f, j) => (["text", "period", "date"].includes(f) ? j : -1)).filter((j) => j >= 0);
  const nums = formats.map((f, j) => (["money", "number", "integer", "days", "percent"].includes(f) && !["share_pct", "change_pct"].includes(r.columns[j]) ? j : -1)).filter((j) => j >= 0);
  if (!labels.length || !nums.length) return null;
  // Time first on the x axis when there is one.
  const x = labels.find((j) => formats[j] === "period" || formats[j] === "date") ?? labels[0];
  const time = formats[x] === "period" || formats[x] === "date";
  const other = labels.find((j) => j !== x);
  if (other !== undefined && nums.length === 1) {
    const y = nums[0];
    const keys = [...new Set(r.rows.map((row) => String(row[other] ?? "—")))];
    if (keys.length <= 12) {
      const byX = new Map<string, Record<string, string | number>>();
      for (const row of r.rows) {
        const xv = String(row[x] ?? "—");
        const rec = byX.get(xv) ?? { x: xv };
        rec[String(row[other] ?? "—")] = Number(row[y]) || 0;
        byX.set(xv, rec);
      }
      return { x, series: keys.map((k) => ({ key: k, label: k })), data: [...byX.values()], time, format: formats[y], pivot: true };
    }
  }
  const same = nums.filter((j) => formats[j] === formats[nums[0]]).slice(0, 4);
  const data = r.rows.map((row) => ({ x: String(row[x] ?? "—"), ...Object.fromEntries(same.map((j) => [r.columns[j], Number(row[j]) || 0])) }));
  return { x, series: same.map((j) => ({ key: r.columns[j], label: seriesLabel(r.columns[j], false) })), data, time, format: formats[same[0]], pivot: false };
}

/** The chart drawn when the user hasn't picked one. */
export function autoKind(s: Shape): Exclude<ChartKind, "auto"> {
  if (s.time) return s.data.length <= 4 ? "bar" : s.pivot ? "line" : "area";
  const longest = Math.max(...s.data.map((d) => String(d.x).length));
  return longest > 8 || s.data.length > 8 ? "hbar" : "bar";
}

/** "days_to_pay" → "Days to pay"; values of a pivot column are kept as they are. */
export function seriesLabel(key: string, pivot: boolean) {
  if (pivot) return key;
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Short axis numbers: $1.2M, 45k; in Turkish $1,2 Mn, 45 B. */
export function axisFormat(v: number, f: ColumnFormat, locale = "en-US") {
  const tr = locale === "tr-TR";
  const abs = Math.abs(v);
  const num = (x: number, d: number) => x.toLocaleString(locale, { maximumFractionDigits: d });
  const n = abs >= 1e6 ? `${num(v / 1e6, abs >= 1e7 ? 0 : 1)}${tr ? " Mn" : "M"}` : abs >= 1e3 ? `${num(v / 1e3, abs >= 1e4 ? 0 : 1)}${tr ? " B" : "k"}` : num(Math.round(v * 10) / 10, 1);
  return f === "money" ? `$${n}` : f === "percent" ? (tr ? `%${n}` : `${n}%`) : n;
}

/** Saves the chart inside `root` as a PNG, with theme colours resolved so it looks the same outside the app. */
export async function chartPng(root: HTMLElement, name: string) {
  const svg = root.querySelector("[data-chart] svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return false;
  const css = getComputedStyle(document.documentElement);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 320;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  let text = new XMLSerializer().serializeToString(clone);
  text = text.replace(/var\((--[\w-]+)\)/g, (_, v: string) => css.getPropertyValue(v).trim() || "#888");
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  await new Promise((ok, fail) => {
    img.onload = ok;
    img.onerror = fail;
    img.src = url;
  });
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css.getPropertyValue("--surface").trim() || "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = name;
  a.click();
  return true;
}
