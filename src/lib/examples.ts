import type { Model } from "./model";

/** Starter questions: hand-picked for the demo, built from the schema for uploads. */
export function examples(model: Model, lang: "en" | "tr"): string[] {
  if (model.source === "demo") {
    return lang === "tr"
      ? ["Son 6 ayda en çok harcayan 5 müşteri", "Bu yıl aylık ciro", "Bize en çok borcu olan müşteri kim", "Kategorilere göre brüt kâr marjı", "Son 3 ayda hiç faturası olmayan müşteriler", "Bu yıl ile geçen yıl ciro karşılaştırması", "Segmentlere göre ortalama ödeme süresi"]
      : ["Top 5 customers by revenue last quarter", "Monthly revenue this year", "Who owes us the most?", "Gross margin by category", "Customers with no invoices in the last 3 months", "Revenue this year vs last year", "Average days to pay by segment"];
  }
  const out: string[] = [];
  const fact = [...model.tables].sort((a, b) => b.rows - a.rows).find((t) => t.amountColumn) ?? model.tables[0];
  const amount = fact.columns.find((c) => c.name === fact.amountColumn);
  const cat = fact.columns.find((c) => c.role === "category" && (c.distinct ?? 0) > 1 && (c.distinct ?? 0) <= 30);
  const date = fact.dateColumn;
  const dim = model.tables.find((t) => t.rankMetric && t.nameColumn);
  const al = amount?.label.toLowerCase();
  const tr = lang === "tr";
  if (amount && cat) out.push(tr ? `${cat.label} bazında toplam ${al}` : `total ${al} by ${cat.label.toLowerCase()}`);
  if (amount && date) out.push(tr ? `aylık toplam ${al}` : `monthly total ${al}`);
  if (dim) out.push(tr ? `en büyük 5 ${dim.label}` : `top 5 ${dim.plural}`);
  out.push(tr ? `kaç ${fact.label} var` : `how many ${fact.plural}`);
  if (amount) out.push(tr ? `${al} ortalaması` : `average ${al}`);
  if (cat) out.push(tr ? `${cat.label} bazında ${fact.label} sayısı` : `number of ${fact.plural} by ${cat.label.toLowerCase()}`);
  if (date) out.push(tr ? `son 30 gündeki ${fact.plural}` : `${fact.plural} in the last 30 days`);
  return out.slice(0, 6);
}
