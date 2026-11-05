import ExcelJS from "exceljs";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { importTables, inferModel, type RawTable } from "@/lib/import/infer";
import { readFile } from "@/lib/import/read";
import { Db } from "@/lib/db";
import { parse } from "@/lib/nl/parse";
import { toSql } from "@/lib/nl/sql";

const TODAY = "2026-11-05";
const file = (name: string, data: string | Uint8Array) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
};
/** Windows-1254 bytes for a Turkish string (only the letters these tests use). */
function win1254(s: string) {
  const map: Record<string, number> = { ş: 0xfe, Ş: 0xde, ğ: 0xf0, Ğ: 0xd0, ı: 0xfd, İ: 0xdd, ü: 0xfc, Ü: 0xdc, ö: 0xf6, Ö: 0xd6, ç: 0xe7, Ç: 0xc7 };
  return Uint8Array.from([...s].map((c) => map[c] ?? c.charCodeAt(0)));
}

async function load(files: Array<ReturnType<typeof file>>) {
  const SQL = await initSqlJs();
  const raws: RawTable[] = [];
  for (const f of files) {
    const r = await readFile(f);
    if (r.kind !== "tables") throw new Error(`unexpected ${r.kind}: ${"en" in r ? r.en : ""}`);
    raws.push(...r.tables);
  }
  return importTables(SQL, raws, TODAY);
}

function ask(d: { db: Db; model: ReturnType<typeof inferModel> }, q: string) {
  const r = parse(q, d.model);
  if (!r.ok) throw new Error(`no answer for "${q}": ${r.reason?.en}`);
  const { sql } = toSql(d.model, r.plan!);
  return { sql, res: d.db.run(sql), plan: r.plan! };
}

const TR_CSV = `Sipariş No;Müşteri;Şehir;Tarih;Tutar;Adet;Ödendi
S-1001;Ayşe Yılmaz;İzmir;03.01.2025;1.250,50;3;Evet
S-1002;Mehmet Öztürk;Ankara;15.01.2025;980,00;1;Hayır
S-1003;Ayşe Yılmaz;İzmir;02.02.2025;2.400,75;5;Evet
S-1004;Zeynep Çelik;İstanbul;28.02.2025;310,25;2;Evet
S-1005;Mehmet Öztürk;Ankara;11.03.2025;5.120,00;8;Hayır
S-1006;Can Doğan;İzmir;19.03.2025;760,40;2;Evet
`;

describe("reading files", () => {
  it("reads a Turkish CSV: semicolons, decimal commas, day-first dates, Windows-1254", async () => {
    const d = await load([file("satışlar.csv", win1254(TR_CSV))]);
    const t = d.model.tables[0];
    expect(t.name).toBe("satislar");
    const cols = Object.fromEntries(t.columns.map((c) => [c.name, c]));
    expect(cols.tutar.type).toBe("real");
    expect(cols.tutar.role).toBe("money");
    expect(cols.tarih.type).toBe("date");
    expect(cols.adet.role).toBe("quantity");
    expect(cols.musteri.label).toBe("Müşteri");
    expect(d.db.value("SELECT SUM(tutar) FROM satislar")).toBeCloseTo(10821.9, 2);
    expect(d.db.value("SELECT MIN(tarih) FROM satislar")).toBe("2025-01-03");
    expect(d.db.value("SELECT SUM(odendi) FROM satislar")).toBe(4);
    // Questions in Turkish over it.
    expect(ask(d, "toplam tutar").res.rows[0][0]).toBeCloseTo(10821.9, 2);
    const byCity = ask(d, "şehirlere göre toplam tutar");
    expect(byCity.res.rows[0]).toEqual(["Ankara", 6100]);
    const monthly = ask(d, "aylık toplam tutar");
    expect(monthly.res.rows.map((r) => r[0])).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(ask(d, "İzmir'deki siparişlerin toplam tutarı").res.rows[0][0]).toBeCloseTo(4411.65, 2);
  });

  it("reads a US CSV: quoted commas and line breaks, $ amounts, month-first dates, (negatives)", async () => {
    const csv = `Order ID,Customer,Notes,Order Date,Amount,Region\n1,"Acme, Inc.","Rush order\nsecond line",03/14/2025,"$1,234.56",West\n2,Globex,,03/02/2025,$99.00,East\n3,"Acme, Inc.",refund,04/01/2025,($50.00),West\n4,Initech,"He said ""ok""",12/25/2025,"$2,000.00",East\n`;
    const d = await load([file("orders.csv", csv)]);
    const t = d.model.tables[0];
    expect(t.columns.find((c) => c.name === "order_date")?.type).toBe("date");
    expect(d.db.value("SELECT order_date FROM orders WHERE order_id = 1")).toBe("2025-03-14");
    expect(d.db.value("SELECT amount FROM orders WHERE order_id = 3")).toBe(-50);
    expect(d.db.value("SELECT notes FROM orders WHERE order_id = 1")).toBe("Rush order\nsecond line");
    expect(d.db.value("SELECT notes FROM orders WHERE order_id = 4")).toBe('He said "ok"');
    expect(ask(d, "total amount by region").res.rows).toEqual([
      ["East", 2099],
      ["West", 1184.56],
    ]);
  });

  it("links two CSVs by their id columns and joins them in answers", async () => {
    const customers = `customer_id,name,country,segment\n1,Northwind Traders,Germany,Retail\n2,Blue Harbor,France,Hospitality\n3,Atlas Foods,Germany,Retail\n`;
    const orders = `order_id,customer_id,order_date,total\n10,1,2025-01-05,100\n11,1,2025-02-05,250\n12,2,2025-02-07,80\n13,3,2025-03-01,40\n14,3,2025-03-09,60\n`;
    const d = await load([file("customers.csv", customers), file("orders.csv", orders)]);
    expect(d.model.relations).toEqual([{ from: { table: "orders", column: "customer_id" }, to: { table: "customers", column: "customer_id" } }]);
    const byCountry = ask(d, "total by country");
    expect(byCountry.sql).toContain("JOIN customers");
    expect(byCountry.res.rows).toEqual([
      ["Germany", 450],
      ["France", 80],
    ]);
    // "top customers" ranks by the orders' total.
    const top = ask(d, "top 2 customers");
    expect(top.res.rows.map((r) => r[0])).toEqual(["Northwind Traders", "Atlas Foods"]);
    expect(ask(d, "how many orders").res.rows[0][0]).toBe(5);
  });

  it("reads Excel: several sheets, a title above the header, formulas and real dates", async () => {
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet("Invoices");
    s1.addRow(["Q1 invoice report"]);
    s1.addRow([]);
    s1.addRow(["Invoice", "Client", "Issued", "Net", "VAT", "Gross"]);
    s1.addRow(["F-1", "Kestrel Ltd", new Date(Date.UTC(2025, 0, 10)), 100, 20, { formula: "D4+E4", result: 120 }]);
    s1.addRow(["F-2", "Larkspur GmbH", new Date(Date.UTC(2025, 1, 3)), 250.5, 50.1, { formula: "D5+E5", result: 300.6 }]);
    const s2 = wb.addWorksheet("Clients");
    s2.addRow(["Client", "Country"]);
    s2.addRow(["Kestrel Ltd", "UK"]);
    s2.addRow(["Larkspur GmbH", "Germany"]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await readFile(file("report.xlsx", buf));
    expect(r.kind).toBe("tables");
    const d = await load([file("report.xlsx", buf)]);
    expect(d.model.tables.map((t) => t.name)).toEqual(["invoices", "clients"]);
    expect(d.notes.some((n) => /skipped 1 line above the header/.test(n.en))).toBe(true);
    expect(d.db.value("SELECT gross FROM invoices WHERE invoice = 'F-2'")).toBeCloseTo(300.6);
    expect(d.db.value("SELECT issued FROM invoices WHERE invoice = 'F-1'")).toBe("2025-01-10");
    expect(ask(d, "total gross").res.rows[0][0]).toBeCloseTo(420.6);
  });

  it("reads JSON records, flattening one level", async () => {
    const json = JSON.stringify([
      { id: 1, product: "Desk", price: 199.9, dims: { w: 120, d: 60 }, tags: ["office", "wood"] },
      { id: 2, product: "Lamp", price: 39.5, dims: { w: 20, d: 20 }, tags: ["office"] },
    ]);
    const d = await load([file("catalog.json", json)]);
    const cols = d.model.tables[0].columns.map((c) => c.name);
    expect(cols).toEqual(["id", "product", "price", "dims_w", "dims_d", "tags"]);
    expect(ask(d, "average price").res.rows[0][0]).toBeCloseTo(119.7, 1);
  });

  it("opens a SQLite database with its foreign keys", async () => {
    const SQL = await initSqlJs();
    const src = new SQL.Database();
    src.exec(`CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, team_id INTEGER REFERENCES teams(id), goals INTEGER);
      INSERT INTO teams VALUES (1,'Reds'),(2,'Blues'); INSERT INTO players VALUES (1,'Ana',1,5),(2,'Ben',1,3),(3,'Cem',2,7);`);
    const bytes = src.export();
    const r = await readFile(file("league.sqlite", bytes));
    expect(r.kind).toBe("sqlite");
    const db = Db.create(SQL, undefined, bytes);
    const model = inferModel(db, TODAY, db.tables().map((t) => ({ table: t })));
    expect(model.relations).toEqual([{ from: { table: "players", column: "team_id" }, to: { table: "teams", column: "id" } }]);
    const d = { db, model };
    expect(ask(d, "goals by team").res.rows).toEqual([
      ["Reds", 8],
      ["Blues", 7],
    ]);
  });
});

describe("files Quarry can't use", () => {
  const cases: Array<[string, string | Uint8Array, RegExp]> = [
    ["statement.pdf", "%PDF-1.7\n1 0 obj", /is a PDF/],
    ["photo.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), /is an image/],
    ["photo.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), /is an image/],
    ["old.xls", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), /old Excel 97-2003/],
    ["letter.docx", new TextEncoder().encode("PK\u0003\u0004....word/document.xml...."), /Word document/],
    ["page.html", "<!doctype html><html><body>hi</body></html>", /HTML or XML/],
    ["bad.json", "[{\"a\": 1,}", /not valid JSON/],
    ["empty.csv", "", /is empty/],
    ["fake.xlsx", "this is not excel", /not a valid Excel file/],
    ["blob.bin", Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0, 5, 0]), /binary file/],
  ];
  for (const [name, data, msg] of cases) {
    it(`explains ${name}`, async () => {
      const r = await readFile(file(name, data));
      expect(r.kind).toBe("error");
      if (r.kind === "error") {
        expect(r.en).toMatch(msg);
        expect(r.tr.length).toBeGreaterThan(10);
      }
    });
  }

  it("says when a CSV has a header but no rows", async () => {
    const SQL = await initSqlJs();
    const r = await readFile(file("only-header.csv", "a,b,c\n"));
    expect(r.kind).toBe("tables");
    if (r.kind === "tables") {
      const d = importTables(SQL, r.tables, TODAY);
      expect(d.tables).toHaveLength(0);
      expect(d.notes.some((n) => /no rows|header but no rows/.test(n.en))).toBe(true);
    }
  });

  it("keeps codes with leading zeros as text and leaves unreadable numbers empty with a note", async () => {
    const csv = `zip,amount\n01234,10\n02345,20\n00999,abc\n` + Array.from({ length: 60 }, (_, i) => `1${i},${i}`).join("\n");
    const d = await load([file("zips.csv", csv)]);
    const cols = Object.fromEntries(d.model.tables[0].columns.map((c) => [c.name, c]));
    expect(cols.zip.type).toBe("text");
    expect(cols.amount.type).toBe("integer");
    expect(d.notes.some((n) => /1 value could not be read as numbers/.test(n.en))).toBe(true);
  });
});
