import { Badge } from "@/components/reui/badge";
import { cn } from "@/lib/utils";
import { txUrl } from "./content";
import type { BenchRow } from "./bench-data";

const FULL = 0.2002; // the largest per-route baseline loss; bars are drawn against it

function BlockMeter({ blocks, on, delay }: { blocks: number; on: boolean; delay: number }) {
  return (
    <span aria-hidden className="flex gap-[3px]">
      {Array.from({ length: 8 }, (_, i) => {
        const filled = i < blocks;
        return (
          <i
            key={i}
            className={cn(
              "h-2.5 w-2 rounded-[2px] transition-[opacity,transform] duration-300 ease-[var(--ease-out-strong)]",
              filled ? (i === blocks - 1 ? "bg-trip" : "bg-fg-muted") : "bg-line-strong",
              on ? "scale-100 opacity-100" : "scale-50 opacity-0",
            )}
            style={{ transitionDelay: on ? `${delay + i * 35}ms` : "0ms" }}
          />
        );
      })}
    </span>
  );
}

const Mark = ({ ok, children, title }: { ok: boolean; children: string; title: string }) => (
  <abbr
    title={title}
    className={cn(
      "inline-flex size-4 items-center justify-center rounded-[3px] border text-[9px] no-underline",
      ok ? "border-decoy/50 text-decoy" : "border-line-strong text-fg-faint",
    )}
  >
    {children}
  </abbr>
);

function OnLane({ r, on, delay }: { r: BenchRow; on: boolean; delay: number }) {
  const o = r.on;
  if (o.kind === "froze") {
    return (
      <span className="flex items-center gap-2.5">
        <BlockMeter blocks={o.blocks} on={on} delay={delay} />
        <Mark ok={o.session} title={o.session ? "Attributed to the right session" : "Session not attributed"}>S</Mark>
        <Mark ok={o.toolCall} title={o.toolCall ? "Attributed to the exact tool call" : "Exact tool call not attributed"}>T</Mark>
      </span>
    );
  }
  if (o.kind === "pending") {
    return (
      <span className="inline-flex items-center gap-2 text-fg-muted">
        <i className="size-1.5 animate-pulse rounded-full bg-warn" aria-hidden /> running now
      </span>
    );
  }
  return <span className={cn("truncate", o.kind === "declined" ? "text-fg-muted" : "text-safe")}>{o.kind === "declined" ? "no leak" : o.kind}</span>;
}

function Outcome({ r, on }: { r: BenchRow; on: boolean }) {
  const o = r.on;
  if (!on) {
    if (r.offLostNear === null) return <span className="text-fg-faint">{o.kind === "pending" ? "pending" : "no baseline run"}</span>;
    return r.offLostNear > 0 ? <span className="text-trip">−{r.offLostNear} NEAR</span> : <span className="text-fg-muted">0 NEAR</span>;
  }
  if (o.kind === "froze") {
    return (
      <a
        href={txUrl(o.freezeTx)}
        target="_blank"
        rel="noreferrer"
        className="rounded-sm text-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted"
        title={`Trip block #${o.tripBlock}, freeze included at #${o.freezeBlock}`}
      >
        frozen in {o.blocks} blocks
      </a>
    );
  }
  if (o.kind === "pending") return <span className="text-fg-faint">awaiting result</span>;
  return <span className="text-fg-muted">{o.detail}</span>;
}

export function RouteRow({ r, on, index }: { r: BenchRow; on: boolean; index: number }) {
  const width = r.offLostNear ? Math.min(1, r.offLostNear / FULL) : 0;
  const delay = 60 + index * 45;
  return (
    <li className="grid grid-cols-[26px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-2.5 font-mono text-[11.5px] lg:grid-cols-[26px_minmax(0,1fr)_200px_minmax(0,230px)]">
      <span className="text-fg-faint">{r.id}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-fg" title={r.name}>
          {r.name}
        </span>
        {r.agent ? (
          <Badge
            variant="info-outline"
            size="sm"
            className="h-[17px] shrink-0 rounded border-decoy/40 bg-transparent px-1.5 text-[10px] leading-[15px] font-normal text-decoy dark:bg-transparent"
          >
            {r.agent}
          </Badge>
        ) : null}
      </span>
      <span className="col-start-2 flex min-w-0 items-center justify-between gap-3 lg:contents">
        <span className="grid h-4 min-w-0 items-center">
          <span aria-hidden className={cn("col-start-1 row-start-1 h-1.5 w-full rounded-full bg-ink-800 transition-opacity duration-300 max-lg:hidden", on && "opacity-0")} />
          <span
            aria-hidden
            className="col-start-1 row-start-1 h-1.5 w-[120px] origin-left rounded-full bg-trip transition-transform duration-700 ease-[cubic-bezier(0.77,0,0.175,1)] lg:w-full"
            style={{ transform: `scaleX(${on ? 0 : width})`, transitionDelay: on ? `${index * 25}ms` : `${delay}ms` }}
          />
          <span className={cn("col-start-1 row-start-1 transition-opacity duration-300", on ? "opacity-100" : "pointer-events-none opacity-0")} aria-hidden={!on}>
            <OnLane r={r} on={on} delay={delay} />
          </span>
        </span>
        <span className="min-w-0 shrink-0 truncate text-right">
          <Outcome r={r} on={on} />
        </span>
      </span>
    </li>
  );
}
