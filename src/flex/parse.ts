import { XMLParser } from "fast-xml-parser";

// Keep everything as strings: monetary values must not be coerced to JS numbers
// (precision loss), and we want lossless round-tripping into the cache.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
});

export type Row = Record<string, string>;

export interface Section {
  name: string;
  rows: Row[];
}

export interface Statement {
  account: string;
  fromDate?: string;
  toDate?: string;
  whenGenerated?: string;
  sections: Section[];
}

export interface ParsedQuery {
  queryName?: string;
  type?: string;
  statements: Statement[];
}

// Attributes that sit directly on <FlexStatement> and are not sections.
const STATEMENT_ATTRS = new Set([
  "accountId",
  "fromDate",
  "toDate",
  "period",
  "whenGenerated",
]);

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parses a Flex report into statements and sections WITHOUT needing a schema
 * per section. The Flex XML shape is consistent:
 *
 *   <FlexQueryResponse>
 *     <FlexStatements>
 *       <FlexStatement accountId=".." fromDate=".." toDate="..">
 *         <OpenPositions>
 *           <OpenPosition symbol=".." position=".." ... />
 *         </OpenPositions>
 *         <AccountInformation accountId=".." name=".." />   // single-record section
 *         ...
 *       </FlexStatement>
 *     </FlexStatements>
 *   </FlexQueryResponse>
 *
 * Each child of <FlexStatement> is a section; its rows are the repeated child
 * elements. Single-record sections (only attributes) become one row.
 */
export function parseQuery(xml: string): ParsedQuery {
  const doc = parser.parse(xml);
  const resp = doc.FlexQueryResponse;
  if (!resp) throw new Error("No <FlexQueryResponse> found (unexpected payload).");

  const statements = toArray<Record<string, unknown>>(
    resp.FlexStatements?.FlexStatement
  ).map(parseStatement);

  return {
    queryName: resp.queryName,
    type: resp.type,
    statements,
  };
}

function parseStatement(node: Record<string, unknown>): Statement {
  const sections: Section[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (STATEMENT_ATTRS.has(key)) continue;
    if (value === null || typeof value !== "object") continue;

    const container = value as Record<string, unknown>;
    const childObjects = Object.values(container).filter(
      (v) => v !== null && typeof v === "object"
    );

    const rows: Row[] = [];
    if (childObjects.length === 0) {
      // Single-record section (e.g. AccountInformation): the container itself
      // is the row, made of plain attribute strings.
      rows.push(container as Row);
    } else {
      for (const child of childObjects) {
        for (const r of toArray<Record<string, unknown>>(child as never)) {
          if (r && typeof r === "object") rows.push(r as Row);
        }
      }
    }

    sections.push({ name: key, rows });
  }

  return {
    account: String(node.accountId ?? ""),
    fromDate: node.fromDate as string | undefined,
    toDate: node.toDate as string | undefined,
    whenGenerated: node.whenGenerated as string | undefined,
    sections,
  };
}

/** Pull a named section's rows out of a statement (e.g. "OpenPositions"). */
export function getSection(stmt: Statement, name: string): Row[] {
  return stmt.sections.find((s) => s.name === name)?.rows ?? [];
}
