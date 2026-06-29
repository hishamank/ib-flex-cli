#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { Command } from "commander";
import { loadConfig, resolveDbPath, type AppConfig } from "./config.js";
import { fetchRaw, type DateRange } from "./flex/client.js";
import { parseQuery, getSection, type ParsedQuery } from "./flex/parse.js";
import { Store } from "./store.js";
import { printJson, printTable } from "./format.js";
import { QUERY_BLUEPRINT } from "./sections.js";

const program = new Command();
program
  .name("ibkr")
  .description("Pull IBKR portfolio data via the Flex Web Service")
  .version("0.1.0")
  .option("--json", "output raw JSON instead of tables")
  .option("--live", "bypass the cache and fetch fresh from IBKR")
  .option("--db <path>", "sqlite database path");

function globals() {
  const o = program.opts<{ json?: boolean; live?: boolean; db?: string }>();
  return { json: !!o.json, live: !!o.live, db: o.db };
}

/** Build a Flex date range from CLI options, validating the yyyymmdd format. */
function dateRange(opts: { from?: string; to?: string }): DateRange | undefined {
  const check = (v: string | undefined, flag: string): string | undefined => {
    if (v === undefined) return undefined;
    if (!/^\d{8}$/.test(v)) {
      throw new Error(`${flag} must be yyyymmdd (e.g. 20250131), got "${v}"`);
    }
    return v;
  };
  const from = check(opts.from, "--from");
  const to = check(opts.to, "--to");
  return from || to ? { from, to } : undefined;
}

async function fetchQuery(
  cfg: AppConfig,
  name: string,
  range?: DateRange
): Promise<ParsedQuery> {
  const q = cfg.queries[name];
  if (!q) {
    throw new Error(
      `Unknown query "${name}". Configured: ${Object.keys(cfg.queries).join(", ")}`
    );
  }
  // q.type (activity vs trade_confirmation) is advisory only: the Flex Web
  // Service uses the same SendRequest endpoint for both and infers the type
  // from the query id server-side, so it isn't passed here.
  const xml = await fetchRaw(cfg.token, q.id, range);
  return parseQuery(xml);
}

// ---- sync ----------------------------------------------------------------
program
  .command("sync")
  .argument("[query]", "query name; omit and pass --all to sync everything")
  .option("--all", "sync every configured query")
  .option("--from <yyyymmdd>", "start date (defaults to the query's saved period)")
  .option("--to <yyyymmdd>", "end date")
  .description("fetch from IBKR and cache to sqlite")
  .action(async (query: string | undefined, opts: { all?: boolean; from?: string; to?: string }) => {
    const cfg = loadConfig();
    const range = dateRange(opts);
    const store = new Store(globals().db ?? cfg.dbPath);
    try {
      const names = opts.all ? Object.keys(cfg.queries) : query ? [query] : [];
      if (names.length === 0) {
        console.error("Specify a query name or use --all.");
        process.exit(1);
      }
      let failed = 0;
      for (const name of names) {
        process.stderr.write(`Syncing ${name} ... `);
        try {
          const parsed = await fetchQuery(cfg, name, range);
          const n = store.save(name, parsed);
          console.error(`${n} rows`);
        } catch (e) {
          // Isolate failures so one bad query (timeout, wrong id) doesn't abort
          // the rest of an --all run.
          failed++;
          console.error(`failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        await sleep(1500); // respect the ~1 request/second rate limit
      }
      if (failed > 0) {
        console.error(`${failed} of ${names.length} queries failed.`);
        process.exitCode = 1;
      }
    } finally {
      store.close();
    }
  });

// ---- raw -----------------------------------------------------------------
program
  .command("raw")
  .argument("<query>", "query name")
  .option("--full", "print every row, not just a section summary")
  .option("--from <yyyymmdd>", "start date")
  .option("--to <yyyymmdd>", "end date")
  .description("fetch a query live and show every section it returns (always bypasses the cache)")
  .action(async (query: string, opts: { full?: boolean; from?: string; to?: string }) => {
    const cfg = loadConfig();
    const parsed = await fetchQuery(cfg, query, dateRange(opts));
    if (opts.full) {
      printJson(parsed);
      return;
    }
    const summary = parsed.statements.flatMap((s) =>
      s.sections.map((sec) => ({
        account: s.account,
        section: sec.name,
        rows: sec.rows.length,
      }))
    );
    printJson({ query, statements: parsed.statements.length, sections: summary });
  });

// ---- friendly per-section views ------------------------------------------
function viewCommand(
  cmd: string,
  queryName: string,
  section: string,
  columns: string[],
  description: string
) {
  program
    .command(cmd)
    .description(description)
    .action(async () => {
      const cfg = loadConfig();
      const { json, live, db } = globals();
      const store = new Store(db ?? cfg.dbPath);
      try {
        // null = nothing cached for this query (miss); [] = synced but the
        // section is empty (a valid hit). Only a true miss hits the network.
        let rows = live ? null : store.latestSection(section, queryName);
        if (rows === null) {
          const parsed = await fetchQuery(cfg, queryName);
          if (!live) store.save(queryName, parsed);
          rows = parsed.statements.flatMap((s) => getSection(s, section));
        }
        json ? printJson(rows) : printTable(rows, columns);
      } finally {
        store.close();
      }
    });
}

viewCommand(
  "positions",
  "positions",
  "OpenPositions",
  ["symbol", "position", "markPrice", "positionValue", "costBasisPrice", "fifoPnlUnrealized", "currency"],
  "current open positions with unrealized P/L"
);
viewCommand(
  "trades",
  "trades",
  "Trades",
  ["tradeDate", "symbol", "buySell", "quantity", "tradePrice", "ibCommission", "fifoPnlRealized", "currency"],
  "executed trades"
);
viewCommand(
  "cash",
  "cash",
  "CashTransactions",
  ["dateTime", "type", "description", "amount", "currency"],
  "cash transactions: deposits, withdrawals, dividends, fees"
);
viewCommand(
  "dividends",
  "income",
  "OpenDividendAccruals",
  ["symbol", "exDate", "payDate", "grossRate", "grossAmount", "netAmount", "currency"],
  "open dividend accruals"
);

// ---- prune ---------------------------------------------------------------
program
  .command("prune")
  .option("--keep <n>", "snapshots to keep per query", "10")
  .description("delete old cached snapshots, keeping the latest N per query")
  .action((opts: { keep: string }) => {
    const keep = Number.parseInt(opts.keep, 10);
    if (!Number.isInteger(keep) || keep < 1) {
      throw new Error(`--keep must be a positive integer, got "${opts.keep}"`);
    }
    // Purely a local DB operation, so no token/config required.
    const store = new Store(resolveDbPath(globals().db));
    try {
      const deleted = store.prune(keep);
      console.error(`Pruned ${deleted} cached rows (kept latest ${keep} per query).`);
    } finally {
      store.close();
    }
  });

// ---- sections overview ---------------------------------------------------
program
  .command("sections")
  .description("show configured queries and the sections each should contain")
  .action(() => {
    const cfg = loadConfig();
    for (const [name, q] of Object.entries(cfg.queries)) {
      console.log(`\n${name}  [${q.type}]  id=${q.id}`);
      for (const s of QUERY_BLUEPRINT[name] ?? []) console.log(`  - ${s}`);
    }
    console.log("");
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
