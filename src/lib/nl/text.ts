/**
 * Text helpers for the question parser: folding (case, Turkish letters, accents), tokens,
 * Turkish suffixes, typo distance, numbers and language detection.
 */

/** Lower case without Turkish letters or accents: "İSTANBUL'daki Ödemeler" -> "istanbul'daki odemeler". */
export function fold(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»]/g, '"');
}

export interface Token {
  /** The folded text, without a trailing Turkish suffix after an apostrophe. */
  t: string;
  /** What followed an apostrophe, e.g. "daki" in "almanya'daki". */
  suffix: string;
  /** The words as typed. */
  raw: string;
  kind: "word" | "number" | "quoted" | "symbol" | "date";
  /** Parsed value for numbers. */
  n?: number;
  start: number;
  end: number;
}

const NUMBER = /^(?:[$€£₺]\s?)?\d+(?:[.,]\d{3})*(?:[.,]\d+)?(?:\s?[kmb])?(?:\s?[$€£₺%])?$/i;

/** Parses "5,000", "5.000", "5,5", "$12k", "1.2m", "10%" into a number. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().toLowerCase().replace(/[$€£₺%\s]/g, "");
  let mult = 1;
  if (/[kmb]$/.test(s)) {
    mult = s.endsWith("k") ? 1e3 : s.endsWith("m") ? 1e6 : 1e9;
    s = s.slice(0, -1);
  }
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    // The later separator is the decimal one: 1.234,56 or 1,234.56
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (commas) {
    // 5,000 / 1,250,000 are thousands; 5,5 / 12,75 are decimals.
    s = commas === 1 && !/,\d{3}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (dots) {
    // 5.000 / 1.250.000 are thousands (Turkish, German); 5.5 is a decimal.
    s = dots > 1 || /\.\d{3}$/.test(s) ? s.replace(/\./g, "") : s;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}

/** Splits a question into tokens; keeps "quoted text", ISO dates and numbers whole. */
export function tokenize(input: string): Token[] {
  const s = input.slice(0, 500);
  const out: Token[] = [];
  const re = /"([^"]{1,120})"|'([^']{2,120})'(?![a-zçğıöşü])|(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})|((?:[$€£₺]\s?)?\d+(?:[.,]\d+)*(?:[kKmMbB](?![\p{L}]))?%?)|([\p{L}][\p{L}\p{N}_&.-]*(?:'[\p{L}]+)?)|([<>]=?|=|!=|%)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const raw = m[0];
    const base = { raw, start: m.index, end: m.index + raw.length, suffix: "" };
    if (m[1] !== undefined || m[2] !== undefined) out.push({ ...base, t: fold(m[1] ?? m[2]), kind: "quoted" });
    else if (m[3] !== undefined) out.push({ ...base, t: m[3], kind: "date" });
    else if (m[4] !== undefined) {
      const n = parseNumber(raw);
      // A Turkish suffix after an apostrophe belongs to the number: "2024'ten", "5000'den".
      const suf = /^['’]([a-zçğıöşü]+)/i.exec(s.slice(re.lastIndex));
      if (suf) re.lastIndex += suf[0].length;
      if (n !== null && NUMBER.test(raw.replace(/\s/g, ""))) out.push({ ...base, end: base.end + (suf?.[0].length ?? 0), suffix: suf ? fold(suf[1]) : "", t: raw.toLowerCase(), kind: "number", n });
    } else if (m[5] !== undefined) {
      let w = fold(m[5]).replace(/[.-]+$/, "");
      let suffix = "";
      const ap = w.indexOf("'");
      if (ap > 0) {
        suffix = w.slice(ap + 1);
        w = w.slice(0, ap);
        // English contractions and possessives: haven't -> havent, customer's -> customer.
        if (suffix === "t") {
          w = `${w}t`;
          suffix = "";
        } else if (["s", "re", "ve", "ll", "d", "m"].includes(suffix) && /[a-z]$/.test(w)) suffix = "";
      }
      // "10k" style numbers glued to letters were taken above; "q3" and "h1" stay words.
      out.push({ ...base, t: w, suffix, kind: "word" });
    } else out.push({ ...base, t: m[6], kind: "symbol" });
  }
  return out;
}

/**
 * Turkish suffixes, folded (ı -> i, ü -> u, ö -> o). A word matches a dictionary stem when what
 * follows the stem is a chain of these: "musteriler" = "musteri" + "ler", "faturalarin" = "fatura" + "lar" + "in".
 */
const SUFFIXES = [
  "lar", "ler", "in", "un", "nin", "nun", "i", "u", "si", "su", "yi", "yu", "a", "e", "ya", "ye", "na", "ne",
  "da", "de", "ta", "te", "nda", "nde", "dan", "den", "tan", "ten", "ndan", "nden", "daki", "deki", "taki",
  "teki", "ndaki", "ndeki", "ki", "la", "le", "yla", "yle", "li", "lu", "siz", "suz", "lik", "luk", "ligi",
  "lugu", "im", "um", "imiz", "umuz", "n", "dir", "dur", "tir", "tur", "ca", "ce", "sini", "sunu", "ini", "unu",
  "ni", "nu", "yla", "dir", "mis", "mus", "an", "en", "yan", "yen", "dik", "duk", "tik", "tuk", "ma", "me",
  "mayan", "meyen", "mamis", "memis", "madik", "medik", "lari", "leri", "larin", "lerin", "si", "sinin", "sunun",
  "inda", "inde", "undan", "unden", "sindan", "sinden", "sunda", "sunde", "m", "miz", "muz", "niz", "nuz", "iniz", "unuz", "imiz", "umuz", "mizin", "muzun",
].sort((a, b) => b.length - a.length);

export function isTurkishSuffix(rest: string, depth = 0): boolean {
  if (!rest) return true;
  if (depth > 4) return false;
  for (const s of SUFFIXES) if (rest.startsWith(s) && isTurkishSuffix(rest.slice(s.length), depth + 1)) return true;
  return false;
}

/** English plural or possessive: invoices, categories, boxes, customer's. */
export function isEnglishInflection(stem: string, word: string): boolean {
  if (word === stem + "s" || word === stem + "es") return true;
  if (stem.endsWith("y") && word === stem.slice(0, -1) + "ies") return true;
  return false;
}

/** Damerau-Levenshtein distance, capped: returns cap + 1 as soon as it is clearly over. */
export function distance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

/** How many typos a word of this length may carry and still match. */
export const typoBudget = (len: number) => (len >= 8 ? 2 : len >= 5 ? 1 : 0);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100, a: 1, an: 1, single: 1,
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, onbes: 15, yirmi: 20, otuz: 30, elli: 50, yuz: 100,
  dozen: 12, couple: 2,
};

export function numberWord(t: string): number | null {
  return NUMBER_WORDS[t] ?? null;
}

const TR_HINTS = new Set(["ve", "ile", "en", "kac", "hangi", "olan", "son", "gecen", "bu", "gore", "toplam", "ortalama", "musteri", "fatura", "goster", "listele", "icin", "her", "mi", "ne", "kadar", "yil", "ay", "hafta", "gun", "cok", "az", "bazinda", "basina", "olmayan", "hic", "tum", "butun", "nedir", "satis", "urun", "gider", "odeme", "kim", "kimler", "sehir", "ulke", "olarak", "arasinda", "fazla", "buyuk", "kucuk", "yuksek", "dusuk", "sayisi", "tutari", "yillik", "aylik"]);
const EN_HINTS = new Set(["the", "and", "of", "by", "in", "how", "many", "much", "what", "which", "who", "show", "list", "top", "last", "this", "per", "for", "with", "from", "total", "average", "customers", "invoices", "are", "is", "most", "each", "than", "over", "did", "have", "has", "me", "all", "month", "year", "week", "sales", "revenue", "products"]);

/** "tr" or "en", from the words used (Turkish letters count double). */
export function detectLanguage(input: string): "tr" | "en" {
  const words = tokenize(input).filter((t) => t.kind === "word");
  let tr = /[çğıöşüİ]/i.test(input) ? 2 : 0;
  let en = 0;
  for (const w of words) {
    if (TR_HINTS.has(w.t) || w.suffix) tr++;
    if (EN_HINTS.has(w.t)) en++;
    if (/(lar|ler|lari|leri|nda|nde|dan|den|daki|deki)$/.test(w.t) && w.t.length > 5) tr += 0.5;
  }
  return tr > en ? "tr" : "en";
}
