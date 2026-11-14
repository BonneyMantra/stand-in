import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { BenchRoute } from "@/data/types";
import { cn } from "@/lib/utils";

/** RAG Analytics card, adapted: icon header, big mono "value / target" with a neon label,
 *  a small visual, and a mono legend list. */
export function BenchCard({
  icon: Icon, title, sub, value, target, label, pass, children, legend,
}: {
  icon: LucideIcon; title: string; sub: string; value: ReactNode; target: ReactNode; label: string;
  pass: boolean | null; children?: ReactNode; legend: [string, ReactNode, string?][];
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-[10px] border border-line bg-ink-900/70 p-4">
      <header className="flex items-start gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line-strong bg-ink-850 text-fg-muted"><Icon className="size-3.5" aria-hidden /></span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-fg">{title}</h2>
          <p className="truncate text-[11px] text-fg-faint">{sub}</p>
        </div>
      </header>
      <p className="mt-4 flex flex-wrap items-baseline gap-x-2 font-mono">
        <span className={cn("text-[28px] leading-none font-medium tracking-tight tabular-nums", pass === false ? "text-warn" : "text-fg")}>{value}</span>
        <span className="text-lg text-fg-faint">/ {target}</span>
        <span className={cn("text-[11px]", pass === false ? "text-warn" : "text-safe")}>{label}</span>
      </p>
      <div className="mt-4 min-h-[88px] flex-1">{children}</div>
      <dl className="mt-3 space-y-1 font-mono text-[11px]">
        {legend.map(([k, v, tone]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <dt className="inline-flex items-center gap-2 text-fg-faint"><span className={cn("size-1.5 rounded-sm", tone ?? "bg-fg-faint")} aria-hidden />{k}</dt>
            <dd className="text-fg-muted tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One cell per route: filled green when the check passed, hollow when it did not. */
export function RouteCells({ routes, pick }: { routes: BenchRoute[]; pick: (r: BenchRoute) => boolean }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(22px,1fr))] gap-1.5" role="list">
      {routes.map((r) => {
        const ok = pick(r);
        return (
          <span key={r.route} role="listitem" title={`${r.route}: ${ok ? "yes" : "no"}`} aria-label={`${r.route}: ${ok ? "yes" : "no"}`}
            className={cn("h-[22px] rounded-[5px] border", ok ? "border-safe/60 bg-safe/70 shadow-[0_0_12px_-2px_var(--color-safe)]" : "border-line-strong bg-ink-850")} />
        );
      })}
    </div>
  );
}

/** Blocks-to-freeze per route against the target line. Negative or missing = no fresh freeze. */
export function BlocksChart({ routes, target }: { routes: BenchRoute[]; target: number }) {
  const vals = routes.map((r) => (r.blocks_to_freeze !== null && r.blocks_to_freeze > 0 ? r.blocks_to_freeze : null));
  const max = Math.max(target + 2, ...vals.map((v) => v ?? 0));
  const W = 300, H = 88, bw = Math.min(28, (W - 8) / Math.max(1, routes.length) - 6);
  const y = (v: number) => H - 14 - (v / max) * (H - 24);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[88px] w-full" role="img" aria-label={`Blocks to freeze per route, target ${target} or fewer`}>
      <line x1="0" x2={W} y1={y(target)} y2={y(target)} stroke="var(--color-safe)" strokeDasharray="3 3" strokeOpacity="0.7" />
      <text x={W - 2} y={y(target) - 4} textAnchor="end" fontSize="9" className="font-mono" fill="var(--color-safe)">target ≤ {target}</text>
      {vals.map((v, i) => {
        const x = 4 + i * ((W - 8) / Math.max(1, routes.length)) + 3;
        return v === null ? (
          <g key={i}>
            <rect x={x} y={H - 16} width={bw} height="2" fill="var(--color-line-strong)" />
            <text x={x + bw / 2} y={H - 2} textAnchor="middle" fontSize="8.5" className="font-mono" fill="var(--color-fg-faint)">–</text>
          </g>
        ) : (
          <g key={i}>
            <rect x={x} y={y(v)} width={bw} height={H - 14 - y(v)} rx="3" fill={v <= target ? "var(--color-safe)" : "var(--color-warn)"} fillOpacity="0.8" />
            <text x={x + bw / 2} y={H - 2} textAnchor="middle" fontSize="8.5" className="font-mono" fill="var(--color-fg-muted)">{v}</text>
          </g>
        );
      })}
    </svg>
  );
}
