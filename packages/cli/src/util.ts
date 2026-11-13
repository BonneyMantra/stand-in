import { parseArgs } from "node:util";

export const out = (s = "") => process.stdout.write(s + "\n");
export const err = (s: string) => process.stderr.write(s + "\n");

export function table(rows: string[][], header: string[]): string {
  const all = [header, ...rows];
  const w = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (c ?? "").padEnd(w[i]!)).join("  ").trimEnd();
  return [line(header), line(w.map((n) => "-".repeat(n))), ...rows.map(line)].join("\n");
}

type Opts = Record<string, { type: "string" | "boolean"; short?: string }>;
export function parse<const O extends Opts>(argv: string[], options: O) {
  return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
}

export const short = (k: string) => (k.length > 22 ? `${k.slice(0, 14)}..${k.slice(-5)}` : k);
