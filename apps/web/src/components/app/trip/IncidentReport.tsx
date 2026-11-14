import { useState, type ReactNode } from "react";
import { Check, CircleDashed, Cpu, FileText } from "lucide-react";
import type { IncidentReport } from "@/data/types";
import { fmtTime } from "@/data/derive";
import { cn } from "@/lib/utils";
import { CopyText, EmptyState, Panel, Tag } from "../common";

const CONF_TONE = { low: "warn", medium: "muted", high: "safe" } as const;

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-line py-2.5 first:border-t-0 first:pt-0">
      <p className="font-mono text-[10.5px] tracking-wide text-fg-faint uppercase">{k}</p>
      <div className="mt-1 text-[13px] leading-relaxed [overflow-wrap:anywhere] text-fg-muted">{children}</div>
    </div>
  );
}

function Steps({ items, mark }: { items: string[]; mark: "done" | "next" }) {
  if (!items.length) return <p className="text-fg-faint">None recorded.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((s) => (
        <li key={s} className="flex gap-2">
          <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", mark === "done" ? "bg-safe" : "bg-decoy")} aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{s}</span>
        </li>
      ))}
    </ul>
  );
}

function Proof({ r }: { r: IncidentReport }) {
  const [open, setOpen] = useState(false);
  const p = r.proof;
  const passed = p.checks.filter((c) => c.ok).length;
  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-line p-3.5 lg:border-t-0 lg:border-l">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg"><Cpu className="size-3.5 text-fg-muted" aria-hidden />Written inside a TEE</p>
        <Tag tone={p.verified ? "safe" : "warn"}>{passed}/{p.checks.length} checks</Tag>
      </div>
      <div className="space-y-1 font-mono text-[11px] text-fg-muted">
        <p className="truncate" title={r.model}>model <span className="text-fg">{r.model}</span></p>
        <div className="flex min-w-0 items-center gap-1.5">signed by <CopyText value={p.signing_address} display={`${p.signing_address.slice(0, 8)}…${p.signing_address.slice(-6)}`} /></div>
        <div className="flex min-w-0 items-center gap-1.5">chat <CopyText value={p.chat_id} display={`${p.chat_id.slice(0, 10)}…`} /></div>
        <p>{p.signature_kind === "provider_tee" ? "Intel TDX + NVIDIA GPU" : p.signature_kind} · {p.signing_algo.toUpperCase()}</p>
      </div>
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="self-start rounded font-mono text-[11px] text-fg-muted underline-offset-4 outline-none hover:text-fg hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? "hide checks" : "show what was checked"}
      </button>
      {open && (
        <ul className="space-y-1.5 text-[11px] leading-snug">
          {p.checks.map((c) => (
            <li key={c.name} className="flex gap-1.5 text-fg-muted">
              <Check className={cn("mt-px size-3 shrink-0", c.ok ? "text-safe" : "text-trip")} aria-hidden />
              <span className="min-w-0 break-words">{c.name}</span>
            </li>
          ))}
          {p.unverified.map((u) => (
            <li key={u.what} className="flex gap-1.5 text-fg-faint" title={u.reason}>
              <CircleDashed className="mt-px size-3 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">not checked locally: {u.what}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-[11px] leading-relaxed text-fg-faint">
        The response is signed by a key that only exists inside attested hardware, and the signature covers our exact request and the model's exact answer.
        {p.billing ? ` Cost $${p.billing.usd.toFixed(5)}.` : ""}
      </p>
    </div>
  );
}

/** Private incident report from a NEAR AI Cloud TEE model, with its signature and attestation checks. */
export function IncidentReportPanel({ report }: { report?: IncidentReport }) {
  return (
    <Panel
      title="Incident report" icon={FileText} id="report-title" bodyClassName="p-0"
      meta="NEAR AI Cloud · private inference"
      actions={report ? <Tag tone={CONF_TONE[report.report.confidence]}>{report.report.confidence} confidence</Tag> : null}
    >
      {!report ? (
        <EmptyState icon={FileText} title="No incident report for this trip">
          Reports are written after a freeze when the watcher has a NEAR AI Cloud key. A missing report never delays a freeze.
        </EmptyState>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 p-3.5">
            <p className="text-[15px] leading-relaxed text-fg">{report.report.summary}</p>
            <p className="mt-1 font-mono text-[11px] text-fg-faint">{fmtTime(report.at, true)}</p>
            <div className="mt-3 grid gap-x-6 md:grid-cols-2">
              <div>
                <Field k="leaked via">{report.report.leaked_via}</Field>
                <Field k="root cause">{report.report.root_cause}</Field>
                <Field k="blast radius">{report.report.blast_radius}</Field>
              </div>
              <div>
                <Field k="actions taken"><Steps items={report.report.actions_taken} mark="done" /></Field>
                <Field k="next steps"><Steps items={report.report.recommended_next_steps} mark="next" /></Field>
              </div>
            </div>
          </div>
          <Proof r={report} />
        </div>
      )}
    </Panel>
  );
}
