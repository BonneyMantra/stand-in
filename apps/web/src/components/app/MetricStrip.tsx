import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PreviewTag } from "./common";

export interface Metric {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: "fg" | "trip" | "safe" | "decoy" | "warn";
  spark?: number[];
  preview?: boolean;
}

const TONE = { fg: "text-fg", trip: "text-trip", safe: "text-safe", decoy: "text-decoy", warn: "text-warn" };
const BAR = { fg: "fill-fg-muted", trip: "fill-trip", safe: "fill-safe", decoy: "fill-decoy", warn: "fill-warn" };

/** Bar sparkline (Edge dashboard style): thin bars, the last non-zero bar highlighted. */
export function Spark({ values, tone = "fg", className }: { values: number[]; tone?: Metric["tone"]; className?: string }) {
  const max = Math.max(1, ...values);
  const w = values.length * 4;
  const last = values.reduce((a, v, i) => (v > 0 ? i : a), -1);
  return (
    <svg viewBox={`0 0 ${w} 20`} className={cn("h-5 w-16", className)} preserveAspectRatio="none" aria-hidden>
      {values.map((v, i) => {
        const h = v === 0 ? 1.5 : 3 + (v / max) * 17;
        return <rect key={i} x={i * 4} y={20 - h} width={2.2} height={h} rx={0.6} className={i === last ? BAR[tone ?? "fg"] : "fill-line-strong"} />;
      })}
    </svg>
  );
}

/** Adapted from ReUI card-38 (horizontal KPI strip, hairline dividers, dotted final cell)
 *  with chart-2's top-right sparkline per cell. */
export function MetricStrip({ items, className }: { items: Metric[]; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <section aria-label="Key metrics" className={cn("overflow-hidden rounded-[10px] border border-line bg-line", className)}>
      <dl className={cn("grid gap-px", items.length >= 6 ? "grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" : items.length === 5 ? "grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" : "grid-cols-2 lg:grid-cols-4")}>
        {items.map((m, i) => {
          const dotted = i === items.length - 1;
          return (
            <div key={m.label} className="relative min-w-0 bg-ink-900 px-4 py-3.5 [&:last-child:nth-child(odd)]:col-span-2 lg:[&:last-child:nth-child(odd)]:col-span-1">
              {dotted && <DotField id={`${id}-${i}`} />}
              <dt className="relative truncate text-xs text-fg-muted">{m.label}</dt>
              <dd className="relative mt-2 flex items-baseline gap-1.5">
                <span className={cn("min-w-0 font-mono text-2xl font-medium tracking-tight tabular-nums", TONE[m.tone ?? "fg"])}>{m.value}</span>
                {m.unit && <span className="font-mono text-xs text-fg-faint">{m.unit}</span>}
                {m.preview && <PreviewTag />}
                {m.spark && <Spark values={m.spark} tone={m.tone} className="ml-auto hidden shrink-0 self-end sm:block" />}
              </dd>
              {m.sub && <dd className="relative mt-1 truncate text-[11px] text-fg-faint">{m.sub}</dd>}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** card-38's masked dot texture, fading right to left. */
function DotField({ id }: { id: string }) {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.22]" aria-hidden>
      <defs>
        <pattern id={`${id}-p`} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="1.4" height="1.4" fill="var(--color-fg)" />
        </pattern>
        <linearGradient id={`${id}-g`} x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="white" />
          <stop offset="0.6" stopColor="white" stopOpacity="0.25" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-m`}>
          <rect width="100%" height="100%" fill={`url(#${id}-g)`} />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-p)`} mask={`url(#${id}-m)`} />
    </svg>
  );
}
