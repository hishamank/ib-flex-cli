# ib-flex-cli

A small TypeScript CLI that pulls your IBKR portfolio data through the
**Flex Web Service** — positions, trades, cash, dividends, performance, FX, and
anything else a Flex Query can return — and caches it locally in SQLite.

Flex is **read-only end-of-day reporting**. It gives you *executed* trades, not
live working/open orders. (Open orders would need the Client Portal Web API,
which is out of scope here.) Activity data refreshes once daily at close;
Trade Confirmation data refreshes intraday with a short delay.

> **New here?** Follow the step-by-step [**setup guide**](SETUP.md) — it walks
> through generating the IBKR token, creating Flex Queries, installing, and
> configuring, with troubleshooting. The sections below are the quick reference.

## How it works

The Flex Web Service is a two-call flow:

1. `SendRequest?t={token}&q={queryId}&v=3` → returns a reference code.
2. `GetStatement?t={token}&q={referenceCode}&v=3` → returns the report XML
   (the client polls with backoff until it stops returning "generation in
   progress").

The parser is **generic** — it auto-discovers every section in the returned
XML, so the tool covers all sections without a hand-written parser per section.

## Phase 0 — one-time IBKR setup

1. **Enable the service & get a token.** Client Portal → Settings → Account
   Settings → Reporting → **Flex Web Service Configuration** → generate a token.
   It expires (~1 year); set a reminder to rotate it.
2. **Create the Flex Queries below.** Reporting → **Flex Queries**. Create each
   one as an *Activity Flex Query* (or *Trade Confirmation Flex Query* for
   `fills`), set **Format = XML**, **Period = Last 365 Calendar Days**, tick the
   listed sections, then copy each **Query ID**.

   Splitting into several small queries (rather than one giant query) keeps each
   report fast to generate and avoids timeouts.

   | Query name    | Type               | Sections to include |
   |---------------|--------------------|---------------------|
   | `account`     | Activity           | Account Information, Financial Instrument Information, Currency Conversion Rate |
   | `positions`   | Activity           | Open Positions, Prior Period Positions, Net Stock Position Summary, Complex Position Summary, Change in Position Value, Pending Exercises |
   | `trades`      | Activity           | Trades, Unbooked Trades, Options/Exercises/Assignments/Expirations, Trade Transfers, Transaction Fees, Commission Details, Routing Commissions |
   | `cash`        | Activity           | Cash Report, Cash Transactions, Statement of Funds, Transfers, Unsettled Transfers, Debit Card Activity |
   | `income`      | Activity           | Corporate Actions, Open/Change in Dividend Accruals, Interest Accruals, Interest Details (Tiers) |
   | `performance` | Activity           | Change in NAV, NAV Summary, MTM Performance, Realized/Unrealized Performance, Month/YTD Performance |
   | `fx`          | Activity           | Forex Balances, Forex P/L Details, Currency Conversion Rate |
   | `lending`     | Activity           | Client Fees, Borrow Fee Details, Securities Borrowed/Lent (+ Activity + Fees), Soft Dollar Activity |
   | `fills`       | Trade Confirmation | Trade confirmations (intraday fills) |

   You don't have to create all of them on day one. Only queries whose ID you
   fill into `config.json` will be used.

## Install & configure

```bash
pnpm install
cp .env.example .env          # add IB_FLEX_TOKEN (gitignored, never commit)
cp config.example.json config.json   # fill in each Query ID
pnpm build                    # compile to dist/
pnpm link --global            # optional: put `ibkr` on your PATH
```

The `ibkr …` examples below assume you ran `pnpm link --global` (or installed
globally). Without it, run any command through the bundled script instead:
`pnpm ibkr <command>` (e.g. `pnpm ibkr positions --json`). Note there is **no** `--`
separator with pnpm — write `pnpm ibkr sync --all`, not `pnpm ibkr -- sync --all`.
Run `pnpm test` to execute the suite.

## Usage

```bash
ibkr sync --all          # fetch every configured query into the cache
ibkr sync positions      # fetch just one
ibkr sync trades --from 20250101 --to 20250131   # override the query's date range

ibkr positions           # pretty table of holdings + unrealized P/L
ibkr trades              # executed trades
ibkr cash                # deposits / withdrawals / dividends / fees
ibkr dividends           # dividend accruals

ibkr raw cash            # every section a query returns, with row counts (always live)
ibkr raw cash --full     # full parsed JSON (use this to discover real section names)
ibkr sections            # what each configured query should contain

ibkr prune               # drop old cached snapshots, keeping the latest 10 per query
ibkr prune --keep 3      # keep fewer; bounds the sqlite cache size

# global flags
ibkr positions --json    # JSON instead of a table (pipe into jq, etc.)
ibkr positions --live    # skip cache, fetch fresh
ibkr --db ./my.db sync --all
```

`--from`/`--to` take `yyyymmdd` and are available on `sync` and `raw`; omit
them to use the query's saved period. A daily `ibkr sync --all` grows the cache
over time, so run `ibkr prune` periodically (it keeps the latest N snapshots per
query and reclaims disk).

Tip: `ibkr raw <query> --full` shows the **actual** XML element names your
account returns. If a friendly view shows "(no rows)", the section's real
element name probably differs from the default — update `src/sections.ts` and
the `section` argument in `src/cli.ts` to match.

## Security notes

- The token is read from the environment only; `config.json` holds just Query
  IDs and is safe to commit. `.env`, `config.json`, and `*.db` are gitignored.
- The Flex API is read-only — a leaked token can't place trades — but it still
  exposes financial PII, so treat the token and the SQLite cache as secrets
  (`chmod 600`).
- Rotate the token before it expires.

## Roadmap

- Friendly views for the remaining sections (performance, FX, corporate actions).
- Materialised typed tables for sections you query often.
- Portfolio analytics: yield-on-cost, projected annual income, FX-adjusted
  total return.
- Optional Client Portal Web API module if live open orders are ever needed.

## License & disclaimer

MIT — see [LICENSE](LICENSE).

This is an independent, unofficial tool. It is **not affiliated with, endorsed
by, or supported by Interactive Brokers**. "Interactive Brokers", "IBKR", and
"Flex" are trademarks of Interactive Brokers LLC. Provided "as is", with no
warranty; it is not financial advice. Always verify figures against your
official IBKR statements, and use within Interactive Brokers' API terms.
