# Setup guide

A complete, start-to-finish walkthrough: create the keys on IBKR, install the
CLI, configure it, and pull your first report. Budget ~15 minutes.

If you just want the short version, the [README](README.md) has it. This guide
is the hand-holding version with troubleshooting.

---

## What you'll end up with

Two kinds of credential, both from the IBKR website:

1. **A Flex Web Service token** — one secret string, goes in `.env`. Think of it
   as a read-only API key for your reporting data. It expires (up to 1 year).
2. **One or more Query IDs** — short numbers identifying reports you define in
   the IBKR portal (what data, which columns, what date range). These go in
   `config.json` and are **not** secret.

The CLI calls IBKR with `token + queryId`, IBKR generates the report, and the
CLI caches it locally in SQLite.

## Prerequisites

- An **Interactive Brokers account** with web/portal access.
- **Node.js ≥ 18** and npm — check with `node -v`. ([Install Node](https://nodejs.org/))
- **git**.
- A C/C++ toolchain for the native `better-sqlite3` build (most machines already
  have it: Xcode Command Line Tools on macOS, `build-essential` on Linux).

---

## Part 1 — IBKR platform: get your token and Query IDs

> The IBKR portal UI changes over time and exact labels vary by account type.
> The reliable trick: open **Settings** and use its **search box** — type
> `Flex` — to jump straight to both screens below.

### 1A. Enable the Flex Web Service and generate a token

1. Log in to the **IBKR Client Portal** at <https://www.interactivebrokers.com/> (Login → Client Portal).
2. Open **Settings** (the gear icon, usually top-right).
3. Go to **Account Settings → Reporting → Flex Web Service** (or search `Flex`).
4. **Enable** the Flex Web Service (toggle it on / set status to Active).
5. **Generate a token.** You may be prompted for 2-factor confirmation.
   - Set the **expiration** (you can pick up to ~1 year). Put a reminder in your
     calendar to rotate it before it lapses.
   - Optionally restrict the token to a specific **IP address** for extra safety.
6. **Copy the token now** and keep it somewhere safe — it's a long string of
   digits/letters. You'll paste it into `.env` in Part 3. Treat it like a
   password (see [Security](#security)).

### 1B. Create your Activity Flex Queries

A "Flex Query" is a saved report definition. Rather than one giant query, this
tool uses several small ones so each generates fast and avoids timeouts. You
don't have to create them all on day one — start with `positions` and `trades`.

For **each** query in the table below:

1. In Settings, go to **Account Settings → Reporting → Flex Queries**
   (or search `Flex Queries`).
2. Next to **Activity Flex Query**, click the **＋ / Create** button.
3. **Query Name** — use the name from the first column (e.g. `positions`). The
   name is for your reference; the CLI matches on the Query ID, not the name.
4. **Sections** — expand and tick the sections listed for that query. Default
   columns within each section are fine; the parser reads whatever the report
   contains.
5. **Delivery Configuration** — set:
   - **Format = XML** ← *required*; the CLI parses XML, not CSV.
   - **Period = Last 365 Calendar Days** (or whatever range you want by default;
     you can override per-run with `--from/--to`).
   - **Date Format = yyyyMMdd** and a 24-hour time format are recommended for
     consistency, but not required.
6. **Save.** The query now appears in the list with a **Query ID** (a number
   like `123456`). **Copy that ID** — it goes in `config.json`.

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

### 1C. Create the Trade Confirmation query (for intraday fills)

`fills` is the one query that is a **Trade Confirmation Flex Query**, not an
Activity one (it refreshes intraday rather than end-of-day).

1. Same screen (**Flex Queries**), but next to **Trade Confirmation Flex Query**
   click **＋ / Create**.
2. **Query Name** = `fills`, tick the trade-confirmation sections, **Format = XML**, save.
3. Copy its **Query ID**.

> **Activity vs Trade Confirmation:** Activity reports are end-of-day and give
> you *executed* history. Flex does **not** expose live working/open orders —
> that would need the separate Client Portal Web API, which is out of scope here.

By the end of Part 1 you should have: **1 token** and **a Query ID for each
report you created**.

---

## Part 2 — Install the CLI

```bash
git clone https://github.com/hishamank/ib-flex-cli.git
cd ib-flex-cli

npm install        # installs deps and compiles the native sqlite module
npm run build      # compile TypeScript to dist/
npm link           # optional: puts the `ib` command on your PATH
```

- If `npm link` fails on a permissions error, you can skip it and run every
  command as `npm run dev -- <command>` instead (e.g. `npm run dev -- positions`).
- Sanity check: `npm test` should print `pass 16`.

---

## Part 3 — Configure

Two files, both **gitignored** so you can never accidentally commit them.

```bash
cp .env.example .env                  # your token goes here (secret)
cp config.example.json config.json    # your Query IDs go here (not secret)
```

**`.env`** — paste the token from Part 1A:

```bash
IB_FLEX_TOKEN=000000000000000000000000   # the token string you copied
# optional overrides:
# IB_FLEX_CONFIG=config.json
# IB_FLEX_DB=ib-flex.db
```

**`config.json`** — replace `REPLACE_WITH_QUERY_ID` with each Query ID you
copied. Delete or leave any query you didn't create — only entries with a real
ID are used.

```json
{
  "queries": {
    "positions":   { "id": "123456", "type": "activity" },
    "trades":      { "id": "123457", "type": "activity" },
    "cash":        { "id": "123458", "type": "activity" },
    "fills":       { "id": "123459", "type": "trade_confirmation" }
  }
}
```

`type` is `activity` for everything except `fills`, which is
`trade_confirmation`.

---

## Part 4 — First sync and verify

```bash
ib sync --all      # fetch every configured query into the local cache
ib positions       # pretty table of holdings + unrealized P/L
ib trades          # executed trades
```

Reports take a few seconds to generate — the CLI polls until they're ready, so
the first sync is the slow part. After that, views read instantly from the
cache (add `--live` to force a fresh fetch).

**Discovering what your account actually returns:** the friendly views assume
the most common XML element names, which can differ by account/region. If a view
says `(no rows)` but you expect data:

```bash
ib raw positions          # lists every section the query returned + row counts
ib raw positions --full   # full JSON, so you can see the real element names
```

If the real section name differs from the default, update `src/sections.ts` and
the `section` argument in `src/cli.ts` to match.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `IB_FLEX_TOKEN is not set` | `.env` missing or empty. Did you `cp .env.example .env` and paste the token? |
| `Config file not found` | Run `cp config.example.json config.json` and fill in IDs. |
| `No usable queries in config.json` | Every entry still says `REPLACE_…`. Put at least one real Query ID in. |
| `Flex error 1015` / `1012` | Token invalid or expired — regenerate it in Part 1A and update `.env`. |
| `Flex error 1013` | The token is IP-restricted and your current IP doesn't match. |
| `Flex error 1018` | Rate limited. Wait a bit; `sync` already paces itself at ~1 req/sec. |
| `Statement … not ready after N attempts` | IBKR is taking unusually long to generate; re-run, or split a large query into smaller ones. |
| `(no rows)` in a friendly view | The section's real element name differs — use `ib raw <query> --full` to find it (see Part 4). |
| native build error on `npm install` | Install your platform's C/C++ build tools, then `npm install` again. |

Flex error codes and messages are surfaced verbatim in the CLI's error output,
so you can look up any code not listed here in IBKR's documentation.

---

## Security

- The token is read **only** from the environment (`.env`); it never goes in
  `config.json`, so `config.json` is safe to share. `.env`, `config.json`, and
  `*.db` are all gitignored.
- The Flex API is **read-only** — a leaked token can't place trades — but it
  still exposes financial PII. Treat the token and the SQLite cache as secrets:
  `chmod 600 .env ib-flex.db`.
- **Rotate the token** before it expires, and regenerate immediately if you
  suspect it leaked.

## Keeping it healthy

- A daily `ib sync --all` grows the cache over time — run `ib prune` periodically
  (keeps the latest 10 snapshots per query; `--keep N` to change).
- Set a calendar reminder to rotate the token ~11 months out.
