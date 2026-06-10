import Database from "better-sqlite3";
import type { ParsedQuery, Row } from "./flex/parse.js";

/**
 * A deliberately generic store: every row of every section lands in one table
 * as JSON, tagged by query/section/account/batch. This keeps "covers everything"
 * true without a schema per section. You can build views/materialised tables on
 * top later if you want typed columns for specific sections.
 *
 * Each `save()` is one immutable snapshot identified by a monotonic `batch` id.
 * "Latest" is resolved from the batch id, never from row existence or wall-clock
 * time, so a section that used to have rows but is now empty does not serve
 * stale data, and two saves in the same millisecond never merge.
 */
export class Store {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fetch_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        batch      INTEGER,
        query      TEXT NOT NULL,
        account    TEXT,
        from_date  TEXT,
        to_date    TEXT,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rows (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fetch_id   INTEGER NOT NULL REFERENCES fetch_log(id),
        batch      INTEGER,
        query      TEXT NOT NULL,
        account    TEXT,
        section    TEXT NOT NULL,
        data       TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rows_section ON rows(section);
      CREATE INDEX IF NOT EXISTS idx_rows_query   ON rows(query);
      CREATE INDEX IF NOT EXISTS idx_rows_batch   ON rows(batch);
    `);
    this.migrate();
  }

  /**
   * Bring a pre-batch database forward: add the `batch` column where missing and
   * backfill it from each row's own fetch id. Idempotent — safe to run on every
   * open. Single-account snapshots (the common case) map cleanly to one batch
   * per save; legacy multi-account snapshots keep their original one-account-only
   * behaviour until the next sync, which is no worse than before.
   */
  private migrate(): void {
    const hasColumn = (table: string, col: string): boolean =>
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
        .some((c) => c.name === col);

    if (!hasColumn("fetch_log", "batch")) {
      this.db.exec(`ALTER TABLE fetch_log ADD COLUMN batch INTEGER`);
      this.db.exec(`UPDATE fetch_log SET batch = id WHERE batch IS NULL`);
    }
    if (!hasColumn("rows", "batch")) {
      this.db.exec(`ALTER TABLE rows ADD COLUMN batch INTEGER`);
      this.db.exec(`UPDATE rows SET batch = fetch_id WHERE batch IS NULL`);
    }
  }

  /** Persist a parsed query as a new immutable snapshot. Returns row count. */
  save(query: string, parsed: ParsedQuery): number {
    const now = new Date().toISOString();
    const insertFetch = this.db.prepare(
      `INSERT INTO fetch_log(batch, query, account, from_date, to_date, fetched_at)
       VALUES (?,?,?,?,?,?)`
    );
    const insertRow = this.db.prepare(
      `INSERT INTO rows(fetch_id, batch, query, account, section, data, fetched_at)
       VALUES (?,?,?,?,?,?,?)`
    );

    const tx = this.db.transaction(() => {
      const batch =
        (this.db.prepare(`SELECT COALESCE(MAX(batch), 0) + 1 AS next FROM fetch_log`)
          .get() as { next: number }).next;

      let count = 0;
      for (const stmt of parsed.statements) {
        const info = insertFetch.run(
          batch,
          query,
          stmt.account,
          stmt.fromDate ?? null,
          stmt.toDate ?? null,
          now
        );
        const fetchId = info.lastInsertRowid as number;
        for (const section of stmt.sections) {
          for (const row of section.rows) {
            insertRow.run(fetchId, batch, query, stmt.account, section.name, JSON.stringify(row), now);
            count++;
          }
        }
      }
      return count;
    });

    return tx();
  }

  /**
   * Rows for a section from the most recent sync of `query`. Returns `null` when
   * the query has never been synced (a genuine cache miss), or an array — possibly
   * empty — when it has (a section with no rows is a valid cached result, not a
   * miss). Resolving "latest" from the batch id means all accounts in a
   * multi-statement snapshot come back together and emptied sections stop
   * serving stale rows.
   */
  latestSection(section: string, query: string): Row[] | null {
    const latest = this.db
      .prepare(`SELECT MAX(batch) AS batch FROM fetch_log WHERE query = ?`)
      .get(query) as { batch: number | null };

    if (latest.batch === null) return null; // query never synced

    const rows = this.db
      .prepare(`SELECT data FROM rows WHERE query = ? AND batch = ? AND section = ?`)
      .all(query, latest.batch, section) as { data: string }[];

    return rows.map((r) => JSON.parse(r.data) as Row);
  }

  close(): void {
    this.db.close();
  }
}
