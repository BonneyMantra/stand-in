import { Check, X } from "lucide-react";
import type { SigCheck } from "@/lib/verify/useVerify";
import { shortHash } from "@/lib/lab/types";
import { cn } from "@/lib/utils";
import { StateTag } from "./ClaimCard";

type Props = { state: { status: "loading" } | { status: "ok"; items: SigCheck[] } | { status: "error"; message: string } };

function Row({ s }: { s: SigCheck }) {
  const ok = s.state === "verified";
  return (
    <li className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] text-fg">Report on trip {shortHash(s.trip, 6, 4)}</span>
        <span className="font-mono text-[11px] text-fg-faint">{s.model}</span>
        <span className="ml-auto">
          <StateTag state={s.state === "unreadable" ? "unreachable" : s.state} />
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11.5px]">
        <dt className="text-fg-faint">signed text</dt>
        <dd className="truncate text-fg-muted" title={s.signedText}>{s.signedText}</dd>
        <dt className="text-fg-faint">signing address</dt>
        <dd className="truncate text-fg-muted" title={s.claimed}>{s.claimed}</dd>
        <dt className="text-fg-faint">attested</dt>
        <dd className="truncate text-fg-muted" title={s.attested ?? ""}>{s.attested ?? "not in report"}</dd>
        <dt className="text-fg-faint">recovered</dt>
        <dd className={cn("flex min-w-0 items-center gap-1.5", ok ? "text-safe" : "text-trip")}>
          {ok ? <Check aria-hidden className="size-3 shrink-0" /> : <X aria-hidden className="size-3 shrink-0" />}
          <span className="truncate" title={s.recovered ?? ""}>{s.recovered ?? s.why}</span>
        </dd>
      </dl>
      {s.recovered && s.why ? <p className="mt-1.5 text-[12px] text-trip">{s.why}</p> : null}
    </li>
  );
}

/** NEAR AI Cloud incident-report signatures, recovered in this browser with @noble/curves (secp256k1, EIP-191). */
export function SignatureChecks({ state }: Props) {
  const items = state.status === "ok" ? state.items : [];
  const verified = items.filter((s) => s.state === "verified").length;
  return (
    <section aria-labelledby="sig-title" className="mt-14">
      <p className="mb-2 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">TEE signatures</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="sig-title" className="text-[22px] leading-tight font-medium tracking-[-0.02em]">
          Incident reports, signed inside the TEE
        </h2>
        {state.status === "ok" && items.length ? (
          <p className="font-mono text-[12px] text-fg-muted">
            <span className={verified === items.length ? "text-safe" : "text-trip"}>{verified} of {items.length}</span> signatures recover to the signing address
          </p>
        ) : null}
      </div>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-fg-muted">
        Each report's signature is checked here with secp256k1 recovery over the EIP-191 message (<span className="font-mono text-[12.5px]">@noble/curves</span>).
        The address it recovers must equal the report's signing address, which must equal the model's address in the attestation recorded with it.
        The reports are the ones in the recorded run this page ships with (<span className="font-mono text-[12.5px]">/demo-state.json</span>);
        the recovery itself runs here, in your browser.
      </p>
      <div className="mt-5 overflow-hidden rounded-[14px] border border-line bg-ink-900/60 p-[3px]">
        <div className="rounded-[10px] border border-line bg-ink-950">
          {state.status === "loading" ? (
            <p className="px-4 py-6 font-mono text-[12px] text-fg-faint">Loading reports…</p>
          ) : state.status === "error" ? (
            <p className="px-4 py-6 text-[13px] text-trip">{state.message}</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-fg-muted">No incident reports in the recorded state.</p>
          ) : (
            <ul>
              {items.map((s) => (
                <Row key={`${s.trip}-${s.at}`} s={s} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
