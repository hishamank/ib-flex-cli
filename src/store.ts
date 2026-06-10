import Database from "better-sqlite3";
import type { ParsedQuery, Row } from "./flex/parse.js";

/**
 * A deliberately generic store: every row of every section lands in one table
 * as JSON, tagged by query/section/account/fetch. This keeps "covers everything"
 * true without a schema per section. You can build views/materialised tables on
 * top later if you want typed columns for specific sections.
 */
export class Store {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fetch_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        query      TEXT NOT NULL,
        account    TEXT,
        from_date  TEXT,
        to_date    TEXT,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rows (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fetch_id   INTEGER NOT NULL REFERENCES fetch_log(id),
        query      TEXT NOT NULL,
        account    TEXT,
        section    TEXT NOT NULL,
        data       TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rows_section ON rows(section);
      CREATE INDEX IF NOT EXISTS idx_rows_query   ON rows(query);
    `);
  }

  /** Persist a parsed query as a new immutable snapshot. Returns row count. */
  save(query: string, parsed: ParsedQuery): number {
    const now = new Date().toISOString();
    const insertFetch = this.db.prepare(
      `INSERT INTO fetch_log(query, account, from_date, to_date, fetched_at)
       VALUES (?,?,?,?,?)`
    );
    const insertRow = this.db.prepare(
      `INSERT INTO rows(fetch_id, query, account, section, data, fetched_at)
       VALUES (?,?,?,?,?,?)`
    );

    const tx = this.db.transaction(() => {
      let count = 0;
      for (const stmt of parsed.statements) {
        const info = insertFetch.run(
          query,
          stmt.account,
          stmt.fromDate ?? null,
          stmt.toDate ?? null,
          now
        );
        const fetchId = info.lastInsertRowid as number;
        for (const section of stmt.sections) {
          for (const row of section.rows) {
            insertRow.run(fetchId, query, stmt.account, section.name, JSON.stringify(row), now);
            count++;
          }
        }
      }
      return count;
    });

    return tx();
  }

  /** Most recent cached rows for a section (optionally scoped to a query). */
  latestSection(section: string, query?: string): Row[] {
    const fetchRow = this.db
      .prepare(
        `SELECT fetch_id FROM rows
         WHERE section = ? ${query ? "AND query = ?" : ""}
         ORDER BY fetched_at DESC LIMIT 1`
      )
      .get(...(query ? [section, query] : [section])) as
      | { fetch_id: number }
      | undefined;

    if (!fetchRow) return [];

    const rows = this.db
      .prepare(`SELECT data FROM rows WHERE fetch_id = ? AND section = ?`)
      .all(fetchRow.fetch_id, section) as { data: string }[];

    return rows.map((r) => JSON.parse(r.data) as Row);
  }

  close(): void {
    this.db.close();
  }
}
