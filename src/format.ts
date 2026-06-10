import Table from "cli-table3";

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  // Union the keys across all rows (first-seen order). Flex rows are
  // heterogeneous, so a column can be absent from the first row but present in
  // later ones; keying off rows[0] alone would silently drop it.
  const keys = unionKeys(rows);
  const present = new Set(keys);
  // If specific columns were requested, keep only the ones that exist.
  const cols = (columns ?? keys).filter((c) => present.has(c));
  const table = new Table({ head: cols });
  for (const r of rows) table.push(cols.map((c) => fmt(r[c])));
  console.log(table.toString());
}

function unionKeys(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        order.push(k);
      }
    }
  }
  return order;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}
