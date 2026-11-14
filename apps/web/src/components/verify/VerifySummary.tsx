import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FOCUS } from "@/components/landing/primitives";
import type { ClaimCheck } from "@/lib/verify/check";
import { cn } from "@/lib/utils";

/** "Verified N of M from chain just now": counts per state, a segmented bar and a re-run control. */
export function VerifySummary({ checks, finishedAt, onRerun }: { checks: (ClaimCheck | null)[]; finishedAt: Date | null; onRerun: () => void }) {
  const total = checks.length;
  const count = (s: ClaimCheck["state"]) => checks.filter((c) => c?.state === s).length;
  const verified = count("verified");
  const mismatch = count("mismatch");
  const unreachable = count("unreachable");
  const pending = total - verified - mismatch - unreachable;
  const done = pending === 0;
  const when = finishedAt ? finishedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  const at = when ? ` (${when})` : "";
  const eyebrow = !done ? "Checking from chain" : unreachable === total ? "Could not reach NEAR RPC" : mismatch ? "Checked from chain · mismatch" : "Checked from chain";
  const headline = !done
    ? `Verified ${verified} of ${total} so far…`
    : unreachable === total
      ? `No public RPC node answered from this browser${at}`
      : verified === total
        ? `Verified ${verified} of ${total} from chain just now${at}`
        : `Verified ${verified} of ${total} from chain${at}${mismatch ? ` · ${mismatch} do not match` : ""}${unreachable ? ` · ${unreachable} not reachable` : ""}`;

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-ink-900/60 p-[3px]">
      <div className="flex flex-col gap-5 rounded-[10px] border border-line bg-ink-950 p-4 sm:p-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0" aria-live="polite">
          <p className={cn("font-mono text-[11px] tracking-[0.14em] uppercase", done && (mismatch || unreachable) ? (mismatch ? "text-trip" : "text-warn") : "text-fg-muted")}>{eyebrow}</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={cn("font-mono text-[44px] leading-none font-medium tracking-[-0.04em] tabular-nums", done && verified === total ? "text-safe" : "text-fg")}>
              {verified}<span className="text-fg-faint"> / {total}</span>
            </span>
            <span className="text-[15px] text-fg">{headline}</span>
          </p>
          {done && unreachable ? (
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-fg-muted">
              Each check tried every node listed below the claims. Check your connection or any extension that blocks requests to RPC
              hosts, then check again.
            </p>
          ) : null}
          <div className="mt-4 flex h-1.5 w-full max-w-md overflow-hidden rounded-full bg-ink-850" aria-hidden>
            <i className="bg-safe transition-[width] duration-500" style={{ width: `${(verified / total) * 100}%` }} />
            <i className="bg-trip transition-[width] duration-500" style={{ width: `${(mismatch / total) * 100}%` }} />
            <i className="bg-warn transition-[width] duration-500" style={{ width: `${(unreachable / total) * 100}%` }} />
          </div>
          <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-fg-muted">
            <span><i className="mr-1.5 inline-block size-1.5 rounded-full bg-safe align-middle" />{verified} verified</span>
            <span><i className="mr-1.5 inline-block size-1.5 rounded-full bg-trip align-middle" />{mismatch} mismatch</span>
            <span><i className="mr-1.5 inline-block size-1.5 rounded-full bg-warn align-middle" />{unreachable} unreachable</span>
            {pending ? <span><i className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-fg-muted align-middle" />{pending} checking</span> : null}
          </p>
        </div>
        <Button
          variant="quiet"
          size="sm"
          onClick={onRerun}
          disabled={!done}
          className={cn("h-9 gap-2 self-start border border-line-strong px-3.5 font-mono text-[12px] active:scale-[0.98] md:self-end", FOCUS)}
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Check again
        </Button>
      </div>
    </div>
  );
}
