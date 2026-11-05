"use client";

import type { SqlJsStatic } from "sql.js";
import { Db } from "./db";
import { importTables, inferModel, type ImportNote, type RawTable } from "./import/infer";
import { readFile } from "./import/read";
import { demoModel, type Model } from "./model";
import { buildSeed } from "./seed";

/**
 * The browser side: loads SQLite (WebAssembly), builds the demo database, imports uploads and
 * keeps uploaded datasets in IndexedDB so they survive a reload. Nothing leaves the browser.
 */

export interface Dataset {
  id: string;
  name: string;
  kind: "demo" | "upload";
  db: Db;
  model: Model;
  notes: ImportNote[];
  createdAt: string;
  /** Files it was built from. */
  sources: string[];
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
let sqlPromise: Promise<SqlJsStatic> | null = null;

export function sqlite(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = import("sql.js").then((m) => m.default({ locateFile: () => `${BASE}/sql-wasm.wasm` }));
    sqlPromise.catch(() => (sqlPromise = null));
  }
  return sqlPromise;
}

/** Today in the visitor's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function loadDemo(today = localToday()): Promise<Dataset> {
  const SQL = await sqlite();
  const seed = buildSeed({ today });
  const db = Db.create(SQL, seed.sql);
  return { id: "demo", name: "Brightwater Supply Co.", kind: "demo", db, model: demoModel(db, today), notes: [], createdAt: today, sources: [] };
}

export interface ImportOutcome {
  dataset: Dataset | null;
  errors: Array<{ file: string; en: string; tr: string }>;
}

/** Turns uploaded files into one dataset; several CSVs become related tables. */
export async function importFiles(files: File[], today = localToday()): Promise<ImportOutcome> {
  const SQL = await sqlite();
  const raws: RawTable[] = [];
  const notes: ImportNote[] = [];
  const errors: ImportOutcome["errors"] = [];
  let sqliteDb: { bytes: Uint8Array; name: string } | null = null;
  for (const f of files) {
    const r = await readFile(f);
    if (r.kind === "error") errors.push({ file: f.name, en: r.en, tr: r.tr });
    else if (r.kind === "sqlite") {
      if (sqliteDb) errors.push({ file: f.name, en: "Upload one SQLite database at a time.", tr: "Tek seferde bir SQLite veritabanı yükleyin." });
      else sqliteDb = { bytes: r.bytes, name: r.name };
    } else {
      raws.push(...r.tables);
      notes.push(...r.notes);
    }
  }
  if (sqliteDb) {
    let db: Db;
    try {
      db = Db.create(SQL, undefined, sqliteDb.bytes);
      db.tables();
    } catch {
      return { dataset: null, errors: [...errors, { file: sqliteDb.name, en: "This SQLite file could not be opened; it may be damaged or encrypted.", tr: "Bu SQLite dosyası açılamadı; bozuk ya da şifreli olabilir." }] };
    }
    const tables = db.tables();
    if (!tables.length) return { dataset: null, errors: [...errors, { file: sqliteDb.name, en: "This SQLite database has no tables.", tr: "Bu SQLite veritabanında tablo yok." }] };
    const model = inferModel(db, today, tables.map((t) => ({ table: t })));
    const ds: Dataset = { id: `ds-${Date.now()}`, name: sqliteDb.name, kind: "upload", db, model, notes, createdAt: today, sources: [sqliteDb.name] };
    await save(ds);
    return { dataset: ds, errors };
  }
  if (!raws.length) return { dataset: null, errors };
  const imported = importTables(SQL, raws, today);
  if (!imported.tables.length) return { dataset: null, errors: [...errors, { file: files.map((f) => f.name).join(", "), en: "No table with data was found.", tr: "Veri içeren tablo bulunamadı." }] };
  const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `${files.length} files`;
  const ds: Dataset = { id: `ds-${Date.now()}`, name, kind: "upload", db: imported.db, model: imported.model, notes: [...notes, ...imported.notes], createdAt: today, sources: files.map((f) => f.name) };
  await save(ds);
  return { dataset: ds, errors };
}

// ---- IndexedDB persistence for uploads ----
const DB_NAME = "quarry";
const STORE = "datasets";

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface Stored {
  id: string;
  name: string;
  bytes: Uint8Array;
  notes: ImportNote[];
  createdAt: string;
  sources: string[];
  /** Column labels as uploaded ("Order Date"), keyed by table. */
  labels: Record<string, Record<string, string>>;
}

async function save(ds: Dataset) {
  const db = await idb();
  if (!db) return;
  const labels = Object.fromEntries(ds.model.tables.map((t) => [t.name, Object.fromEntries(t.columns.map((c) => [c.name, c.label]))]));
  const rec: Stored = { id: ds.id, name: ds.name, bytes: ds.db.raw.export(), notes: ds.notes, createdAt: ds.createdAt, sources: ds.sources, labels };
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function listSaved(): Promise<Array<{ id: string; name: string; createdAt: string; sources: string[] }>> {
  const db = await idb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as Stored[]).map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, sources: r.sources })));
    req.onerror = () => resolve([]);
  });
}

export async function openSaved(id: string, today = localToday()): Promise<Dataset | null> {
  const db = await idb();
  if (!db) return null;
  const rec = await new Promise<Stored | null>((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Stored) ?? null);
    req.onerror = () => resolve(null);
  });
  if (!rec) return null;
  const SQL = await sqlite();
  const d = Db.create(SQL, undefined, rec.bytes);
  const model = inferModel(d, today, d.tables().map((t) => ({ table: t, labels: rec.labels?.[t] })));
  return { id: rec.id, name: rec.name, kind: "upload", db: d, model, notes: rec.notes, createdAt: rec.createdAt, sources: rec.sources };
}

export async function removeSaved(id: string) {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
