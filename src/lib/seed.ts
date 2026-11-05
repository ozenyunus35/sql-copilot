/**
 * The demo database: Brightwater Supply Co., a fictional wholesaler of office, cleaning and
 * breakroom supplies. Three years of customers, invoices, payments and expenses, generated from a
 * fixed seed and anchored to "today", so questions like "last quarter" always have data.
 * Every name, company and figure is invented.
 */

export interface SeedOptions {
  /** The day the data ends on, as YYYY-MM-DD. */
  today: string;
  seed?: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));
const round2 = (n: number) => Math.round(n * 100) / 100;
const q = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

export const SCHEMA_SQL = `
CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  region TEXT NOT NULL,
  email TEXT NOT NULL,
  hired_at TEXT NOT NULL
);
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT NOT NULL,
  sales_rep_id INTEGER REFERENCES employees(id),
  credit_limit REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL,
  in_stock INTEGER NOT NULL
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL,
  subtotal REAL NOT NULL,
  tax REAL NOT NULL,
  total REAL NOT NULL
);
CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  discount_pct REAL NOT NULL,
  line_total REAL NOT NULL
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  paid_at TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL
);
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  spent_at TEXT NOT NULL,
  category TEXT NOT NULL,
  vendor TEXT NOT NULL,
  department TEXT NOT NULL,
  amount REAL NOT NULL,
  employee_id INTEGER REFERENCES employees(id)
);
CREATE INDEX invoices_customer ON invoices(customer_id);
CREATE INDEX invoices_issued ON invoices(issued_at);
CREATE INDEX lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX lines_product ON invoice_lines(product_id);
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE INDEX expenses_spent ON expenses(spent_at);
`;

const FIRST = ["Avery", "Jordan", "Priya", "Mateo", "Elif", "Noah", "Sofia", "Liam", "Hana", "Lucas", "Zeynep", "Oliver", "Amara", "Emre", "Chloe", "Daniel", "Ines", "Felix", "Maya", "Tomas", "Leah", "Omar", "Clara", "Kenji"];
const LAST = ["Hartley", "Moreno", "Okafor", "Lindqvist", "Demir", "Novak", "Castillo", "Brennan", "Yilmaz", "Fischer", "Laurent", "Rossi", "Patel", "Kowalski", "Haddad", "Sato", "Varga", "Nilsen", "Quinn", "Duarte"];

const PLACES: Array<{ country: string; region: string; cities: string[] }> = [
  { country: "United States", region: "North America", cities: ["Chicago", "Denver", "Austin", "Portland", "Atlanta", "Boston"] },
  { country: "Canada", region: "North America", cities: ["Toronto", "Calgary", "Ottawa"] },
  { country: "United Kingdom", region: "Europe", cities: ["Leeds", "Bristol", "Glasgow"] },
  { country: "Germany", region: "Europe", cities: ["Hamburg", "Leipzig", "Cologne"] },
  { country: "France", region: "Europe", cities: ["Lyon", "Lille", "Nantes"] },
  { country: "Netherlands", region: "Europe", cities: ["Utrecht", "Eindhoven"] },
  { country: "Spain", region: "Europe", cities: ["Valencia", "Bilbao"] },
  { country: "Turkey", region: "Middle East", cities: ["Izmir", "Ankara", "Bursa"] },
  { country: "United Arab Emirates", region: "Middle East", cities: ["Dubai", "Abu Dhabi"] },
];
const PLACE_WEIGHTS = [34, 8, 9, 10, 7, 5, 5, 12, 10];

const SEGMENTS = ["Retail", "Hospitality", "Healthcare", "Education", "Corporate"];
const SEGMENT_WEIGHTS = [26, 20, 16, 14, 24];
const NAME_A = ["Harbor", "Northfield", "Cedar", "Summit", "Bluebell", "Ironwood", "Maple", "Silverline", "Riverside", "Oakmont", "Copper", "Lakeside", "Granite", "Willow", "Brightpath", "Fairview", "Kestrel", "Juniper", "Meridian", "Stonebridge", "Alder", "Larkspur", "Redwood", "Seabrook"];
const NAME_B: Record<string, string[]> = {
  Retail: ["Market", "Goods", "Outfitters", "Trading", "Mercantile"],
  Hospitality: ["Hotel", "Cafe", "Bistro", "Inn", "Kitchen"],
  Healthcare: ["Dental", "Clinic", "Pharmacy", "Medical Group", "Care"],
  Education: ["Academy", "School", "College", "Learning Center", "Institute"],
  Corporate: ["Partners", "Consulting", "Logistics", "Labs", "Holdings"],
};

const CATALOG: Array<{ category: string; items: Array<[string, number]> }> = [
  { category: "Office supplies", items: [["Copy paper A4, 5 reams", 32], ["Ballpoint pens, box of 50", 14], ["Sticky notes, 12 pads", 9], ["Lever arch files, 10", 26], ["Stapler, heavy duty", 19], ["Whiteboard markers, 8", 11], ["Desk organiser", 23], ["Printer toner, black", 74], ["Envelopes C4, 250", 38], ["Notebooks A5, 10", 21]] },
  { category: "Cleaning", items: [["Surface cleaner, 5 L", 18], ["Hand soap refill, 4 L", 15], ["Microfibre cloths, 24", 17], ["Floor cleaner, 10 L", 29], ["Disinfectant wipes, 6 tubs", 24], ["Trash bags, 200", 22], ["Mop and bucket set", 46], ["Glass cleaner, 5 L", 16]] },
  { category: "Packaging", items: [["Shipping boxes, medium, 50", 41], ["Packing tape, 36 rolls", 33], ["Bubble wrap roll, 100 m", 37], ["Mailer bags, 500", 44], ["Pallet wrap, 6 rolls", 52], ["Void fill paper, 10 kg", 28]] },
  { category: "Breakroom", items: [["Coffee beans, 6 kg", 96], ["Tea assortment, 400 bags", 34], ["Paper cups, 1000", 31], ["Sugar sticks, 2000", 19], ["Bottled water, 48", 21], ["Oat milk, 12 L", 27], ["Snack box, 60 pieces", 49]] },
  { category: "Furniture", items: [["Task chair, mesh", 189], ["Standing desk frame", 340], ["Filing cabinet, 3 drawer", 158], ["Meeting table, 8 seat", 620], ["Monitor arm, dual", 89], ["Bookcase, 5 shelf", 132]] },
  { category: "Electronics", items: [["Wireless keyboard and mouse", 58], ["27 in monitor", 229], ["USB-C dock", 149], ["Headset with mic", 79], ["Label printer", 119], ["Power strip, 8 way", 24], ["Webcam 1080p", 64]] },
];

const EXPENSE_CATEGORIES: Array<{ category: string; department: string; vendors: string[]; min: number; max: number; perMonth: number }> = [
  { category: "Software", department: "Operations", vendors: ["Ledgerline", "Stackwise", "Cloudmere", "Formstack Pro"], min: 90, max: 1400, perMonth: 4 },
  { category: "Marketing", department: "Marketing", vendors: ["Brightads", "Northpost Print", "Eventhall Expo", "Searchlift"], min: 300, max: 6500, perMonth: 3 },
  { category: "Travel", department: "Sales", vendors: ["Skyway Air", "Railconnect", "Harbor Hotels", "Citycab"], min: 80, max: 2200, perMonth: 6 },
  { category: "Shipping", department: "Operations", vendors: ["Parcelwise", "Freightline", "Fastlane Couriers"], min: 150, max: 3800, perMonth: 5 },
  { category: "Utilities", department: "Operations", vendors: ["Gridpower Energy", "Clearwater Utilities", "Fibrenet"], min: 220, max: 1600, perMonth: 3 },
  { category: "Office", department: "Finance", vendors: ["Deskside Supplies", "Cleanspace Services", "Snackbox Co."], min: 40, max: 900, perMonth: 3 },
  { category: "Meals", department: "Sales", vendors: ["Corner Bistro", "Green Fork Catering", "Bean & Leaf"], min: 25, max: 480, perMonth: 5 },
];

export interface SeedSummary {
  sql: string;
  counts: Record<string, number>;
  start: string;
  today: string;
}

/** Builds the whole database as one SQL script (schema plus inserts). */
export function buildSeed({ today, seed = 20261105 }: SeedOptions): SeedSummary {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const weighted = <T,>(xs: T[], w: number[]) => {
    let x = r() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < xs.length; i++) if ((x -= w[i]) < 0) return xs[i];
    return xs[xs.length - 1];
  };
  const between = (a: number, b: number) => a + r() * (b - a);
  const out: string[] = [SCHEMA_SQL];
  const insert = (table: string, rows: Array<Array<string | number | null>>) => {
    for (let i = 0; i < rows.length; i += 400) out.push(`INSERT INTO ${table} VALUES ${rows.slice(i, i + 400).map((row) => `(${row.map(q).join(",")})`).join(",")};`);
  };

  // Three full years back from the start of the month three years ago.
  const t = toDate(today);
  const start = iso(new Date(Date.UTC(t.getUTCFullYear() - 3, t.getUTCMonth(), 1)));
  const span = Math.round((t.getTime() - toDate(start).getTime()) / DAY);

  // Employees
  const used = new Set<string>();
  const person = () => {
    for (;;) {
      const n = `${pick(FIRST)} ${pick(LAST)}`;
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
  };
  const employees: Array<{ id: number; name: string; role: string; region: string }> = [];
  const staff: Array<[string, string, number]> = [
    ["Sales rep", "North America", 4],
    ["Sales rep", "Europe", 4],
    ["Sales rep", "Middle East", 2],
    ["Account manager", "North America", 1],
    ["Account manager", "Europe", 1],
    ["Account manager", "Middle East", 1],
    ["Finance", "North America", 2],
    ["Operations", "Europe", 2],
    ["Marketing", "North America", 1],
  ];
  for (const [role, region, n] of staff) for (let i = 0; i < n; i++) employees.push({ id: employees.length + 1, name: person(), role, region });
  insert(
    "employees",
    employees.map((e) => {
      const [f, l] = e.name.toLowerCase().split(" ");
      return [e.id, e.name, e.role, e.region, `${f}.${l}@brightwater.example`, addDays(start, -Math.floor(between(60, 2400)))];
    }),
  );
  const repsIn = (region: string) => employees.filter((e) => e.role === "Sales rep" && e.region === region);

  // Customers: most exist from the start, the rest sign up over the three years.
  const customers: Array<{ id: number; segment: string; size: number; since: string; churn: string | null }> = [];
  const customerRows: Array<Array<string | number | null>> = [];
  const names = new Set<string>();
  for (let id = 1; id <= 240; id++) {
    const segment = weighted(SEGMENTS, SEGMENT_WEIGHTS);
    let name = "";
    do name = `${pick(NAME_A)} ${pick(NAME_B[segment])}`;
    while (names.has(name));
    names.add(name);
    const place = weighted(PLACES, PLACE_WEIGHTS);
    const since = id <= 150 ? addDays(start, -Math.floor(between(30, 900))) : addDays(start, Math.floor(between(0, span - 20)));
    // Order size: a few big accounts, many small ones.
    const size = Math.exp(between(Math.log(300), Math.log(9000))) * (segment === "Corporate" ? 1.5 : segment === "Hospitality" ? 1.1 : 1);
    const churn = r() < 0.12 ? addDays(since, Math.floor(between(120, 900))) : null;
    const status = churn && churn < today ? "inactive" : "active";
    customers.push({ id, segment, size, since, churn });
    const rep = pick(repsIn(place.region));
    customerRows.push([id, name, segment, place.country, pick(place.cities), place.region, rep.id, Math.round(size * 4 / 500) * 500 + 1000, status, since]);
  }
  insert("customers", customerRows);

  // Products
  const products: Array<{ id: number; price: number; cost: number; category: string }> = [];
  const productRows: Array<Array<string | number | null>> = [];
  for (const { category, items } of CATALOG) {
    for (const [name, price] of items) {
      const id = products.length + 1;
      const cost = round2(price * between(0.48, 0.72));
      products.push({ id, price, cost, category });
      productRows.push([id, `${category.slice(0, 3).toUpperCase()}-${String(1000 + id)}`, name, category, price, cost, r() < 0.08 ? 0 : 1]);
    }
  }
  // A few products were added to the catalog recently and have not sold yet.
  const unsold = new Set([products.length - 1, Math.floor(products.length / 2), 9]);
  const sellable = products.filter((p) => !unsold.has(p.id));
  for (const id of unsold) productRows[id - 1][6] = 0;
  insert("products", productRows);

  // Invoices, lines and payments
  const invoiceRows: Array<Array<string | number | null>> = [];
  const lineRows: Array<Array<string | number | null>> = [];
  const paymentRows: Array<Array<string | number | null>> = [];
  const perYear = new Map<number, number>();
  const methods = ["Bank transfer", "Card", "ACH", "Check"];
  const methodWeights = [44, 30, 18, 8];
  const events: Array<{ customer: (typeof customers)[number]; day: string }> = [];
  for (const c of customers) {
    // Orders roughly every 2 to 6 weeks, more often for bigger accounts.
    const every = between(14, 45) / Math.min(1.6, Math.max(0.7, c.size / 2500));
    let d = c.since > start ? c.since : addDays(start, Math.floor(between(0, every)));
    while (d <= today) {
      if (c.churn && d > c.churn) break;
      events.push({ customer: c, day: d });
      d = addDays(d, Math.max(5, Math.round(every * between(0.6, 1.4))));
    }
  }
  events.sort((a, b) => a.day.localeCompare(b.day) || a.customer.id - b.customer.id);
  let lineId = 1;
  let paymentId = 1;
  events.forEach(({ customer: c, day }, i) => {
    const id = i + 1;
    const year = Number(day.slice(0, 4));
    const seq = (perYear.get(year) ?? 0) + 1;
    perYear.set(year, seq);
    const month = Number(day.slice(5, 7));
    // Growth over time and a busier fourth quarter.
    const growth = 1 + 0.18 * ((toDate(day).getTime() - toDate(start).getTime()) / (365 * DAY));
    const season = month >= 10 ? 1.25 : month <= 2 ? 0.85 : 1;
    const target = c.size * growth * season * between(0.5, 1.5);
    let subtotal = 0;
    const n = 1 + Math.floor(r() * 5);
    const chosen = new Set<number>();
    for (let k = 0; k < n; k++) {
      const p = c.segment === "Hospitality" && r() < 0.5 ? pick(sellable.filter((x) => x.category === "Breakroom" || x.category === "Cleaning")) : pick(sellable);
      if (chosen.has(p.id)) continue;
      chosen.add(p.id);
      const qty = Math.max(1, Math.round(target / n / p.price));
      const discount = qty >= 40 ? 10 : qty >= 20 ? 5 : 0;
      const lineTotal = round2(qty * p.price * (1 - discount / 100));
      subtotal += lineTotal;
      lineRows.push([lineId++, id, p.id, qty, p.price, discount, lineTotal]);
    }
    subtotal = round2(subtotal);
    const tax = round2(subtotal * 0.08);
    const total = round2(subtotal + tax);
    const terms = c.segment === "Corporate" || c.segment === "Education" ? 45 : 30;
    const due = addDays(day, terms);
    const age = (t.getTime() - toDate(day).getTime()) / DAY;
    let status: string;
    if (r() < 0.012) status = "void";
    else {
      // Older invoices are almost all paid; recent ones are often still open.
      const late = c.segment === "Hospitality" ? 1.6 : 1;
      const payDelay = Math.round(terms * between(0.3, 1.25) * late + (r() < 0.07 ? between(20, 90) : 0));
      const paidOn = addDays(day, payDelay);
      if (paidOn <= today && !(age > 120 && r() < 0.015)) {
        status = "paid";
        if (r() < 0.12) {
          const first = round2(total * between(0.3, 0.7));
          paymentRows.push([paymentId++, id, addDays(day, Math.round(payDelay * 0.5)), first, weighted(methods, methodWeights)]);
          paymentRows.push([paymentId++, id, paidOn, round2(total - first), weighted(methods, methodWeights)]);
        } else paymentRows.push([paymentId++, id, paidOn, total, weighted(methods, methodWeights)]);
      } else {
        status = due < today ? "overdue" : "open";
        if (r() < 0.15 && age > 10) paymentRows.push([paymentId++, id, addDays(day, Math.min(Math.floor(age), Math.round(between(5, 25)))), round2(total * between(0.2, 0.5)), weighted(methods, methodWeights)]);
      }
    }
    invoiceRows.push([id, `INV-${year}-${String(seq).padStart(4, "0")}`, c.id, day, due, status, subtotal, tax, total]);
  });
  insert("invoices", invoiceRows);
  insert("invoice_lines", lineRows);
  insert("payments", paymentRows);

  // Expenses: fixed monthly costs plus a spread of smaller ones.
  const expenseRows: Array<Array<string | number | null>> = [];
  let expenseId = 1;
  for (let m = toDate(start); iso(m) <= today; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const first = iso(m);
    const growth = 1 + 0.12 * ((m.getTime() - toDate(start).getTime()) / (365 * DAY));
    const finance = employees.find((e) => e.role === "Finance")!;
    expenseRows.push([expenseId++, first, "Rent", "Dockside Properties", "Operations", 12500, finance.id]);
    const payday = addDays(first, 24);
    if (payday <= today) expenseRows.push([expenseId++, payday, "Payroll", "Brightwater payroll", "Finance", round2(96000 * growth * between(0.98, 1.03)), finance.id]);
    for (const e of EXPENSE_CATEGORIES) {
      const n = Math.max(1, Math.round(e.perMonth * between(0.6, 1.4)));
      for (let k = 0; k < n; k++) {
        const d = addDays(first, Math.floor(between(0, 28)));
        if (d > today) continue;
        const who = e.department === "Sales" ? pick(employees.filter((x) => x.role === "Sales rep")) : pick(employees.filter((x) => x.role !== "Sales rep"));
        expenseRows.push([expenseId++, d, e.category, pick(e.vendors), e.department, round2(Math.exp(between(Math.log(e.min), Math.log(e.max))) * growth), who.id]);
      }
    }
  }
  expenseRows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  expenseRows.forEach((row, i) => (row[0] = i + 1));
  insert("expenses", expenseRows);

  return {
    sql: out.join("\n"),
    counts: {
      employees: employees.length,
      customers: customerRows.length,
      products: productRows.length,
      invoices: invoiceRows.length,
      invoice_lines: lineRows.length,
      payments: paymentRows.length,
      expenses: expenseRows.length,
    },
    start,
    today,
  };
}
