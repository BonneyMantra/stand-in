// Tiny leveled logger. Library code never calls console.log; output goes to stderr
// (or anywhere via setLogSink). Level via STANDIN_LOG=debug|info|warn|error|silent.
type Level = "debug" | "info" | "warn" | "error" | "silent";
const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
let sink: (line: string) => void = (l) => process.stderr.write(l + "\n");

export function setLogSink(fn: (line: string) => void): void {
  sink = fn;
}
function threshold(): number {
  return order[(process.env.STANDIN_LOG as Level) ?? "info"] ?? 1;
}
function emit(level: Exclude<Level, "silent">, scope: string, msg: string): void {
  if (order[level] < threshold()) return;
  sink(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`);
}
export function logger(scope: string) {
  return {
    debug: (m: string) => emit("debug", scope, m),
    info: (m: string) => emit("info", scope, m),
    warn: (m: string) => emit("warn", scope, m),
    error: (m: string) => emit("error", scope, m),
  };
}
export type Logger = ReturnType<typeof logger>;
