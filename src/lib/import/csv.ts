/**
 * CSV / TSV reading for uploads: detects the delimiter (comma, semicolon, tab, pipe), handles
 * quoted fields with commas and line breaks, a UTF-8 byte order mark, and Windows Turkish or
 * Western encodings when the bytes are not valid UTF-8.
 */

export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  // UTF-8 (with or without BOM) first; fall back when the bytes are not valid UTF-8.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "UTF-8" };
  } catch {
    // Turkish files saved by Excel are usually Windows-1254; it is a superset of Latin-1 for letters.
    for (const enc of ["windows-1254", "windows-1252"]) {
      try {
        return { text: new TextDecoder(enc).decode(bytes), encoding: enc };
      } catch {
        // try the next one
      }
    }
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "UTF-8 (with errors)" };
  }
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = sample.map((l) => splitLine(l, d).length);
    if (!counts.length || counts[0] < 2) continue;
    // Consistent column counts across lines win.
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 10 + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Parses CSV text into rows of strings. Quoted fields may contain the delimiter and newlines. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
      continue;
    }
    if (c === '"' && cur.trim() === "") {
      q = true;
      cur = "";
    } else if (c === delimiter) {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
