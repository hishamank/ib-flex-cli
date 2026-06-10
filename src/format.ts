import Table from "cli-table3";

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  // If specific columns were requested, keep only the ones that exist.
  const present = new Set(Object.keys(rows[0]));
  const cols = (columns ?? Object.keys(rows[0])).filter((c) => present.has(c));
  const table = new Table({ head: cols });
  for (const r of rows) table.push(cols.map((c) => fmt(r[c])));
  console.log(table.toString());
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}
