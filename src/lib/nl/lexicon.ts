import type { Model } from "../model";
import { fold, isEnglishInflection, isTurkishSuffix, tokenize, typoBudget, distance, type Token } from "./text";

export type Agg = "sum" | "avg" | "min" | "max" | "count";
export type Grain = "day" | "week" | "month" | "quarter" | "year";
export type Op = ">" | "<" | ">=" | "<=" | "=" | "!=";

/** What a word or phrase can mean. */
export type Sense =
  | { k: "table"; table: string }
  | { k: "column"; table: string; column: string }
  | { k: "metric"; metric: string }
  | { k: "value"; table: string; column: string; values: string[] }
  | { k: "agg"; agg: Agg }
  | { k: "count" }
  | { k: "howmuch" }
  | { k: "top" }
  | { k: "bottom" }
  | { k: "group" }
  | { k: "grain"; grain: Grain }
  | { k: "trend" }
  | { k: "cmp"; op: Op; after?: boolean }
  | { k: "neg" }
  | { k: "without" }
  | { k: "list" }
  | { k: "distinct" }
  | { k: "share" }
  | { k: "growth" }
  | { k: "compare" }
  | { k: "latest" }
  | { k: "earliest" }
  | { k: "asc" }
  | { k: "desc" }
  | { k: "which" }
  | { k: "who" }
  | { k: "relative" }
  | { k: "write" }
  | { k: "scale"; n: number }
  | { k: "currency" }
  | { k: "stop" };

interface Entry {
  words: string[];
  sense: Sense;
  /** Turkish stems may carry suffixes; English ones plurals. */
  lang: "en" | "tr" | "any";
}

const G = (lang: Entry["lang"], sense: Sense, ...phrases: string[]): Entry[] => phrases.map((p) => ({ words: fold(p).split(/\s+/), sense, lang }));

/** Words that are about the shape of the question, not the data. */
const GENERIC: Entry[] = [
  ...G("en", { k: "agg", agg: "sum" }, "total", "sum", "sum of", "totals", "overall", "combined", "aggregate", "in total", "altogether"),
  ...G("tr", { k: "agg", agg: "sum" }, "toplam", "toplamı", "toplamda", "tümü", "genel toplam"),
  ...G("en", { k: "agg", agg: "avg" }, "average", "avg", "mean", "typical", "on average"),
  ...G("tr", { k: "agg", agg: "avg" }, "ortalama", "ortalaması", "ort"),
  ...G("en", { k: "agg", agg: "max" }, "maximum", "max", "highest value", "peak"),
  ...G("tr", { k: "agg", agg: "max" }, "maksimum", "en yüksek değer", "zirve"),
  ...G("en", { k: "agg", agg: "min" }, "minimum", "min", "lowest value"),
  ...G("tr", { k: "agg", agg: "min" }, "minimum", "en düşük değer"),
  ...G("en", { k: "count" }, "how many", "number of", "count", "count of", "no of", "no. of", "# of", "how much invoices", "quantity of"),
  ...G("tr", { k: "count" }, "kaç", "kaç tane", "kaç adet", "sayısı", "sayısını", "sayı", "adedi", "sayıca", "kaçtane"),
  ...G("en", { k: "howmuch" }, "how much", "what is the value", "how big"),
  ...G("tr", { k: "howmuch" }, "ne kadar", "kaç para", "ne kadardı", "tutarı ne"),
  ...G("en", { k: "top" }, "expensive", "priciest", "pricey", "costliest"),
  ...G("tr", { k: "top" }, "pahalı"),
  ...G("en", { k: "bottom" }, "cheap", "cheapest", "inexpensive"),
  ...G("tr", { k: "bottom" }, "ucuz"),
  ...G("en", { k: "top" }, "top", "most", "highest", "largest", "biggest", "best", "greatest", "leading", "maximum", "max", "the most", "most valuable", "heaviest", "highest paying", "major", "key"),
  ...G("tr", { k: "top" }, "en çok", "en fazla", "en yüksek", "en büyük", "en iyi", "en değerli", "en önemli", "lider", "zirvedeki"),
  ...G("en", { k: "bottom" }, "bottom", "least", "lowest", "smallest", "worst", "fewest", "weakest", "minimum", "min", "the least"),
  ...G("tr", { k: "bottom" }, "en az", "en düşük", "en küçük", "en kötü", "en zayıf"),
  ...G("en", { k: "group" }, "by", "per", "for each", "each", "every", "broken down by", "breakdown by", "split by", "grouped by", "group by", "across", "for every", "by each"),
  ...G("tr", { k: "group" }, "göre", "bazında", "başına", "her", "kırılımında", "kırılımı", "dağılımı", "itibarıyla", "ayrı ayrı", "bazlı"),
  ...G("en", { k: "grain", grain: "day" }, "daily", "per day", "by day", "each day", "day by day", "days", "day"),
  ...G("tr", { k: "grain", grain: "day" }, "günlük", "gün gün", "günlere göre", "her gün"),
  ...G("en", { k: "grain", grain: "week" }, "weekly", "per week", "by week", "each week", "week by week", "weeks", "week"),
  ...G("tr", { k: "grain", grain: "week" }, "haftalık", "hafta hafta", "haftalara göre", "her hafta"),
  ...G("en", { k: "grain", grain: "month" }, "monthly", "per month", "by month", "each month", "month by month", "month over month", "months", "mom", "month"),
  ...G("tr", { k: "grain", grain: "month" }, "aylık", "ay ay", "aylara göre", "her ay", "ay bazında", "aylar", "ay"),
  ...G("en", { k: "grain", grain: "quarter" }, "quarterly", "per quarter", "by quarter", "each quarter", "quarters", "quarter"),
  ...G("tr", { k: "grain", grain: "quarter" }, "çeyreklik", "çeyrek çeyrek", "çeyreklere göre", "her çeyrek", "dönemsel", "çeyrek"),
  ...G("en", { k: "grain", grain: "year" }, "yearly", "annual", "annually", "per year", "by year", "each year", "year over year", "yoy", "years", "year"),
  ...G("tr", { k: "grain", grain: "year" }, "yıllık", "yıllara göre", "her yıl", "yıl yıl", "senelik", "yıllar", "yıl", "sene"),
  ...G("en", { k: "trend" }, "trend", "trends", "over time", "trajectory", "evolution", "history", "timeline", "development"),
  ...G("tr", { k: "trend" }, "trend", "zaman içinde", "seyir", "seyri", "gidişat", "değişimi", "gelişimi", "tarihçe"),
  ...G("en", { k: "growth" }, "growth", "grow", "grew", "change", "changes", "increase", "decrease", "delta", "growth rate", "percent change"),
  ...G("tr", { k: "growth" }, "büyüme", "büyümesi", "artış", "azalış", "değişim", "değişim oranı", "fark"),
  ...G("en", { k: "share" }, "share", "share of", "percentage", "percent", "percent of total", "proportion", "contribution", "split", "mix", "pct"),
  ...G("tr", { k: "share" }, "pay", "payı", "yüzde", "yüzdesi", "oran", "oranı", "dağılım", "katkı"),
  ...G("en", { k: "compare" }, "compare", "compared", "comparison", "vs", "versus", "against", "relative to"),
  ...G("tr", { k: "compare" }, "karşılaştır", "karşılaştırma", "kıyasla", "kıyasla", "kıyas"),
  ...G("en", { k: "cmp", op: ">" }, "more than", "over", "above", "greater than", "exceeding", "exceeds", "exceed", "bigger than", "larger than", "higher than", "beyond", "in excess of", "upwards of", "north of", ">"),
  ...G("en", { k: "cmp", op: "<" }, "less than", "under", "below", "fewer than", "smaller than", "lower than", "beneath", "south of", "<"),
  ...G("en", { k: "cmp", op: ">=" }, "at least", "minimum of", "or more", "and above", "and up", "or above", "no less than", ">="),
  ...G("en", { k: "cmp", op: "<=" }, "at most", "maximum of", "up to", "or less", "and below", "or below", "no more than", "not more than", "<="),
  ...G("en", { k: "cmp", op: "=" }, "equal to", "equals", "exactly", "="),
  ...G("tr", { k: "cmp", op: ">", after: true }, "fazla", "fazlası", "üzeri", "üzerinde", "üzerindeki", "üstü", "üstünde", "üstündeki", "büyük", "yüksek", "çok", "aşan", "geçen"),
  ...G("tr", { k: "cmp", op: "<", after: true }, "az", "altı", "altında", "altındaki", "küçük", "düşük", "aşağı", "aşağısı", "eksik"),
  ...G("tr", { k: "cmp", op: ">=" }, "en az"),
  ...G("tr", { k: "cmp", op: "<=" }, "en fazla", "en çok", "azami"),
  ...G("tr", { k: "cmp", op: ">=", after: true }, "ve üzeri", "ve üstü", "veya üzeri", "ve fazlası"),
  ...G("tr", { k: "cmp", op: "<=", after: true }, "ve altı", "ve aşağısı", "veya altı", "ve daha az"),
  ...G("en", { k: "neg" }, "not", "except", "excluding", "exclude", "other than", "besides", "apart from", "but not", "non", "isn't", "aren't", "no"),
  ...G("tr", { k: "neg" }, "hariç", "dışında", "dışındaki", "olmayan", "değil", "haricinde", "harici", "dışı"),
  ...G("en", { k: "without" }, "without", "never", "with no", "no", "havent", "hasnt", "didnt", "dont", "doesnt", "did not", "have not", "has not", "do not", "does not", "zero", "not ordered", "not bought"),
  ...G("tr", { k: "without" }, "hiç", "olmayan", "yapmamış", "vermemiş", "almamış", "etmemiş", "olmamış", "satılmamış", "satılmayan", "ödememiş", "vermeyen", "almayan", "yapmayan", "etmeyen", "ödemeyen", "satın almayan", "sipariş vermeyen", "alışveriş yapmayan"),
  ...G("en", { k: "list" }, "show", "list", "display", "give", "get", "find", "see", "view", "pull", "fetch", "return", "which are", "what are", "all", "every", "lookup", "look up"),
  ...G("tr", { k: "list" }, "göster", "listele", "getir", "bul", "ver", "nelerdir", "hangileri", "tüm", "bütün", "hepsi", "liste", "listesi", "gör"),
  ...G("en", { k: "distinct" }, "distinct", "unique", "different"),
  ...G("tr", { k: "distinct" }, "farklı", "benzersiz", "tekil"),
  ...G("en", { k: "latest" }, "latest", "newest", "most recent", "recent", "last", "recently"),
  ...G("tr", { k: "latest" }, "en yeni", "en son", "son", "yeni", "güncel"),
  ...G("en", { k: "earliest" }, "earliest", "oldest", "first"),
  ...G("tr", { k: "earliest" }, "en eski", "ilk", "eski"),
  ...G("en", { k: "asc" }, "ascending", "alphabetical", "alphabetically", "a to z", "low to high", "smallest first", "lowest first", "least first"),
  ...G("tr", { k: "asc" }, "artan", "alfabetik", "küçükten büyüğe"),
  ...G("en", { k: "desc" }, "descending", "high to low", "largest first", "highest first", "biggest first", "most first", "z to a"),
  ...G("tr", { k: "desc" }, "azalan", "büyükten küçüğe", "en yüksekten", "çoktan aza"),
  ...G("en", { k: "which" }, "which", "what"),
  ...G("tr", { k: "which" }, "hangi", "hangisi", "hangileri", "ne"),
  ...G("en", { k: "who" }, "who", "whom", "whose"),
  ...G("tr", { k: "who" }, "kim", "kimler", "kimin", "kimdir"),
  ...G("en", { k: "relative" }, "that", "who", "with", "having", "where", "whose", "which have", "that have"),
  ...G("tr", { k: "relative" }, "olan", "olanlar", "sahip", "içeren"),
  ...G("en", { k: "write" }, "delete", "remove", "drop", "update", "insert", "truncate", "alter", "erase", "wipe", "modify", "change the", "set the", "rename", "create table", "add a"),
  ...G("tr", { k: "write" }, "sil", "silin", "kaldır", "güncelle", "değiştir", "ekle", "temizle", "yok et", "sıfırla"),
  ...G("en", { k: "scale", n: 1e3 }, "thousand", "k", "grand"),
  ...G("en", { k: "scale", n: 1e6 }, "million", "mn", "mil", "millions"),
  ...G("tr", { k: "scale", n: 1e3 }, "bin"),
  ...G("tr", { k: "scale", n: 1e6 }, "milyon"),
  ...G("any", { k: "currency" }, "dollar", "dollars", "usd", "$", "bucks", "eur", "euro", "euros", "dolar", "dolarlık", "lira", "tl", "try"),
  ...G(
    "en",
    { k: "stop" },
    "the", "a", "an", "of", "for", "to", "in", "on", "at", "from", "me", "my", "our", "we", "us", "i", "you", "please", "is", "are", "was", "were", "be", "been", "do", "does", "did", "have", "has", "had", "there", "this", "these", "those", "it", "its", "and", "or", "any", "tell", "let", "know", "want", "need", "can", "could", "would", "should", "will", "about", "so", "far", "as", "than", "much", "many", "how", "whats", "what's", "data", "information", "info", "details", "report", "number", "numbers", "amount of", "value of", "what is", "what was", "what were", "our company", "company's", "brightwater", "just", "only", "also", "into", "within", "during", "same", "time", "period", "them", "they", "their", "made", "make", "generated", "generate", "brought", "bring", "come", "came", "done", "doing", "currently", "now", "right", "still", "yet", "ever", "lately", "who's", "via", "using", "use", "their", "them", "if", "when", "then",
  ),
  ...G(
    "tr",
    { k: "stop" },
    "ve", "ile", "bu", "şu", "o", "da", "de", "mi", "mı", "mu", "mü", "nedir", "neler", "için", "gibi", "kadar", "bana", "bize", "lütfen", "var", "varmı", "yok", "olarak", "şirketimiz", "bizim", "en", "acaba", "peki", "şimdi", "hem", "ya", "veya", "yada", "ise", "olmuş", "oldu", "olduğu", "olan", "yapılan", "yapan", "eden", "edilen", "gelen", "giden", "tarafından", "içinde", "içindeki", "arasında", "dönem", "dönemde", "dönemi", "zaman", "süresince", "boyunca", "toplamda", "ait", "açısından", "bakımından", "itibarıyla", "olarak", "yönünden", "veri", "bilgi", "rapor", "raporu", "durumu", "nasıl", "neydi", "nelerdi", "idi", "dır", "dir", "tır", "tir", "sadece", "yalnızca", "şirket", "şirketin", "brightwater", "ki", "diğer", "hangisidir", "kaçtır", "nedir", "olur", "oluyor", "eder", "ediyor", "çıkar", "çıkan", "yapmış", "etmiş", "göre", "ilgili", "itibariyle",
  ),
];

export interface Lexicon {
  entries: Entry[];
  /** Entries by first word, longest first. */
  byFirst: Map<string, Entry[]>;
  /** Single words, for typo matching. */
  vocabulary: string[];
}

export function buildLexicon(model: Model): Lexicon {
  const entries: Entry[] = [...GENERIC];
  const add = (sense: Sense, phrase: string, lang: Entry["lang"] = "any") => {
    const words = fold(phrase).split(/\s+/).filter(Boolean);
    if (words.length) entries.push({ words, sense, lang });
  };
  for (const t of model.tables) {
    for (const term of t.terms) add({ k: "table", table: t.name }, term);
    for (const c of t.columns) {
      for (const term of c.terms) add({ k: "column", table: t.name, column: c.name }, term);
      const aliases = c.valueTerms ?? {};
      for (const v of c.values ?? []) {
        // Values become words only when they are short names, not free text.
        if (v.length > 60) continue;
        add({ k: "value", table: t.name, column: c.name, values: [v] }, v);
      }
      for (const [v, words] of Object.entries(aliases)) for (const w of words) add({ k: "value", table: t.name, column: c.name, values: [v] }, w);
    }
  }
  for (const m of model.metrics) for (const term of m.terms) add({ k: "metric", metric: m.id }, term);
  // Multi-value words: "unpaid" means open or overdue.
  if (model.source === "demo") {
    for (const w of ["unpaid", "not paid", "outstanding invoices", "open invoices", "receivable", "ödenmemiş", "ödenmeyen", "açık faturalar", "tahsil edilmemiş", "bekleyen ödemeler"]) add({ k: "value", table: "invoices", column: "status", values: ["open", "overdue"] }, w);
  }

  const byFirst = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byFirst.get(e.words[0]) ?? [];
    list.push(e);
    byFirst.set(e.words[0], list);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length);
  const vocabulary = [...new Set(entries.filter((e) => e.words.length === 1 && e.sense.k !== "stop").map((e) => e.words[0]).filter((w) => w.length >= 5))];
  return { entries, byFirst, vocabulary };
}

/** Does a typed word match a dictionary word? Exact, plural/suffixed, or with a small typo. */
export function wordMatches(dict: string, tok: Token, last: boolean, lang: Entry["lang"]): "exact" | "inflected" | "typo" | null {
  const t = tok.t;
  if (t === dict) return "exact";
  if (last || lang !== "en") {
    if (isEnglishInflection(dict, t) && lang !== "tr") return "inflected";
    if (dict.length >= 3 && t.startsWith(dict) && t.length - dict.length <= 9 && isTurkishSuffix(t.slice(dict.length)) && lang !== "en") return "inflected";
    // Turkish drops the last vowel or softens the last consonant before a suffix: "kâr" -> "kârı", "renk" -> "rengi".
    if (dict.length >= 4 && lang !== "en") {
      const soft = dict.replace(/k$/, "g").replace(/p$/, "b").replace(/t$/, "d").replace(/c$/, "c");
      if (soft !== dict && t.startsWith(soft) && isTurkishSuffix(t.slice(soft.length)) && t.length > soft.length) return "inflected";
    }
  }
  return null;
}

export function typoMatch(dict: string, t: string): boolean {
  const budget = typoBudget(Math.min(dict.length, t.length));
  if (!budget || dict[0] !== t[0]) return false;
  return distance(dict, t, budget) <= budget;
}

export { tokenize };
