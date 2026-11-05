import type { Db } from "./db";
import { fold } from "./nl/text";

/**
 * The semantic model the question parser works from: what each table and column means, the words
 * people use for them in English and Turkish, how tables join, and the business measures
 * ("revenue", "outstanding", "days to pay") with their exact SQL. The demo database is described
 * by hand below; an uploaded file gets a model inferred from its column names and values.
 */

export type ColType = "integer" | "real" | "text" | "date";
export type Role = "id" | "fk" | "name" | "code" | "category" | "money" | "quantity" | "percent" | "number" | "date" | "text" | "email" | "flag";
export type Unit = "money" | "count" | "days" | "percent" | "number";

export interface ColumnModel {
  table: string;
  name: string;
  type: ColType;
  role: Role;
  label: string;
  labelTr: string;
  /** Words that name the column, folded. */
  terms: string[];
  /** For category columns: the distinct values, and other words for some of them. */
  values?: string[];
  valueTerms?: Record<string, string[]>;
  ref?: { table: string; column: string };
  /** How many distinct values (for inferred models). */
  distinct?: number;
  /** Measures to use for "total X" / "average X" so their business rules apply (void invoices). */
  metricFor?: Partial<Record<"sum" | "avg", string>>;
}

export interface TableModel {
  name: string;
  /** "customer" / "customers" */
  label: string;
  plural: string;
  labelTr: string;
  terms: string[];
  pk?: string;
  /** The column that names a row (customers.name). */
  nameColumn?: string;
  /** The column most date questions are about (invoices.issued_at). */
  dateColumn?: string;
  /** The column "over 5000" refers to (invoices.total). */
  amountColumn?: string;
  /** The measure "top customers" ranks by, when the question names none. */
  rankMetric?: string;
  /** Columns shown when listing rows; "customer_id" shows the customer's name. */
  listColumns: string[];
  columns: ColumnModel[];
  rows: number;
}

export interface MetricModel {
  id: string;
  label: string;
  labelTr: string;
  terms: string[];
  /** The table the measure is computed over. */
  table: string;
  /** Aggregate SQL with {table} placeholders for aliases, e.g. "SUM({invoices}.total)". */
  sql: string;
  /** Row filter that always applies, e.g. "{invoices}.status <> 'void'". */
  where?: string;
  /** "table.column" the date range applies to. */
  date: string;
  unit: Unit;
  /** Other tables the SQL reads (joined many-to-one from `table`). */
  joins?: string[];
  /** A measure at a finer grain to use when the question groups or filters below this one. */
  finer?: string;
  /** Plain description shown when the measure is picked. */
  note: string;
  noteTr: string;
  /** Higher is better (for "best" / "worst"). */
  higherIsBetter?: boolean;
}

export interface Relation {
  /** The many side: invoices.customer_id */
  from: { table: string; column: string };
  /** The one side: customers.id */
  to: { table: string; column: string };
}

export interface Model {
  source: "demo" | "upload";
  tables: TableModel[];
  relations: Relation[];
  metrics: MetricModel[];
  /** The day "today" means in questions. */
  today: string;
}

export const table = (m: Model, name: string) => m.tables.find((t) => t.name === name)!;
export const column = (m: Model, t: string, c: string) => table(m, t).columns.find((x) => x.name === c)!;

const terms = (...xs: string[]) => [...new Set(xs.map((x) => fold(x).trim()).filter(Boolean))];

interface ColumnNote {
  label: string;
  labelTr: string;
  role: Role;
  terms?: string[];
  valueTerms?: Record<string, string[]>;
}

/** Hand-written meaning of the demo database. */
const DEMO: Record<string, { label: string; plural: string; labelTr: string; terms: string[]; nameColumn?: string; dateColumn?: string; amountColumn?: string; rankMetric?: string; listColumns: string[]; columns: Record<string, ColumnNote> }> = {
  customers: {
    label: "customer",
    plural: "customers",
    labelTr: "müşteri",
    terms: ["customer", "customers", "client", "clients", "account", "accounts", "buyer", "buyers", "company", "companies", "müşteri", "müşteriler", "cari", "firma", "firmalar", "şirket", "şirketler", "alıcı"],
    nameColumn: "name",
    dateColumn: "created_at",
    amountColumn: "credit_limit",
    rankMetric: "revenue",
    listColumns: ["name", "segment", "country", "city", "status", "credit_limit"],
    columns: {
      id: { label: "Customer ID", labelTr: "Müşteri no", role: "id", terms: ["customer id", "müşteri no", "müşteri numarası"] },
      name: { label: "Customer", labelTr: "Müşteri adı", role: "name", terms: ["customer name", "name", "names", "müşteri adı", "isim", "ad", "unvan"] },
      segment: {
        label: "Segment",
        labelTr: "Segment",
        role: "category",
        terms: ["segment", "segments", "industry", "industries", "sector", "sectors", "type of customer", "customer type", "sektör", "sektörler", "segmentler", "müşteri tipi", "müşteri türü"],
        valueTerms: {
          Retail: ["retail", "retailer", "retailers", "shops", "stores", "perakende", "perakendeci", "mağaza", "mağazalar"],
          Hospitality: ["hospitality", "hotels", "hotel", "restaurants", "cafes", "konaklama", "otel", "oteller", "restoran", "restoranlar", "turizm"],
          Healthcare: ["healthcare", "health", "medical", "clinics", "sağlık", "klinik", "klinikler", "hastane"],
          Education: ["education", "schools", "school", "universities", "eğitim", "okul", "okullar", "üniversite"],
          Corporate: ["corporate", "corporates", "offices", "kurumsal", "şirketler"],
        },
      },
      country: {
        label: "Country",
        labelTr: "Ülke",
        role: "category",
        terms: ["country", "countries", "nation", "ülke", "ülkeler", "memleket"],
        valueTerms: {
          "United States": ["usa", "us", "u.s.", "america", "united states of america", "the us", "states", "abd", "amerika", "amerika birleşik devletleri"],
          "United Kingdom": ["uk", "u.k.", "britain", "great britain", "england", "ingiltere", "birleşik krallık", "britanya"],
          Germany: ["germany", "deutschland", "almanya"],
          France: ["france", "fransa"],
          Netherlands: ["netherlands", "holland", "the netherlands", "hollanda"],
          Spain: ["spain", "ispanya"],
          Turkey: ["turkey", "türkiye", "turkiye"],
          "United Arab Emirates": ["uae", "emirates", "united arab emirates", "bae", "birleşik arap emirlikleri", "emirlikler"],
          Canada: ["canada", "kanada"],
        },
      },
      city: { label: "City", labelTr: "Şehir", role: "category", terms: ["city", "cities", "town", "şehir", "şehirler", "il", "kent"], valueTerms: { Izmir: ["izmir"], Cologne: ["köln", "koln"] } },
      region: {
        label: "Region",
        labelTr: "Bölge",
        role: "category",
        terms: ["region", "regions", "area", "territory", "market", "markets", "bölge", "bölgeler", "pazar"],
        valueTerms: {
          "North America": ["north america", "na", "kuzey amerika"],
          Europe: ["europe", "eu", "european", "avrupa"],
          "Middle East": ["middle east", "mena", "orta doğu", "ortadoğu"],
        },
      },
      sales_rep_id: { label: "Sales rep", labelTr: "Satış temsilcisi", role: "fk", terms: ["sales rep", "rep", "account owner"] },
      credit_limit: { label: "Credit limit", labelTr: "Kredi limiti", role: "money", terms: ["credit limit", "credit limits", "credit line", "limit", "kredi limiti", "limit", "limitler", "kredi"] },
      status: {
        label: "Customer status",
        labelTr: "Müşteri durumu",
        role: "category",
        terms: ["customer status", "account status", "müşteri durumu"],
        valueTerms: { active: ["active", "current customers", "aktif", "faal"], inactive: ["inactive", "churned", "lost", "former", "dormant", "pasif", "kaybedilen", "inaktif"] },
      },
      created_at: { label: "Customer since", labelTr: "Kayıt tarihi", role: "date", terms: ["customer since", "signup date", "signed up", "joined", "created", "onboarded", "kayıt tarihi", "katılım", "kayıt"] },
    },
  },
  employees: {
    label: "employee",
    plural: "employees",
    labelTr: "çalışan",
    terms: ["employee", "employees", "staff", "team", "people", "sales rep", "sales reps", "salesperson", "salespeople", "rep", "reps", "account manager", "seller", "sellers", "çalışan", "çalışanlar", "personel", "satış temsilcisi", "satış temsilcileri", "temsilci", "temsilciler", "satıcı", "satıcılar", "ekip"],
    nameColumn: "name",
    dateColumn: "hired_at",
    rankMetric: "revenue",
    listColumns: ["name", "role", "region", "email"],
    columns: {
      id: { label: "Employee ID", labelTr: "Çalışan no", role: "id" },
      name: { label: "Employee", labelTr: "Çalışan", role: "name", terms: ["employee name", "rep name", "çalışan adı", "temsilci adı"] },
      role: {
        label: "Role",
        labelTr: "Görev",
        role: "category",
        terms: ["role", "roles", "job", "title", "position", "görev", "pozisyon", "unvan", "rol"],
        valueTerms: { "Sales rep": ["sales rep", "sales reps", "salesperson", "satış temsilcisi"], "Account manager": ["account manager", "müşteri temsilcisi", "hesap yöneticisi"], Finance: ["finance", "finans", "muhasebe"], Operations: ["operations", "ops", "operasyon"], Marketing: ["marketing", "pazarlama"] },
      },
      region: {
        label: "Team region",
        labelTr: "Ekip bölgesi",
        role: "category",
        terms: ["team region", "ekip bölgesi"],
        valueTerms: { "North America": ["north america", "na", "kuzey amerika"], Europe: ["europe", "eu", "european", "avrupa"], "Middle East": ["middle east", "mena", "orta doğu", "ortadoğu"] },
      },
      email: { label: "Email", labelTr: "E-posta", role: "email", terms: ["email", "e-mail", "mail", "e-posta", "eposta"] },
      hired_at: { label: "Hired", labelTr: "İşe giriş", role: "date", terms: ["hired", "hire date", "start date", "joined", "işe giriş", "işe başlama", "işe alınan", "işe alındı", "işe giren", "işe girdi", "işe başlayan"] },
    },
  },
  products: {
    label: "product",
    plural: "products",
    labelTr: "ürün",
    terms: ["product", "products", "item", "items", "sku", "skus", "goods", "article", "articles", "ürün", "ürünler", "mal", "mallar", "stok kalemi", "kalem"],
    nameColumn: "name",
    amountColumn: "unit_price",
    rankMetric: "units",
    listColumns: ["sku", "name", "category", "unit_price", "in_stock"],
    columns: {
      id: { label: "Product ID", labelTr: "Ürün no", role: "id" },
      sku: { label: "SKU", labelTr: "Stok kodu", role: "code", terms: ["sku", "product code", "stock code", "stok kodu", "ürün kodu"] },
      name: { label: "Product", labelTr: "Ürün adı", role: "name", terms: ["product name", "ürün adı"] },
      category: {
        label: "Category",
        labelTr: "Kategori",
        role: "category",
        terms: ["category", "categories", "product category", "product line", "product lines", "ürün kategorisi", "ürün kategorileri", "kategori", "kategoriler", "ürün grubu", "ürün grupları", "grup"],
        valueTerms: {
          "Office supplies": ["office supplies", "stationery", "office products", "ofis malzemeleri", "kırtasiye", "ofis malzemesi"],
          Cleaning: ["cleaning", "cleaning supplies", "janitorial", "temizlik", "temizlik malzemeleri"],
          Packaging: ["packaging", "shipping supplies", "ambalaj", "paketleme"],
          Breakroom: ["breakroom", "break room", "kitchen", "pantry", "mutfak", "çay ocağı", "ikram"],
          Furniture: ["furniture", "mobilya", "mobilyalar"],
          Electronics: ["electronics", "tech", "it equipment", "elektronik", "teknoloji"],
        },
      },
      unit_price: { label: "List price", labelTr: "Liste fiyatı", role: "money", terms: ["price", "prices", "list price", "unit price", "selling price", "expensive", "priciest", "pricey", "costliest", "cheap", "cheapest", "inexpensive", "pahalı", "ucuz", "fiyat", "fiyatı", "fiyatlar", "liste fiyatı", "birim fiyat", "satış fiyatı"] },
      unit_cost: { label: "Unit cost", labelTr: "Birim maliyet", role: "money", terms: ["cost", "unit cost", "costs", "purchase price", "maliyet", "birim maliyet", "alış fiyatı"] },
      in_stock: { label: "In stock", labelTr: "Stokta", role: "flag", terms: ["in stock", "available", "stokta", "stok"], valueTerms: { "0": ["out of stock", "sold out", "not in stock", "unavailable", "stokta yok", "stokta olmayan", "stokta bulunmayan", "tükenen", "tükenmiş"], "1": ["in stock", "available", "stokta var", "stokta olan"] } },
    },
  },
  invoices: {
    label: "invoice",
    plural: "invoices",
    labelTr: "fatura",
    terms: ["invoice", "invoices", "bill", "bills", "order", "orders", "ordered", "sale", "transactions", "purchase", "purchases", "deal", "deals", "fatura", "faturalar", "sipariş", "siparişler", "satış", "işlem", "işlemler", "alışveriş"],
    dateColumn: "issued_at",
    amountColumn: "total",
    listColumns: ["number", "customer_id", "issued_at", "due_at", "status", "total"],
    columns: {
      id: { label: "Invoice ID", labelTr: "Fatura no", role: "id" },
      number: { label: "Invoice", labelTr: "Fatura", role: "code", terms: ["invoice number", "invoice no", "fatura numarası", "fatura no"] },
      customer_id: { label: "Customer", labelTr: "Müşteri", role: "fk" },
      issued_at: { label: "Issued", labelTr: "Düzenlenme", role: "date", terms: ["issue date", "issued", "invoice date", "date", "dated", "order date", "fatura tarihi", "tarih", "düzenlenme tarihi", "sipariş tarihi"] },
      due_at: { label: "Due", labelTr: "Vade", role: "date", terms: ["due date", "due", "payment due", "vade", "vade tarihi", "son ödeme tarihi"] },
      status: {
        label: "Invoice status",
        labelTr: "Fatura durumu",
        role: "category",
        terms: ["status", "state", "invoice status", "durum", "durumu", "fatura durumu"],
        valueTerms: {
          paid: ["paid", "settled", "closed", "paid off", "ödenmiş", "ödendi", "ödenen", "kapanmış", "tahsil edilmiş", "tahsil edilen"],
          open: ["open", "not yet due", "pending", "outstanding not due", "açık", "bekleyen", "vadesi gelmemiş"],
          overdue: ["overdue", "late", "past due", "delinquent", "vadesi geçmiş", "vadesi geçen", "gecikmiş", "geciken", "geç kalmış", "süresi geçmiş"],
          void: ["void", "voided", "cancelled", "canceled", "iptal", "iptal edilmiş", "iptal edilen"],
        },
      },
      subtotal: { label: "Subtotal", labelTr: "Ara toplam", role: "money", terms: ["subtotal", "net amount", "before tax", "ara toplam", "net tutar", "vergisiz"] },
      tax: { label: "Tax", labelTr: "Vergi", role: "money", terms: ["tax", "taxes", "vat", "sales tax", "vergi", "kdv"] },
      total: { label: "Invoice amount", labelTr: "Fatura tutarı", role: "money", terms: ["total", "amount", "invoice total", "invoice amount", "value", "size", "tutar", "tutarı", "toplam tutar", "fatura tutarı", "değer"] },
    },
  },
  invoice_lines: {
    label: "invoice line",
    plural: "invoice lines",
    labelTr: "fatura kalemi",
    terms: ["invoice line", "invoice lines", "line item", "line items", "lines", "order line", "order lines", "fatura kalemi", "fatura kalemleri", "satır", "satırlar", "kalemler"],
    amountColumn: "line_total",
    listColumns: ["invoice_id", "product_id", "quantity", "unit_price", "discount_pct", "line_total"],
    columns: {
      id: { label: "Line ID", labelTr: "Satır no", role: "id" },
      invoice_id: { label: "Invoice", labelTr: "Fatura", role: "fk" },
      product_id: { label: "Product", labelTr: "Ürün", role: "fk" },
      quantity: { label: "Quantity", labelTr: "Adet", role: "quantity", terms: ["quantity", "qty", "units", "pieces", "volume", "adet", "miktar", "birim", "tane"] },
      unit_price: { label: "Sold at", labelTr: "Satış fiyatı", role: "money", terms: ["sold at", "line price"] },
      discount_pct: { label: "Discount %", labelTr: "İndirim %", role: "percent", terms: ["discount", "discounts", "discount rate", "indirim", "iskonto"] },
      line_total: { label: "Line total", labelTr: "Satır tutarı", role: "money", terms: ["line total", "line amount", "satır tutarı"] },
    },
  },
  payments: {
    label: "payment",
    plural: "payments",
    labelTr: "ödeme",
    terms: ["payment", "payments", "receipt", "receipts", "remittance", "ödeme", "ödemeler", "makbuz"],
    dateColumn: "paid_at",
    amountColumn: "amount",
    listColumns: ["invoice_id", "paid_at", "amount", "method"],
    columns: {
      id: { label: "Payment ID", labelTr: "Ödeme no", role: "id" },
      invoice_id: { label: "Invoice", labelTr: "Fatura", role: "fk" },
      paid_at: { label: "Paid on", labelTr: "Ödeme tarihi", role: "date", terms: ["payment date", "paid on", "paid date", "ödeme tarihi", "tahsilat tarihi"] },
      amount: { label: "Amount", labelTr: "Tutar", role: "money", terms: ["payment amount", "amount paid", "ödeme tutarı", "ödenen tutar"] },
      method: {
        label: "Method",
        labelTr: "Ödeme yöntemi",
        role: "category",
        terms: ["method", "payment method", "payment methods", "payment type", "how they paid", "ödeme yöntemi", "ödeme şekli", "ödeme tipi", "yöntem"],
        valueTerms: {
          "Bank transfer": ["bank transfer", "wire", "wire transfer", "transfer", "banka transferi", "havale", "eft", "banka havalesi"],
          Card: ["card", "credit card", "cards", "kart", "kredi kartı", "kartla", "kartlı"],
          ACH: ["ach", "direct debit", "otomatik ödeme"],
          Check: ["check", "cheque", "checks", "çek"],
        },
      },
    },
  },
  expenses: {
    label: "expense",
    plural: "expenses",
    labelTr: "gider",
    terms: ["expense", "expenses", "expense items", "gider", "giderler", "gider kalemi", "gider kalemleri"],
    dateColumn: "spent_at",
    amountColumn: "amount",
    listColumns: ["spent_at", "category", "vendor", "department", "amount"],
    columns: {
      id: { label: "Expense ID", labelTr: "Gider no", role: "id" },
      spent_at: { label: "Date", labelTr: "Tarih", role: "date", terms: ["expense date", "spent on", "gider tarihi", "harcama tarihi"] },
      category: {
        label: "Expense category",
        labelTr: "Gider türü",
        role: "category",
        terms: ["expense category", "expense type", "cost category", "category", "categories", "kategori", "kategoriler", "gider türü", "gider kategorisi", "masraf türü", "harcama türü"],
        valueTerms: {
          Rent: ["rent", "lease", "kira"],
          Payroll: ["payroll", "salaries", "salary", "wages", "maaş", "maaşlar", "bordro", "personel gideri"],
          Marketing: ["marketing", "advertising", "ads", "pazarlama", "reklam"],
          Software: ["software", "subscriptions", "saas", "yazılım", "abonelik", "abonelikler"],
          Travel: ["travel", "trips", "flights", "hotels", "seyahat", "yolculuk", "uçak"],
          Shipping: ["shipping", "freight", "delivery", "postage", "kargo", "nakliye", "sevkiyat"],
          Utilities: ["utilities", "electricity", "energy", "internet", "elektrik", "enerji", "su", "doğalgaz"],
          Office: ["office", "office costs", "ofis", "ofis giderleri"],
          Meals: ["meals", "food", "lunches", "dinners", "entertainment", "yemek", "yemekler", "ağırlama"],
        },
      },
      vendor: { label: "Vendor", labelTr: "Tedarikçi", role: "category", terms: ["vendor", "vendors", "supplier", "suppliers", "payee", "merchant", "tedarikçi", "tedarikçiler", "satıcı firma", "firma"] },
      department: {
        label: "Department",
        labelTr: "Departman",
        role: "category",
        terms: ["department", "departments", "dept", "team", "cost center", "departman", "departmanlar", "bölüm", "birim"],
        valueTerms: { Sales: ["sales", "satış"], Operations: ["operations", "ops", "operasyon"], Finance: ["finance", "finans", "muhasebe"], Marketing: ["marketing", "pazarlama"] },
      },
      amount: { label: "Amount", labelTr: "Tutar", role: "money", terms: ["expense amount", "gider tutarı", "harcama tutarı"] },
      employee_id: { label: "Spent by", labelTr: "Harcamayı yapan", role: "fk", terms: ["spent by", "submitted by"] },
    },
  },
};

const NOT_VOID = "{invoices}.status <> 'void'";

/** Business measures over the demo database. */
const DEMO_METRICS: MetricModel[] = [
  {
    id: "revenue",
    label: "Revenue",
    labelTr: "Ciro",
    terms: terms("revenue", "revenues", "sales", "turnover", "income", "billings", "billed", "sold", "earnings", "sales amount", "sales volume", "gross sales", "top line", "spend", "spent", "spending", "bought", "buy", "purchased", "invoiced", "business", "ciro", "satış", "satışlar", "satış tutarı", "gelir", "hasılat", "kazanç", "faturalanan", "harcadı", "harcayan", "harcama", "aldı", "alan", "alış", "satın aldı"),
    table: "invoices",
    sql: "SUM({invoices}.total)",
    where: NOT_VOID,
    date: "invoices.issued_at",
    unit: "money",
    finer: "line_revenue",
    note: "Sum of invoice totals including tax, leaving out void invoices",
    noteTr: "İptal edilenler hariç fatura tutarlarının toplamı (vergi dahil)",
    higherIsBetter: true,
  },
  {
    id: "line_revenue",
    label: "Revenue (net)",
    labelTr: "Net satış",
    terms: terms("net sales", "net revenue", "net satış", "net ciro"),
    table: "invoice_lines",
    sql: "SUM({invoice_lines}.line_total)",
    where: NOT_VOID,
    joins: ["invoices"],
    date: "invoices.issued_at",
    unit: "money",
    note: "Sum of invoice line totals before tax, leaving out void invoices",
    noteTr: "İptal edilenler hariç fatura satırlarının vergisiz toplamı",
    higherIsBetter: true,
  },
  {
    id: "units",
    label: "Units sold",
    labelTr: "Satılan adet",
    terms: terms("units sold", "units", "quantity sold", "quantity", "qty", "volume", "volume sold", "number of units", "number of units sold", "pieces", "how many units", "best selling", "best-selling", "top selling", "satılan adet", "satılan miktar", "satılan ürün adedi", "satış miktarı", "adet", "satış adedi", "miktar", "en çok satan", "en çok satılan", "çok satan"),
    table: "invoice_lines",
    sql: "SUM({invoice_lines}.quantity)",
    where: NOT_VOID,
    joins: ["invoices"],
    date: "invoices.issued_at",
    unit: "count",
    note: "Sum of quantities on invoice lines, leaving out void invoices",
    noteTr: "İptal edilenler hariç fatura satırlarındaki adetlerin toplamı",
    higherIsBetter: true,
  },
  {
    id: "gross_profit",
    label: "Gross profit",
    labelTr: "Brüt kâr",
    terms: terms("profit", "profits", "gross profit", "margin dollars", "gross margin dollars", "profitable", "most profitable", "earnings after cost", "kâr", "kar", "brüt kâr", "brüt kar", "kârlılık", "karlılık", "en kârlı", "en karlı", "kârlı", "karlı"),
    table: "invoice_lines",
    sql: "SUM({invoice_lines}.line_total - {invoice_lines}.quantity * {products}.unit_cost)",
    where: NOT_VOID,
    joins: ["invoices", "products"],
    date: "invoices.issued_at",
    unit: "money",
    note: "Line totals before tax minus quantity times unit cost, leaving out void invoices",
    noteTr: "İptal edilenler hariç, vergisiz satır tutarı eksi adet çarpı birim maliyet",
    higherIsBetter: true,
  },
  {
    id: "margin_pct",
    label: "Gross margin %",
    labelTr: "Brüt kâr marjı %",
    terms: terms("margin", "margins", "gross margin", "margin %", "margin percent", "margin percentage", "profit margin", "markup", "marj", "kâr marjı", "kar marjı", "brüt marj", "marjı"),
    table: "invoice_lines",
    sql: "ROUND(100.0 * SUM({invoice_lines}.line_total - {invoice_lines}.quantity * {products}.unit_cost) / NULLIF(SUM({invoice_lines}.line_total), 0), 1)",
    where: NOT_VOID,
    joins: ["invoices", "products"],
    date: "invoices.issued_at",
    unit: "percent",
    note: "Gross profit as a share of net sales",
    noteTr: "Brüt kârın net satışa oranı",
    higherIsBetter: true,
  },
  {
    id: "collected",
    label: "Cash collected",
    labelTr: "Tahsilat",
    terms: terms("collected", "collections", "cash collected", "cash in", "received", "money received", "cash received", "paid in", "inflow", "tahsilat", "tahsil edilen", "tahsil", "toplanan", "nakit girişi", "cash", "cash came in", "came in", "money in", "money came in"),
    table: "payments",
    sql: "SUM({payments}.amount)",
    date: "payments.paid_at",
    unit: "money",
    note: "Sum of payments received",
    noteTr: "Alınan ödemelerin toplamı",
    higherIsBetter: true,
  },
  {
    id: "outstanding",
    label: "Outstanding",
    labelTr: "Açık bakiye",
    terms: terms("outstanding", "outstanding balance", "balance", "balance due", "owed", "owe", "owes", "owing", "unpaid amount", "unpaid", "amount due", "receivables", "accounts receivable", "ar", "debt", "debts", "money owed", "still owe", "open balance", "alacak", "alacaklar", "açık bakiye", "bakiye", "borç", "borçlu", "borcu", "ödenmemiş", "ödenmemiş tutar", "tahsil edilmemiş", "kalan", "kalan tutar"),
    table: "invoices",
    sql: "SUM({invoices}.total - COALESCE((SELECT SUM(pay.amount) FROM payments AS pay WHERE pay.invoice_id = {invoices}.id), 0))",
    where: "{invoices}.status IN ('open', 'overdue')",
    date: "invoices.issued_at",
    unit: "money",
    note: "Invoice totals minus what has been paid, over open and overdue invoices",
    noteTr: "Açık ve vadesi geçmiş faturalarda tutar eksi yapılan ödemeler",
  },
  {
    id: "overdue_amount",
    label: "Overdue amount",
    labelTr: "Vadesi geçmiş tutar",
    terms: terms("overdue amount", "overdue balance", "past due amount", "late payments", "vadesi geçmiş tutar", "geciken tutar", "gecikmiş alacak", "vadesi geçmiş alacak"),
    table: "invoices",
    sql: "SUM({invoices}.total - COALESCE((SELECT SUM(pay.amount) FROM payments AS pay WHERE pay.invoice_id = {invoices}.id), 0))",
    where: "{invoices}.status = 'overdue'",
    date: "invoices.issued_at",
    unit: "money",
    note: "Unpaid part of invoices past their due date",
    noteTr: "Vadesi geçmiş faturaların ödenmemiş kısmı",
  },
  {
    id: "days_to_pay",
    label: "Average days to pay",
    labelTr: "Ortalama ödeme süresi (gün)",
    terms: terms("days to pay", "time to pay", "payment time", "days to collect", "collection time", "dso", "how long to pay", "how fast", "pay late", "slowest payers", "fastest payers", "paying time", "average payment delay", "take to pay", "takes to pay", "days customers take to pay", "pay time", "ödeme süresi", "tahsilat süresi", "kaç günde", "kaç günde öd", "geç öde", "en geç öde", "ödeme gecikmesi", "yavaş öde"),
    table: "invoices",
    sql: "ROUND(AVG(julianday((SELECT MAX(pay.paid_at) FROM payments AS pay WHERE pay.invoice_id = {invoices}.id)) - julianday({invoices}.issued_at)), 1)",
    where: "{invoices}.status = 'paid'",
    date: "invoices.issued_at",
    unit: "days",
    note: "Average days from invoice date to the last payment, over paid invoices",
    noteTr: "Ödenmiş faturalarda fatura tarihinden son ödemeye kadar geçen ortalama gün",
  },
  {
    id: "aov",
    label: "Average invoice value",
    labelTr: "Ortalama fatura tutarı",
    terms: terms("average order value", "aov", "average invoice", "average invoice value", "average order", "average order size", "average deal size", "average basket", "ortalama sipariş", "ortalama fatura", "ortalama sepet", "sepet ortalaması", "ortalama fatura tutarı", "ortalama sipariş tutarı"),
    table: "invoices",
    sql: "ROUND(AVG({invoices}.total), 2)",
    where: NOT_VOID,
    date: "invoices.issued_at",
    unit: "money",
    note: "Average invoice total, leaving out void invoices",
    noteTr: "İptal edilenler hariç ortalama fatura tutarı",
    higherIsBetter: true,
  },
  {
    id: "expense_total",
    label: "Expenses",
    labelTr: "Giderler",
    terms: terms("expenses", "expense", "costs", "spending", "spend", "spent", "opex", "operating expenses", "expenditure", "outgoings", "cost", "burn", "giderler", "gider", "masraf", "masraflar", "harcama", "harcamalar", "harcanan", "işletme giderleri"),
    table: "expenses",
    sql: "SUM({expenses}.amount)",
    date: "expenses.spent_at",
    unit: "money",
    note: "Sum of recorded expenses",
    noteTr: "Kayıtlı giderlerin toplamı",
  },
  {
    id: "new_customers",
    label: "New customers",
    labelTr: "Yeni müşteri",
    terms: terms("new customers", "new clients", "new accounts", "signups", "sign-ups", "customers acquired", "customer acquisition", "onboarded", "yeni müşteri", "yeni müşteriler", "yeni cari", "kazanılan müşteri"),
    table: "customers",
    sql: "COUNT(*)",
    date: "customers.created_at",
    unit: "count",
    note: "Customers whose account was created in the period",
    noteTr: "Hesabı bu dönemde açılan müşteriler",
    higherIsBetter: true,
  },
];

const DEMO_RELATIONS: Relation[] = [
  { from: { table: "customers", column: "sales_rep_id" }, to: { table: "employees", column: "id" } },
  { from: { table: "invoices", column: "customer_id" }, to: { table: "customers", column: "id" } },
  { from: { table: "invoice_lines", column: "invoice_id" }, to: { table: "invoices", column: "id" } },
  { from: { table: "invoice_lines", column: "product_id" }, to: { table: "products", column: "id" } },
  { from: { table: "payments", column: "invoice_id" }, to: { table: "invoices", column: "id" } },
  { from: { table: "expenses", column: "employee_id" }, to: { table: "employees", column: "id" } },
];

function sqlType(declared: string): ColType {
  const t = declared.toUpperCase();
  if (t.includes("INT")) return "integer";
  if (t.includes("REAL") || t.includes("NUM") || t.includes("DEC") || t.includes("FLOA") || t.includes("DOUB")) return "real";
  return "text";
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Distinct values of a text column, when there are few enough to be categories. */
function distinctValues(db: Db, t: string, c: string, cap = 250): { values: string[]; distinct: number } {
  const distinct = Number(db.value(`SELECT COUNT(DISTINCT ${q(c)}) FROM ${q(t)}`) ?? 0);
  if (distinct > cap) return { values: [], distinct };
  const values = db.run(`SELECT DISTINCT ${q(c)} FROM ${q(t)} WHERE ${q(c)} IS NOT NULL ORDER BY 1`).rows.map((r) => String(r[0]));
  return { values, distinct };
}

/** The model of the demo database. */
export function demoModel(db: Db, today: string): Model {
  const tables: TableModel[] = [];
  for (const [name, note] of Object.entries(DEMO)) {
    const info = db.run(`PRAGMA table_info(${q(name)})`).rows;
    const columns: ColumnModel[] = info.map((r) => {
      const col = String(r[1]);
      const n = note.columns[col];
      const rel = DEMO_RELATIONS.find((x) => x.from.table === name && x.from.column === col);
      const isDate = n?.role === "date";
      const c: ColumnModel = {
        table: name,
        name: col,
        type: isDate ? "date" : sqlType(String(r[2])),
        role: n?.role ?? "number",
        label: n?.label ?? col,
        labelTr: n?.labelTr ?? col,
        terms: terms(...(n?.terms ?? []), col.replace(/_/g, " ")),
        ref: rel?.to,
      };
      if (c.role === "category" || c.role === "name" || c.role === "code") {
        const { values, distinct } = distinctValues(db, name, col, c.role === "category" ? 250 : 400);
        c.values = values;
        c.distinct = distinct;
      }
      if (n?.valueTerms) c.valueTerms = Object.fromEntries(Object.entries(n.valueTerms).map(([k, v]) => [k, terms(...v)]));
      if (name === "invoices" && col === "total") c.metricFor = { sum: "revenue", avg: "aov" };
      if (name === "payments" && col === "amount") c.metricFor = { sum: "collected" };
      if (name === "expenses" && col === "amount") c.metricFor = { sum: "expense_total" };
      return c;
    });
    tables.push({
      name,
      label: note.label,
      plural: note.plural,
      labelTr: note.labelTr,
      terms: terms(...note.terms),
      pk: "id",
      nameColumn: note.nameColumn,
      dateColumn: note.dateColumn,
      amountColumn: note.amountColumn,
      rankMetric: note.rankMetric,
      listColumns: note.listColumns,
      columns,
      rows: Number(db.value(`SELECT COUNT(*) FROM ${q(name)}`)),
    });
  }
  return { source: "demo", tables, relations: DEMO_RELATIONS, metrics: DEMO_METRICS, today };
}
