import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { txUrl } from "./content";
import { SourceLink } from "./primitives";
import { BLOCKLIST as B, blockLabel, short } from "./proof-data";

export type Verdict = { kind: "block" } | { kind: "clear"; account: string } | { kind: "invalid"; input: string };

const NEAR_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function judge(raw: string): Verdict {
  const a = raw.trim().toLowerCase();
  if (a === B.thief) return { kind: "block" };
  return NEAR_ID.test(a) ? { kind: "clear", account: a } : { kind: "invalid", input: raw.trim() };
}

const Row = ({ k, children, tone }: { k: string; children: ReactNode; tone?: "trip" | "safe" | "muted" }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="shrink-0 text-fg-faint">{k}</dt>
    <dd className={cn("min-w-0 truncate text-right", tone === "trip" ? "text-trip" : tone === "safe" ? "text-safe" : tone === "muted" ? "text-fg-muted" : "text-fg")}>
      {children}
    </dd>
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

function BlockBody() {
  return (
    <>
      <Row k="verdict" tone="trip">BLOCK</Row>
      <Row k="exit" tone="trip">{B.payExit} · payment refused</Row>
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

function ClearBody({ account }: { account: string }) {
  return (
    <>
      <Row k="blocklist" tone="safe">no entry</Row>
      <Rule />
      <p className="mb-2 text-fg-faint">then the CLI checks live, on archival RPC</p>
      <dl className="space-y-1.5">
        <Row k="account age" tone="muted">warn if younger than 7 days</Row>
        <Row k="contract code" tone="muted">warn if changed in 72 h</Row>
        <Row k="on chain" tone="muted">warn if it does not exist</Row>
      </dl>
      <Rule />
      <Row k="verdict">allow or warn</Row>
      <Row k="exit" tone="muted">0 sent · 4 warn not approved</Row>
      <p className="mt-3 leading-relaxed text-fg-faint">
        This page holds the one recorded entry, not the live list. Run <span className="text-fg-muted">standin check {account}</span> for the
        current answer.
      </p>
    </>
  );
}

export function Receipt({ v }: { v: Verdict }) {
  const account = v.kind === "block" ? B.thief : v.kind === "clear" ? v.account : v.input;
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
      {v.kind === "block" ? (
        <BlockBody />
      ) : v.kind === "clear" ? (
        <ClearBody account={v.account} />
      ) : (
        <>
          <Row k="verdict" tone="muted">not checked</Row>
          <p className="mt-3 leading-relaxed text-fg-muted">
            Not a valid NEAR account id: 2 to 64 characters, lowercase letters, digits and - _ . separators.
          </p>
        </>
      )}
    </div>
  );
}
