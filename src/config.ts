import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";

export type QueryType = "activity" | "trade_confirmation";

export interface QueryDef {
  id: string;
  type: QueryType;
}

export interface AppConfig {
  token: string;
  queries: Record<string, QueryDef>;
  dbPath: string;
}

/** Resolve the sqlite path: explicit override, then env, then default. */
export function resolveDbPath(override?: string): string {
  return override ?? process.env.IB_FLEX_DB ?? "ib-flex.db";
}

/**
 * Loads the Flex token from the environment (never from the config file, so the
 * file can be committed safely) and the query registry from config.json.
 */
export function loadConfig(): AppConfig {
  const token = process.env.IB_FLEX_TOKEN;
  if (!token) {
    throw new Error(
      "IB_FLEX_TOKEN is not set. Put it in .env (gitignored) or export it. Never commit it."
    );
  }

  const configPath = process.env.IB_FLEX_CONFIG ?? "config.json";
  let raw: string;
  try {
    raw = readFileSync(resolve(configPath), "utf8");
  } catch {
    throw new Error(
      `Config file not found at ${configPath}. Copy config.example.json to config.json and fill in your Query IDs.`
    );
  }

  const json = JSON.parse(raw) as { queries?: Record<string, QueryDef> };
  if (!json.queries || typeof json.queries !== "object") {
    throw new Error("config.queries is missing or invalid.");
  }

  // Keep only queries that have a real id filled in.
  const queries: Record<string, QueryDef> = {};
  for (const [name, def] of Object.entries(json.queries)) {
    if (def?.id && !def.id.startsWith("REPLACE")) queries[name] = def;
  }
  if (Object.keys(queries).length === 0) {
    throw new Error("No usable queries in config.json - fill in at least one Query ID.");
  }

  return {
    token,
    queries,
    dbPath: resolveDbPath(),
  };
}
