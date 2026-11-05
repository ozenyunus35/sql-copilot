import { distance, isEnglishInflection, isTurkishSuffix, numberWord, type Token } from "./text";

/** A date range the question asked for. Both ends are inclusive days; a missing end is open. */
export interface DateRange {
  from: string | null;
  to: string | null;
  label: string;
  labelTr: string;
  /** Token span [start, end) the range was read from. */
  start: number;
  end: number;
}

type Unit = "day" | "week" | "month" | "quarter" | "year";

const DAY = 86_400_000;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const ymd = (y: number, m: number, day: number) => iso(new Date(Date.UTC(y, m, day)));
const addDays = (s: string, n: number) => iso(new Date(d(s).getTime() + n * DAY));
function addMonths(s: string, n: number) {
  const x = d(s);
  const day = x.getUTCDate();
  const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return ymd(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last));
}

const MONTHS: Array<[string[], string]> = [
  [["january", "jan", "ocak"], "January"],
  [["february", "feb", "subat"], "February"],
  [["march", "mar", "mart"], "March"],
  [["april", "apr", "nisan"], "April"],
  [["may", "mayis"], "May"],
  [["june", "jun", "haziran"], "June"],
  [["july", "jul", "temmuz"], "July"],
  [["august", "aug", "agustos"], "August"],
  [["september", "sep", "sept", "eylul"], "September"],
  [["october", "oct", "ekim"], "October"],
  [["november", "nov", "kasim"], "November"],
  [["december", "dec", "aralik"], "December"],
];
const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const UNITS: Array<[Unit, string[], string[]]> = [
  ["day", ["day", "days"], ["gun"]],
  ["week", ["week", "weeks", "wk", "wks"], ["hafta"]],
  ["month", ["month", "months", "mo", "mos"], ["ay"]],
  ["quarter", ["quarter", "quarters", "qtr"], ["ceyrek"]],
  ["year", ["year", "years", "yr", "yrs"], ["yil", "sene"]],
];

/** Does the token read as one of these words, allowing English plurals and Turkish suffixes? */
function is(tok: Token | undefined, words: string[], turkish: string[] = []): boolean {
  if (!tok || tok.kind !== "word") return false;
  const t = tok.t;
  if (words.includes(t)) return true;
  for (const w of turkish) {
    if (t === w) return true;
    // Short stems ("ay", "yil") take a suffix only when the word is still short: "ayda", "yilinda".
    if (t.startsWith(w) && t.length <= w.length + 6 && isTurkishSuffix(t.slice(w.length))) return true;
    // The vowel of "yil" drops before a vowel: "yilda" is fine, "yili" too.
  }
  for (const w of words) if (w.length > 3 && isEnglishInflection(w, t)) return true;
  // One typo in a longer word: "quater", "moths", "yesterdy".
  if (t.length >= 5) for (const w of [...words, ...turkish]) if (w.length >= 5 && w[0] === t[0] && distance(w, t, 1) <= 1) return true;
  return false;
}

function unitAt(tok: Token | undefined): Unit | null {
  for (const [u, en, tr] of UNITS) if (is(tok, en, tr)) return u;
  return null;
}

function monthAt(tok: Token | undefined, strict: boolean): number | null {
  if (!tok || tok.kind !== "word") return null;
  for (let i = 0; i < MONTHS.length; i++) {
    const [names] = MONTHS[i];
    for (const n of names) {
      if (tok.t === n && (!strict || n.length > 3)) return i;
      if (n.length > 3 && tok.t.startsWith(n) && isTurkishSuffix(tok.t.slice(n.length))) return i;
      if (n.length >= 6 && tok.t.length >= 6 && n[0] === tok.t[0] && distance(n, tok.t, 1) <= 1) return i;
    }
  }
  return null;
}

function yearAt(tok: Token | undefined): number | null {
  if (!tok) return null;
  if (tok.kind === "number" && Number.isInteger(tok.n) && tok.n! >= 1990 && tok.n! <= 2100 && /^\d{4}$/.test(tok.raw.trim())) return tok.n!;
  if (tok.kind === "word" && /^(19|20)\d\d$/.test(tok.t)) return Number(tok.t);
  return null;
}

function countAt(tok: Token | undefined): number | null {
  if (!tok) return null;
  if (tok.kind === "number" && tok.n! > 0 && tok.n! <= 500 && Number.isInteger(tok.n)) return tok.n!;
  if (tok.kind === "word") return numberWord(tok.t);
  return null;
}

function startOf(unit: Unit, s: string): string {
  const x = d(s);
  const y = x.getUTCFullYear();
  const m = x.getUTCMonth();
  if (unit === "day") return s;
  if (unit === "week") return addDays(s, -((x.getUTCDay() + 6) % 7));
  if (unit === "month") return ymd(y, m, 1);
  if (unit === "quarter") return ymd(y, m - (m % 3), 1);
  return ymd(y, 0, 1);
}
function shift(unit: Unit, s: string, n: number): string {
  if (unit === "day") return addDays(s, n);
  if (unit === "week") return addDays(s, 7 * n);
  if (unit === "month") return addMonths(s, n);
  if (unit === "quarter") return addMonths(s, 3 * n);
  return addMonths(s, 12 * n);
}
const endOf = (unit: Unit, s: string) => addDays(shift(unit, startOf(unit, s), 1), -1);

const UNIT_TR: Record<Unit, string> = { day: "gün", week: "hafta", month: "ay", quarter: "çeyrek", year: "yıl" };

/** A point in time named in the question: a day, month, quarter or year. */
interface Point {
  from: string;
  to: string;
  label: string;
  labelTr: string;
  len: number;
}

function quarterOf(tok: Token | undefined): number | null {
  if (!tok || tok.kind !== "word") return null;
  const m = /^q([1-4])$/.exec(tok.t);
  return m ? Number(m[1]) : null;
}

/** Reads a point starting at token i. */
function pointAt(ts: Token[], i: number, today: string): Point | null {
  const tok = ts[i];
  if (!tok) return null;
  // 2025-03-14, 14.03.2025, 03/14/2025
  if (tok.kind === "date") {
    const iso1 = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(tok.t);
    const dm = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(tok.t);
    let y = 0, m = 0, day = 0;
    if (iso1) [y, m, day] = [Number(iso1[1]), Number(iso1[2]), Number(iso1[3])];
    else if (dm) {
      y = Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3]);
      // Dots are day.month (Europe, Turkey); slashes are month/day unless the first part can't be a month.
      const a = Number(dm[1]), b = Number(dm[2]);
      [day, m] = tok.t.includes(".") || a > 12 ? [a, b] : [b, a];
    }
    if (m < 1 || m > 12 || day < 1 || day > 31) return null;
    const s = ymd(y, m - 1, day);
    return { from: s, to: s, label: s, labelTr: s, len: 1 };
  }
  // Q3 2025 / 2025 Q3
  const q = quarterOf(tok);
  if (q) {
    const y = yearAt(ts[i + 1]);
    const year = y ?? latestYearFor(today, (q - 1) * 3);
    const from = ymd(year, (q - 1) * 3, 1);
    return { from, to: endOf("quarter", from), label: `Q${q} ${year}`, labelTr: `${year} ${q}. çeyrek`, len: y ? 2 : 1 };
  }
  const y = yearAt(tok);
  if (y) {
    // "2025 3. çeyrek", "2025 third quarter"
    const ordinal = ts[i + 1]?.kind === "number" && /^[1-4]$/.test(ts[i + 1].raw) ? ts[i + 1].n! : ({ first: 1, second: 2, third: 3, fourth: 4, ilk: 1 } as Record<string, number>)[ts[i + 1]?.t ?? ""];
    if (ordinal && is(ts[i + 2], ["quarter"], ["ceyrek", "ceyreg"])) {
      const from = ymd(y, (ordinal - 1) * 3, 1);
      return { from, to: endOf("quarter", from), label: `Q${ordinal} ${y}`, labelTr: `${y} ${ordinal}. çeyrek`, len: 3 };
    }
    const q2 = quarterOf(ts[i + 1]);
    if (q2) {
      const from = ymd(y, (q2 - 1) * 3, 1);
      return { from, to: endOf("quarter", from), label: `Q${q2} ${y}`, labelTr: `${y} ${q2}. çeyrek`, len: 2 };
    }
    const m2 = monthAt(ts[i + 1], false);
    if (m2 !== null) {
      const from = ymd(y, m2, 1);
      return { from, to: endOf("month", from), label: `${MONTHS[m2][1]} ${y}`, labelTr: `${MONTHS_TR[m2]} ${y}`, len: 2 };
    }
    return { from: ymd(y, 0, 1), to: ymd(y, 11, 31), label: String(y), labelTr: String(y), len: 1 };
  }
  // March 2025 / March (the latest March that has started)
  const m = monthAt(tok, !yearAt(ts[i + 1]) && ts[i - 1]?.t !== "in");
  if (m !== null) {
    const y2 = yearAt(ts[i + 1]);
    const year = y2 ?? latestYearFor(today, m);
    const from = ymd(year, m, 1);
    // "eylül ayında", "mart ayı": the month word that follows is part of it.
    const extra = is(ts[i + (y2 ? 2 : 1)], [], ["ay"]) ? 1 : 0;
    return { from, to: endOf("month", from), label: `${MONTHS[m][1]} ${year}`, labelTr: `${MONTHS_TR[m]} ${year}`, len: (y2 ? 2 : 1) + extra };
  }
  return null;
}

/** The latest year in which the month (0-11) has already started. */
function latestYearFor(today: string, month: number) {
  const t = d(today);
  return month <= t.getUTCMonth() ? t.getUTCFullYear() : t.getUTCFullYear() - 1;
}

const LAST = ["last", "past", "previous", "prior", "trailing", "recent", "son", "gecen", "onceki", "gectigimiz"];
const THIS = ["this", "current", "bu", "icinde", "bulundugumuz"];
const SINCE = ["since", "from", "after", "itibaren", "beri", "sonra", "sonrasi", "sonrasinda"];
const BEFORE = ["before", "until", "till", "prior", "once", "oncesi", "oncesinde", "kadar"];

/**
 * Finds the date ranges in a question. Understands English and Turkish:
 * "last 6 months", "son 6 ay", "last quarter", "geçen çeyrek", "this year", "2025", "March 2025",
 * "Q3", "between Jan and Mar 2025", "2024'ten beri", "before 2025", "year to date".
 */
export function findDateRanges(ts: Token[], today: string): DateRange[] {
  const out: DateRange[] = [];
  const used = new Set<number>();
  const push = (r: Omit<DateRange, "start" | "end">, start: number, end: number) => {
    for (let k = start; k < end; k++) used.add(k);
    out.push({ ...r, start, end });
  };

  for (let i = 0; i < ts.length; i++) {
    if (used.has(i)) continue;
    const t = ts[i];
    const next = ts[i + 1];

    // today / yesterday
    if (is(t, ["today"], ["bugun"]) && !is(next, [], ["kadar"])) {
      push({ from: today, to: today, label: "Today", labelTr: "Bugün" }, i, i + 1);
      continue;
    }
    if (is(t, ["yesterday"], ["dun"])) {
      const y = addDays(today, -1);
      push({ from: y, to: y, label: "Yesterday", labelTr: "Dün" }, i, i + 1);
      continue;
    }
    // year to date
    if ((t.t === "ytd") || (t.t === "year" && ts[i + 1]?.t === "to" && ts[i + 2]?.t === "date") || (is(t, [], ["yilbasi", "yilbasindan"]) && true)) {
      const len = t.t === "year" ? 3 : is(ts[i + 1], [], ["beri", "bugune", "itibaren"]) ? 2 : 1;
      push({ from: startOf("year", today), to: today, label: "Year to date", labelTr: "Yılbaşından bugüne" }, i, i + len);
      continue;
    }
    // last 6 months / son 6 ay / past two weeks / son bir yıl
    if (is(t, LAST) || (t.t === "the" && is(next, LAST))) {
      const k = t.t === "the" ? i + 1 : i;
      const n = countAt(ts[k + 1]);
      const unit = n !== null ? unitAt(ts[k + 2]) : null;
      if (n !== null && unit) {
        const from = addDays(shift(unit, today, -n), 1);
        push({ from, to: today, label: `Last ${n} ${unit}${n === 1 ? "" : "s"}`, labelTr: `Son ${n} ${UNIT_TR[unit]}` }, i, k + 3);
        continue;
      }
      const u = unitAt(ts[k + 1]);
      if (u) {
        // "son ay" / "past month": the rolling period; "last month" / "geçen ay": the previous calendar one.
        const rolling = ["son", "past", "trailing", "recent"].includes(ts[k].t);
        if (rolling) {
          const from = addDays(shift(u, today, -1), 1);
          push({ from, to: today, label: `Past ${u}`, labelTr: `Son 1 ${UNIT_TR[u]}` }, i, k + 2);
        } else {
          const from = startOf(u, shift(u, today, -1));
          push({ from, to: endOf(u, from), label: `Last ${u}`, labelTr: `Geçen ${UNIT_TR[u]}` }, i, k + 2);
        }
        continue;
      }
    }
    // this month / bu yıl / current quarter
    if (is(t, THIS)) {
      const u = unitAt(next);
      if (u) {
        push({ from: startOf(u, today), to: today, label: `This ${u}`, labelTr: `Bu ${UNIT_TR[u]}` }, i, i + 2);
        continue;
      }
    }
    // between X and Y / from X to Y / X ile Y arasında / X - Y
    if (is(t, ["between", "from"])) {
      const a = pointAt(ts, i + 1, today);
      if (a) {
        const j = i + 1 + a.len;
        if (["and", "to", "till", "until", "-", "through", "thru"].includes(ts[j]?.t ?? "")) {
          const b = pointAt(ts, j + 1, today);
          if (b) {
            const [x, y] = a.from <= b.from ? [a, b] : [b, a];
            push({ from: x.from, to: y.to, label: `${x.label} to ${y.label}`, labelTr: `${x.labelTr} - ${y.labelTr}` }, i, j + 1 + b.len);
            continue;
          }
        }
      }
    }
    // "third quarter of 2025", "Q3 of 2025", "2025'in 3. çeyreği", "2025 3. çeyrekte", "3. çeyrek"
    const ORD: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, ilk: 1 };
    const qn = ORD[t.t] ?? (t.kind === "number" && /^[1-4]$/.test(t.raw) && is(ts[i + 1], ["quarter"], ["ceyrek", "ceyreg"]) ? t.n! : null);
    if (qn) {
      let j = i + 1;
      if (ts[j]?.t === ".") j++;
      if (is(ts[j], ["quarter"], ["ceyrek", "ceyreg"])) {
        j++;
        if (ts[j]?.t === "of" || ts[j]?.t === "in") j++;
        const y = yearAt(ts[j]);
        // "2025'in 3. çeyreği": the year comes first.
        const yb = yearAt(ts[i - 1]);
        const year = y ?? yb ?? latestYearFor(today, (qn - 1) * 3);
        const from = ymd(year, (qn - 1) * 3, 1);
        push({ from, to: endOf("quarter", from), label: `Q${qn} ${year}`, labelTr: `${year} ${qn}. çeyrek` }, yb && !y && !used.has(i - 1) ? i - 1 : i, y ? j + 1 : j);
        continue;
      }
    }
    const p = pointAt(ts, i, today);
    if (p) {
      const j = i + p.len;
      // X ile Y arasında / X ve Y arasında / X - Y
      if (["ile", "ve", "-", "to", "and"].includes(ts[j]?.t ?? "")) {
        const b = pointAt(ts, j + 1, today);
        if (b && (ts[j].t === "-" || ts[j].t === "to" || is(ts[j + 1 + b.len], [], ["arasinda", "arasi", "arasindaki"]) || ts[j].t === "and" && is(ts[i - 1], ["between"]))) {
          const [x, y] = p.from <= b.from ? [p, b] : [b, p];
          const end = j + 1 + b.len + (is(ts[j + 1 + b.len], [], ["arasinda", "arasi", "arasindaki"]) ? 1 : 0);
          push({ from: x.from, to: y.to, label: `${x.label} to ${y.label}`, labelTr: `${x.labelTr} - ${y.labelTr}` }, i, end);
          continue;
        }
      }
      // since X / X'ten beri / after X
      const before = ts[i - 1];
      const after = ts[j];
      const suffix = ts[j - 1].suffix;
      const sinceTr = is(after, SINCE.slice(3)) || /^(ten|tan|den|dan)$/.test(suffix) && is(after, ["beri", "itibaren", "sonra", "sonrasi"]);
      if ((is(before, SINCE.slice(0, 3)) && !used.has(i - 1)) || sinceTr) {
        const isAfter = before?.t === "after" || is(after, ["sonra", "sonrasi", "sonrasinda"]);
        const from = isAfter ? addDays(p.to, 1) : p.from;
        const start = is(before, SINCE.slice(0, 3)) ? i - 1 : i;
        push({ from, to: today, label: `${isAfter ? "After" : "Since"} ${p.label}`, labelTr: `${p.labelTr} ${isAfter ? "sonrası" : "itibarıyla"}` }, start, sinceTr ? j + 1 : j);
        continue;
      }
      // before X / until X / X öncesi / X'e kadar
      if ((is(before, BEFORE.slice(0, 4)) && !used.has(i - 1)) || is(after, ["once", "oncesi", "oncesinde", "kadar"])) {
        const until = before?.t === "until" || before?.t === "till" || after?.t === "kadar";
        const start = is(before, BEFORE.slice(0, 4)) ? i - 1 : i;
        push({ from: null, to: until ? p.to : addDays(p.from, -1), label: `${until ? "Until" : "Before"} ${p.label}`, labelTr: `${p.labelTr} ${until ? "sonuna kadar" : "öncesi"}` }, start, is(after, ["once", "oncesi", "oncesinde", "kadar"]) ? j + 1 : j);
        continue;
      }
      push({ from: p.from, to: p.to, label: p.label, labelTr: p.labelTr }, is(before, ["in", "during", "for", "on"]) && !used.has(i - 1) ? i - 1 : i, j);
      continue;
    }
  }
  return out;
}

/** Days between two ISO dates, inclusive. */
export const daysIn = (r: DateRange) => (r.from && r.to ? Math.round((d(r.to).getTime() - d(r.from).getTime()) / DAY) + 1 : null);
