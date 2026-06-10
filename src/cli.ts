#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { Command } from "commander";
import { loadConfig, type AppConfig } from "./config.js";
import { fetchRaw } from "./flex/client.js";
import { parseQuery, getSection, type ParsedQuery } from "./flex/parse.js";
import { Store } from "./store.js";
import { printJson, printTable } from "./format.js";
import { QUERY_BLUEPRINT } from "./sections.js";

const program = new Command();
program
  .name("ib")
  .description("Pull IBKR portfolio data via the Flex Web Service")
  .version("0.1.0")
  .option("--json", "output raw JSON instead of tables")
  .option("--live", "bypass the cache and fetch fresh from IBKR")
  .option("--db <path>", "sqlite database path");

function globals() {
  const o = program.opts<{ json?: boolean; live?: boolean; db?: string }>();
  return { json: !!o.json, live: !!o.live, db: o.db };
}

async function fetchQuery(cfg: AppConfig, name: string): Promise<ParsedQuery> {
  const q = cfg.queries[name];
  if (!q) {
    throw new Error(
      `Unknown query "${name}". Configured: ${Object.keys(cfg.queries).join(", ")}`
    );
  }
  const xml = await fetchRaw(cfg.token, q.id);
  return parseQuery(xml);
}

// ---- sync ----------------------------------------------------------------
program
  .command("sync")
  .argument("[query]", "query name; omit and pass --all to sync everything")
  .option("--all", "sync every configured query")
  .description("fetch from IBKR and cache to sqlite")
  .action(async (query: string | undefined, opts: { all?: boolean }) => {
    const cfg = loadConfig();
    const store = new Store(globals().db ?? cfg.dbPath);
    try {
      const names = opts.all ? Object.keys(cfg.queries) : query ? [query] : [];
      if (names.length === 0) {
        console.error("Specify a query name or use --all.");
        process.exit(1);
      }
      for (const name of names) {
        process.stderr.write(`Syncing ${name} ... `);
        const parsed = await fetchQuery(cfg, name);
        const n = store.save(name, parsed);
        console.error(`${n} rows`);
        await sleep(1500); // respect the ~1 request/second rate limit
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
  .description("fetch a query and show every section it returns")
  .action(async (query: string, opts: { full?: boolean }) => {
    const cfg = loadConfig();
    const parsed = await fetchQuery(cfg, query);
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
        let rows = live ? [] : store.latestSection(section, queryName);
        if (rows.length === 0) {
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
