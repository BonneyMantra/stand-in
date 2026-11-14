import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { txUrl } from "./content";
import { SourceLink } from "./primitives";
import { BLOCKLIST as B, blockLabel, short } from "./proof-data";
import type { Verdict } from "./blocklist-check";

type Tone = "trip" | "safe" | "warn" | "muted";
const TONE: Record<Tone, string> = { trip: "text-trip", safe: "text-safe", warn: "text-warn", muted: "text-fg-muted" };

const Row = ({ k, children, tone }: { k: string; children: ReactNode; tone?: Tone }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="shrink-0 text-fg-faint">{k}</dt>
    <dd className={cn("min-w-0 truncate text-right", tone ? TONE[tone] : "text-fg")}>{children}</dd>
  </div>
);

/** Solid body plus a 6px zigzag strip at the bottom: a torn receipt edge. */
const TORN =
  "linear-gradient(#000 0 0) top / 100% calc(100% - 6px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 12px 6px repeat-x";

const Rule = () => <hr aria-hidden className="my-3.5 border-0 border-t border-dashed border-line-strong" />;

const CHECKS = [
  "re-read the drain tx from NEAR RPC, hash matches",
  "signer is the bait account, key was one of its decoys",
  "thief named from the transfer, verdict signed in the enclave",
  "contract checked the signature against the pinned key",
];

const Source = ({ live }: { live: boolean }) => (
  <Row k="source" tone="muted">{live ? "read from chain just now" : "recorded entry (RPC unreachable)"}</Row>
);

function BlockBody({ live }: { live: boolean }) {
  return (
    <>
      <dl className="space-y-1.5">
        <Row k="verdict" tone="trip">BLOCK</Row>
        <Row k="exit" tone="trip">{B.payExit} · payment refused</Row>
        <Source live={live} />
      </dl>
      <Rule />
      <dl className="space-y-1.5">
        <Row k="drained">{B.decoy}</Row>
        <Row k="with">decoy key {short(B.decoyKey, 6, 4)}</Row>
        <Row k="drain tx">
          {short(B.drainTx)} · {blockLabel(B.drainBlock)}
        </Row>
      </dl>
      <Rule />
      <p className="mb-2 text-fg-faint">TEE verdict · Intel TDX on OutLayer</p>
      <dl className="space-y-1.5">
        <Row k="project">{B.project}</Row>
        <Row k="wasm">{short(B.wasm, 8, 6)}</Row>
        <Row k="report tx">
          {short(B.reportTx)} · {blockLabel(B.reportBlock)}
        </Row>
      </dl>
      <ul className="mt-3 space-y-1.5">
        {CHECKS.map((c) => (
          <li key={c} className="flex gap-2 text-fg-muted">
            <Check aria-hidden className="mt-[1px] size-3 shrink-0 text-safe" />
            {c}
          </li>
        ))}
      </ul>
      <Rule />
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <SourceLink href={B.attestation}>attestation</SourceLink>
        <SourceLink href={txUrl(B.reportTx)}>report tx</SourceLink>
        <SourceLink href={txUrl(B.drainTx)}>drain tx</SourceLink>
      </div>
    </>
  );
}

/** Another thief on the live list: the registry's own reason, as the contract returns it. */
function ListedBody({ reason }: { reason: string }) {
  return (
    <>
      <dl className="space-y-1.5">
        <Row k="verdict" tone="trip">BLOCK</Row>
        <Row k="exit" tone="trip">{B.payExit} · payment refused</Row>
        <Source live />
      </dl>
      <Rule />
      <p className="mb-2 text-fg-faint">registry reason</p>
      <p className="leading-relaxed text-fg-muted [overflow-wrap:anywhere]">{reason || "listed, no reason recorded"}</p>
    </>
  );
}

function ClearBody({ exists }: { exists: boolean | null }) {
  return (
    <>
      <dl className="space-y-1.5">
        <Row k="blocklist" tone="safe">no entry</Row>
        <Row k="on chain" tone={exists === false ? "warn" : "muted"}>
          {exists === null ? "not read" : exists ? "account exists" : "does not exist · warn"}
        </Row>
        <Source live />
      </dl>
      <Rule />
      <p className="mb-2 text-fg-faint">then the CLI checks, on archival RPC</p>
      <dl className="space-y-1.5">
        <Row k="account age" tone="muted">warn if younger than 7 days</Row>
        <Row k="contract code" tone="muted">warn if changed in 72 h</Row>
      </dl>
      <Rule />
      <dl className="space-y-1.5">
        <Row k="verdict" tone={exists === false ? "warn" : undefined}>{exists === false ? "warn" : "allow or warn"}</Row>
        <Row k="exit" tone="muted">0 sent · 4 warn not approved</Row>
      </dl>
      <p className="mt-3 leading-relaxed text-fg-faint">
        <span className="text-fg-muted">standin pay</span> makes this same registry call, then the age and code checks, before it
        sends anything. A warned payment needs the owner's fingerprint.
      </p>
    </>
  );
}

function Note({ verdict, children }: { verdict: string; children: ReactNode }) {
  return (
    <>
      <dl>
        <Row k="verdict" tone="muted">{verdict}</Row>
      </dl>
      <p className="mt-3 leading-relaxed text-fg-muted">{children}</p>
    </>
  );
}

function Body({ v }: { v: Verdict }) {
  switch (v.kind) {
    case "block":
      return <BlockBody live={v.live} />;
    case "listed":
      return <ListedBody reason={v.reason} />;
    case "clear":
      return <ClearBody exists={v.exists} />;
    case "checking":
      return (
        <Note verdict="checking…">
          <span className="inline-flex items-center gap-2">
            <i aria-hidden className="size-1.5 animate-pulse rounded-full bg-fg-muted" />
            Reading {B.contract} on NEAR testnet.
          </span>
        </Note>
      );
    case "unreachable":
      return <Note verdict="not checked">No NEAR RPC node answered from this browser. Check your connection and try again.</Note>;
    case "empty":
      return <Note verdict="not checked">Type the account your agent is about to pay, for example alice.testnet.</Note>;
    case "invalid":
      return <Note verdict="not checked">Not a valid NEAR account id: 2 to 64 characters, lowercase letters, digits and - _ . separators.</Note>;
  }
}

export function Receipt({ v }: { v: Verdict }) {
  const account = v.kind === "block" ? B.thief : v.kind === "invalid" ? v.input : v.kind === "empty" ? "" : v.account;
  return (
    <div
      className="relative bg-ink-850 px-5 pt-5 pb-8 font-mono text-[11.5px] leading-snug"
      style={{ maskImage: TORN, WebkitMaskImage: TORN }}
    >
      <div className="flex items-center justify-between gap-3 text-[10.5px] text-fg-faint">
        <span>STAND-IN · COUNTERPARTY CHECK</span>
        <span>testnet</span>
      </div>
      <p className="mt-3 truncate text-fg">
        <span aria-hidden className="mr-2 text-fg-faint">$</span>
        standin pay {account || "…"} 0.5
      </p>
      <Rule />
      <Body v={v} />
    </div>
  );
}
