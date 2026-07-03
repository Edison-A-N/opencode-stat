import { execFileSync } from "node:child_process";

const DB_PATH = process.env.OPENCODE_DB || `${process.env.HOME}/.local/share/opencode/opencode.db`;

export type DbRow = Record<string, unknown>;

function sqlVal(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "1" : "0";
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

export function query<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): T[] {
  let index = 0;
  const literalSql = sql.replace(/\?/g, () => sqlVal(params[index++]));
  const output = execFileSync("sqlite3", [DB_PATH, "-readonly", "-json", literalSql], {
    maxBuffer: 1024 * 1024 * 512,
    encoding: "utf8",
  });

  if (!output.trim()) return [];
  return JSON.parse(output) as T[];
}

export function queryOne<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): T | null {
  const rows = query<T>(sql, params);
  return rows[0] ?? null;
}
