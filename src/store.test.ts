import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import type { ParsedQuery } from "./flex/parse.js";

function withStore(fn: (store: Store) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ib-flex-test-"));
  const store = new Store(join(dir, "test.db"));
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function snapshot(section: string, rows: Record<string, string>[], account = "U1"): ParsedQuery {
  return { statements: [{ account, sections: [{ name: section, rows }] }] };
}

test("latestSection returns null for a never-synced query", () => {
  withStore((store) => {
    assert.equal(store.latestSection("OpenPositions", "positions"), null);
  });
});

test("latestSection serves the latest sync even when the section is now empty", () => {
  withStore((store) => {
    store.save("positions", snapshot("OpenPositions", [{ symbol: "AAPL", position: "100" }]));
    // newer sync: every position closed -> the section has no rows
    store.save("positions", snapshot("OpenPositions", []));
    // must be [] (cached-and-empty), NOT the stale AAPL row, and NOT null.
    assert.deepEqual(store.latestSection("OpenPositions", "positions"), []);
  });
});

test("latestSection returns rows from the most recent populated sync", () => {
  withStore((store) => {
    store.save("positions", snapshot("OpenPositions", [{ symbol: "AAPL", position: "100" }]));
    store.save("positions", snapshot("OpenPositions", [{ symbol: "MSFT", position: "50" }]));
    assert.deepEqual(store.latestSection("OpenPositions", "positions"), [
      { symbol: "MSFT", position: "50" },
    ]);
  });
});

test("latestSection unions rows across all accounts in one snapshot", () => {
  withStore((store) => {
    store.save("positions", {
      statements: [
        { account: "U1", sections: [{ name: "OpenPositions", rows: [{ symbol: "AAPL" }] }] },
        { account: "U2", sections: [{ name: "OpenPositions", rows: [{ symbol: "TSLA" }] }] },
      ],
    });
    const rows = store.latestSection("OpenPositions", "positions");
    assert.equal(rows?.length, 2);
    assert.deepEqual(new Set(rows?.map((r) => r.symbol)), new Set(["AAPL", "TSLA"]));
  });
});

test("two saves in the same millisecond stay distinct batches", () => {
  withStore((store) => {
    // No sleep between saves: this is exactly the case a wall-clock grouping
    // would merge. The batch counter must keep them apart.
    store.save("positions", snapshot("OpenPositions", [{ symbol: "AAPL" }]));
    store.save("positions", snapshot("OpenPositions", [{ symbol: "MSFT" }]));
    assert.deepEqual(store.latestSection("OpenPositions", "positions"), [{ symbol: "MSFT" }]);
  });
});
