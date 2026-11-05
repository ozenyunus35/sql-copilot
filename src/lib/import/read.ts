import { decodeText, parseCsv } from "./csv";
import type { ImportNote, RawTable } from "./infer";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type ReadResult =
  | { kind: "tables"; tables: RawTable[]; notes: ImportNote[] }
  | { kind: "sqlite"; bytes: Uint8Array; name: string; notes: ImportNote[] }
  | { kind: "error"; en: string; tr: string };

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);
const ascii = (b: Uint8Array, n: number) => String.fromCharCode(...b.slice(0, n));
const base = (name: string) => name.replace(/\.[^.]+$/, "");

type Cell = string | number | boolean | Date | null;

/** Reads an uploaded file into tables, or explains why it can't. */
export async function readFile(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ReadResult> {
  const name = file.name;
  if (file.size === 0) return { kind: "error", en: `${name} is empty.`, tr: `${name} boş.` };
  if (file.size > MAX_FILE_BYTES) return { kind: "error", en: `${name} is ${(file.size / 1048576).toFixed(0)} MB. The limit is 50 MB, because everything runs in your browser.`, tr: `${name} ${(file.size / 1048576).toFixed(0)} MB. Her şey tarayıcıda çalıştığı için sınır 50 MB.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();

  // Recognise the real format from the first bytes, whatever the extension says.
  if (ascii(bytes, 15) === "SQLite format 3") return { kind: "sqlite", bytes, name: base(name), notes: [] };
  if (ascii(bytes, 5) === "%PDF-") return { kind: "error", en: `${name} is a PDF. Quarry reads tables from CSV, Excel (.xlsx), JSON and SQLite files; export the table to one of those first.`, tr: `${name} bir PDF. Quarry tabloları CSV, Excel (.xlsx), JSON ve SQLite dosyalarından okur; tabloyu önce bunlardan birine aktarın.` };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || ascii(bytes, 4) === "GIF8" || (ascii(bytes, 4) === "RIFF" && ascii(bytes.slice(8), 4) === "WEBP")) return { kind: "error", en: `${name} is an image. Quarry needs a data file: CSV, Excel (.xlsx), JSON or SQLite.`, tr: `${name} bir görsel. Quarry bir veri dosyası bekliyor: CSV, Excel (.xlsx), JSON ya da SQLite.` };
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return { kind: "error", en: `${name} is an old Excel 97-2003 file (.xls). Open it in Excel and save it as .xlsx, then upload that.`, tr: `${name} eski bir Excel 97-2003 dosyası (.xls). Excel'de açıp .xlsx olarak kaydedin, sonra onu yükleyin.` };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 4000)));
    if (head.includes("word/")) return { kind: "error", en: `${name} is a Word document. Copy the table into Excel and save it as .xlsx or .csv.`, tr: `${name} bir Word belgesi. Tabloyu Excel'e kopyalayıp .xlsx ya da .csv olarak kaydedin.` };
    if (head.includes("ppt/")) return { kind: "error", en: `${name} is a PowerPoint file, not a data file.`, tr: `${name} bir PowerPoint dosyası, veri dosyası değil.` };
    if (ext === "ods" || head.includes("opendocument")) return { kind: "error", en: `${name} is an OpenDocument spreadsheet. Save it as .xlsx or .csv first.`, tr: `${name} bir OpenDocument tablosu. Önce .xlsx ya da .csv olarak kaydedin.` };
    return readXlsx(bytes, name);
  }
  if (ext === "xlsx" || ext === "xlsm") return { kind: "error", en: `${name} is not a valid Excel file; it may be damaged or password-protected.`, tr: `${name} geçerli bir Excel dosyası değil; bozuk ya da parolalı olabilir.` };

  // Text formats
  const { text, encoding } = decodeText(bytes);
  if (/\u0000/.test(text.slice(0, 2000))) return { kind: "error", en: `${name} is a binary file that Quarry can't read. Use CSV, Excel (.xlsx), JSON or SQLite.`, tr: `${name} Quarry'nin okuyamadığı ikili bir dosya. CSV, Excel (.xlsx), JSON ya da SQLite kullanın.` };
  const notes: ImportNote[] = encoding !== "UTF-8" ? [{ level: "info", en: `${name} was read as ${encoding}.`, tr: `${name} ${encoding} kodlamasıyla okundu.` }] : [];
  const trimmed = text.trimStart();
  if (ext === "json" || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const j = readJson(trimmed, name);
    if (j.kind === "tables") j.notes.unshift(...notes);
    return j;
  }
  if (/^\s*<(!doctype|html|\?xml)/i.test(trimmed)) return { kind: "error", en: `${name} is an HTML or XML file, not a table. Export the data as CSV.`, tr: `${name} bir HTML ya da XML dosyası, tablo değil. Veriyi CSV olarak dışa aktarın.` };
  const rows = parseCsv(text);
  if (rows.length < 1 || rows.every((r) => r.length < 2)) {
    if (rows.length > 1 && rows.every((r) => r.length === 1)) return { kind: "tables", tables: [{ name: base(name), rows, source: name }], notes };
    return { kind: "error", en: `${name} doesn't look like a table: no separators (comma, semicolon, tab) were found.`, tr: `${name} bir tabloya benzemiyor: ayırıcı (virgül, noktalı virgül, sekme) bulunamadı.` };
  }
  return { kind: "tables", tables: [{ name: base(name), rows, source: name }], notes };
}

async function readXlsx(bytes: Uint8Array, name: string): Promise<ReadResult> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    return { kind: "error", en: `${name} could not be opened as an Excel file; it may be damaged or password-protected.`, tr: `${name} Excel dosyası olarak açılamadı; bozuk ya da parolalı olabilir.` };
  }
  const tables: RawTable[] = [];
  const notes: ImportNote[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const out: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        out[col - 1] = cellValue(cell.value);
      });
      rows.push(Array.from(out, (v) => v ?? null));
    });
    if (!rows.length) return;
    if (ws.state === "hidden" || ws.state === "veryHidden") notes.push({ level: "info", en: `Included hidden sheet “${ws.name}”.`, tr: `Gizli sayfa “${ws.name}” de alındı.` });
    tables.push({ name: wb.worksheets.length > 1 ? ws.name : base(name), rows, source: `${name} › ${ws.name}` });
  });
  if (!tables.length) return { kind: "error", en: `${name} has no data on any sheet.`, tr: `${name} hiçbir sayfada veri içermiyor.` };
  return { kind: "tables", tables, notes };
}

function cellValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellValue(o.result);
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((x) => x.text).join("");
    if ("text" in o) return cellValue(o.text);
    if ("error" in o) return null;
  }
  return String(v);
}

function readJson(text: string, name: string): ReadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // JSON Lines: one object per line.
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    try {
      data = lines.map((l) => JSON.parse(l));
    } catch {
      return { kind: "error", en: `${name} is not valid JSON (${(e as Error).message.slice(0, 80)}).`, tr: `${name} geçerli bir JSON değil (${(e as Error).message.slice(0, 80)}).` };
    }
  }
  const tables: RawTable[] = [];
  const toTable = (tname: string, arr: unknown[]) => {
    const objs = arr.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Array<Record<string, unknown>>;
    if (!objs.length) return;
    const flat = objs.map((o) => flatten(o));
    const keys = [...new Set(flat.flatMap((o) => Object.keys(o)))];
    tables.push({ name: tname, rows: [keys, ...flat.map((o) => keys.map((k) => o[k] ?? null))], source: name });
  };
  if (Array.isArray(data)) toTable(base(name), data);
  else if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (Array.isArray(v)) toTable(k, v);
    if (!tables.length) toTable(base(name), [data]);
  }
  if (!tables.length) return { kind: "error", en: `${name} has no list of records to turn into a table.`, tr: `${name} tabloya dönüştürülecek bir kayıt listesi içermiyor.` };
  return { kind: "tables", tables, notes: [] };
}

function flatten(o: Record<string, unknown>, prefix = ""): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !prefix) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else if (Array.isArray(v)) out[key] = v.every((x) => typeof x !== "object") ? v.join(", ") : JSON.stringify(v);
    else if (v && typeof v === "object") out[key] = JSON.stringify(v);
    else out[key] = (v as Cell) ?? null;
  }
  return out;
}
