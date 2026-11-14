import { ArrowUpRight } from "lucide-react";
import { Tag } from "@/components/app/common";
import { SourceLink } from "@/components/landing/primitives";
import { explorerTx, type CheckState, type Claim, type ClaimCheck, type ClaimTx, type TxCheck } from "@/lib/verify/check";
import { shortHash } from "@/lib/lab/types";
import { cn } from "@/lib/utils";

const TONE = { checking: "muted", verified: "safe", mismatch: "trip", unreachable: "warn" } as const;

export function StateTag({ state }: { state: CheckState }) {
  return (
    <Tag tone={TONE[state]}>
      <span className={cn("size-1.5 rounded-full", state === "checking" ? "animate-pulse bg-fg-muted" : state === "verified" ? "bg-safe" : state === "mismatch" ? "bg-trip" : "bg-warn")} aria-hidden />
      {state}
    </Tag>
  );
}

function TxRow({ network, t, c }: { network: Claim["network"]; t: ClaimTx; c: TxCheck }) {
  const outcomeOk = c.outcome === t.expect;
  return (
    <li className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 text-[13px] text-fg">{t.role}</span>
        <a
          href={explorerTx(network, t.hash)}
          target="_blank"
          rel="noreferrer"
          title={t.hash}
          className="inline-flex items-center gap-1 rounded-sm font-mono text-[11.5px] text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted"
        >
          {shortHash(t.hash, 8, 4)}
          <ArrowUpRight aria-hidden className="size-3" />
        </a>
        <span className="ml-auto"><StateTag state={c.state} /></span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11.5px]">
        <dt className="text-fg-faint">signer</dt>
        <dd className="truncate text-fg-muted" title={t.signer}>{t.signer}</dd>
        <dt className="text-fg-faint">expect</dt>
        <dd className="text-fg-muted">
          {t.expect}
          {t.match ? <span className="text-fg-faint"> · mentions "{t.match}"</span> : null}
        </dd>
        {c.outcome ? (
          <>
            <dt className="text-fg-faint">chain</dt>
            <dd className={cn(outcomeOk ? "text-safe" : "text-trip")}>
              {c.outcome}
              {typeof c.height === "number" ? <span className="text-fg-muted"> · block {c.height.toLocaleString("en-US")}</span> : null}
            </dd>
          </>
        ) : null}
        {c.failureText ? (
          <>
            <dt className="text-fg-faint">error</dt>
            <dd className="text-fg-muted [overflow-wrap:anywhere]">{highlight(c.failureText, t.match)}</dd>
          </>
        ) : null}
        {c.endpoint ? (
          <>
            <dt className="text-fg-faint">via</dt>
            <dd className="truncate text-fg-faint">{c.endpoint}</dd>
          </>
        ) : null}
      </dl>
      {c.why ? <p className={cn("mt-1.5 text-[12px]", c.state === "mismatch" ? "text-trip" : "text-warn")}>{c.why}</p> : null}
    </li>
  );
}

function highlight(text: string, match?: string) {
  if (!match) return text;
  const i = text.indexOf(match);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-trip-soft px-0.5 text-trip">{match}</mark>
      {text.slice(i + match.length)}
    </>
  );
}

export function ClaimCard({ claim, check }: { claim: Claim; check: ClaimCheck | null }) {
  const state = check?.state ?? "checking";
  return (
    <article
      aria-labelledby={`claim-${claim.id}`}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-ink-900/60 p-[3px] transition-colors duration-300",
        state === "mismatch" ? "border-trip/40" : "border-line",
      )}
    >
      <header className="flex items-start justify-between gap-3 px-3.5 pt-3 pb-2.5">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] tracking-wide text-fg-faint uppercase">{claim.network} · {claim.id}</p>
          <h3 id={`claim-${claim.id}`} className="mt-1 text-[14px] leading-snug font-medium text-pretty text-fg">{claim.title}</h3>
        </div>
        <StateTag state={state} />
      </header>
      <div className="flex-1 rounded-[10px] border border-line bg-ink-950">
        <ul>
          {claim.txs.map((t, i) => (
            <TxRow key={t.hash} network={claim.network} t={t} c={check?.txs[i] ?? { state: "checking" }} />
          ))}
        </ul>
        {claim.blocks ? <BlocksRow claim={claim} check={check} /> : null}
        {claim.view ? <ViewRow claim={claim} check={check} /> : null}
        {claim.link ? (
          <div className="border-t border-line px-4 py-2.5">
            <SourceLink href={claim.link}>attestation record</SourceLink>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function BlocksRow({ claim, check }: { claim: Claim; check: ClaimCheck | null }) {
  const b = claim.blocks!;
  const r = check?.blocks;
  const from = claim.txs[b.from]?.role;
  const to = claim.txs[b.to]?.role;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-ink-900/40 px-4 py-3">
      <p className="min-w-0 flex-1 text-[12.5px] text-fg-muted">
        Blocks from <span className="text-fg">{from}</span> to <span className="text-fg">{to}</span>
      </p>
      <p className="font-mono text-[12px] tabular-nums">
        <span className={cn("text-[18px] font-medium", r?.state === "verified" ? "text-safe" : r?.state === "mismatch" ? "text-trip" : "text-fg-muted")}>
          {r?.diff ?? "…"}
        </span>
        <span className="text-fg-faint"> / claimed {b.expect}</span>
      </p>
      <StateTag state={r?.state ?? "checking"} />
    </div>
  );
}

function ViewRow({ claim, check }: { claim: Claim; check: ClaimCheck | null }) {
  const v = claim.view!;
  const r = check?.view;
  return (
    <div className="border-t border-line bg-ink-900/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-[11.5px] text-fg-muted" title={`${v.account}.${v.method}`}>
          view {v.method}({Object.values(v.args as Record<string, string>).join(", ")})
        </p>
        <StateTag state={r?.state ?? "checking"} />
      </div>
      <p className="mt-1 truncate font-mono text-[11px] text-fg-faint">on {v.account}</p>
      {r?.text ? (
        <pre className="mt-2 max-h-28 overflow-auto rounded-md border border-line bg-ink-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted [overflow-wrap:anywhere]">
          {highlight(r.text, v.expect_contains)}
        </pre>
      ) : null}
    </div>
  );
}
