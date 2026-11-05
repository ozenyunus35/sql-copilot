import type { Database, SqlJsStatic, SqlValue } from "sql.js";

export type Cell = SqlValue;

export interface QueryResult {
  columns: string[];
  rows: Cell[][];
  /** Rows changed by the last write statement, if any. */
  changes: number;
  ms: number;
  /** True when the result was cut at the row limit. */
  truncated: boolean;
}

export const MAX_ROWS = 5000;

/** A thin wrapper over a sql.js database: runs a script and returns the last result set. */
export class Db {
  constructor(readonly raw: Database) {}

  static create(sql: SqlJsStatic, script?: string, bytes?: Uint8Array) {
    const db = new Db(new sql.Database(bytes));
    db.raw.exec("PRAGMA foreign_keys = ON;");
    if (script) db.raw.exec(script);
    return db;
  }

  /** Runs every statement in [sql] and returns the last one that produced columns (or the last one). */
  run(sql: string, maxRows = MAX_ROWS): QueryResult {
    const started = performance.now();
    let last: QueryResult = { columns: [], rows: [], changes: 0, ms: 0, truncated: false };
    for (const stmt of this.raw.iterateStatements(sql)) {
      try {
        const columns = stmt.getColumnNames();
        const rows: Cell[][] = [];
        let truncated = false;
        while (stmt.step()) {
          if (rows.length >= maxRows) {
            truncated = true;
            break;
          }
          rows.push(stmt.get());
        }
        if (columns.length) last = { columns, rows, changes: 0, ms: 0, truncated };
        else last = { columns: [], rows: [], changes: this.raw.getRowsModified(), ms: 0, truncated: false };
      } finally {
        stmt.free();
      }
    }
    last.ms = performance.now() - started;
    return last;
  }

  /** One value from the first row, for small lookups. */
  value(sql: string): Cell {
    return this.run(sql, 1).rows[0]?.[0] ?? null;
  }

  tables(): string[] {
    return this.run("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").rows.map((r) => String(r[0]));
  }

  close() {
    this.raw.close();
  }
}
