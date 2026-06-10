import { setTimeout as sleep } from "node:timers/promises";
import { XMLParser } from "fast-xml-parser";

const BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
const VERSION = "3";
// IBKR rejects requests without a recognised User-Agent. Accepted values are
// "Java" and "Blackberry". This is a documented quirk of the Flex Web Service.
const USER_AGENT = "Java";

const envelope = new XMLParser({ ignoreAttributes: true });

export class FlexError extends Error {
  constructor(public code: string | number, message: string) {
    super(`Flex error ${code}: ${message}`);
    this.name = "FlexError";
  }
}

export interface DateRange {
  from?: string; // yyyymmdd
  to?: string; // yyyymmdd
}

async function httpGet(path: string, params: Record<string, string>): Promise<string> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path}`);
  }
  return res.text();
}

/** Step 1: ask IBKR to generate the report; returns a reference code. */
export async function sendRequest(
  token: string,
  queryId: string,
  range?: DateRange
): Promise<string> {
  const params: Record<string, string> = { t: token, q: queryId, v: VERSION };
  if (range?.from) params.fd = range.from;
  if (range?.to) params.td = range.to;

  const xml = await httpGet("/SendRequest", params);
  const r = envelope.parse(xml)?.FlexStatementResponse;
  if (!r) throw new Error(`Unexpected SendRequest response: ${xml.slice(0, 200)}`);
  if (r.Status !== "Success") {
    throw new FlexError(r.ErrorCode ?? "?", r.ErrorMessage ?? "request failed");
  }
  return String(r.ReferenceCode);
}

/** Step 2: poll for the generated report until it is ready, then return its XML. */
export async function getStatement(
  token: string,
  referenceCode: string,
  opts: { retries?: number; delayMs?: number } = {}
): Promise<string> {
  const retries = opts.retries ?? 15;
  const delayMs = opts.delayMs ?? 5000;

  for (let attempt = 0; attempt < retries; attempt++) {
    const xml = await httpGet("/GetStatement", {
      t: token,
      q: referenceCode,
      v: VERSION,
    });

    // The real payload is a <FlexQueryResponse>. Anything else is the envelope,
    // meaning the report is still generating or an error occurred.
    if (xml.includes("<FlexQueryResponse")) return xml;

    const r = envelope.parse(xml)?.FlexStatementResponse ?? {};
    const code = String(r.ErrorCode ?? "");
    const msg = String(r.ErrorMessage ?? "");
    // 1019 = "Statement generation in progress".
    if (code === "1019" || /progress|generat/i.test(msg)) {
      await sleep(delayMs);
      continue;
    }
    throw new FlexError(code || r.Status || "Unknown", msg || "could not retrieve statement");
  }
  throw new Error(`Statement ${referenceCode} not ready after ${retries} attempts`);
}

/** Convenience: run both steps and return the raw report XML. */
export async function fetchRaw(
  token: string,
  queryId: string,
  range?: DateRange
): Promise<string> {
  const ref = await sendRequest(token, queryId, range);
  return getStatement(token, ref);
}
