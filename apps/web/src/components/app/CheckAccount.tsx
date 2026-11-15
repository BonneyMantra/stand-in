import { useId, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, CircleCheck, Info, Search, TriangleAlert } from "lucide-react";
import type { StandinState } from "@/data/types";
import { shortHash, shortKey } from "@/data/derive";
import { cn } from "@/lib/utils";
import { Panel } from "./common";

type Verdict = "allow" | "warn" | "block";
interface Reason { level: "block" | "warn" | "info"; text: string }
interface Result { account: string; verdict: Verdict; reasons: Reason[] }

const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** The agent-side counterparty check, as far as a browser can run it: blocklist hits are
 *  decided here; age and contract-change checks need RPC and run in `standin pay`. */
export function checkAccount(s: StandinState, account: string): Result {
  const hit = s.blocklist.find((b) => b.account_id === account);
  const reasons: Reason[] = [];
  if (hit) {
    reasons.push({ level: "block", text: `Used decoy key ${shortKey(hit.decoy_public_key)} in tx ${shortHash(hit.evidence_tx)}.` });
    reasons.push(hit.preview || !hit.attested_at
      ? { level: "warn", text: "Entry not yet attested by OutLayer (preview in this recording)." }
      : { level: "info", text: `Attested by the OutLayer verdict on ${new Date(hit.attested_at).toLocaleString()}.` });
    return { account, verdict: "block", reasons };
  }
  const own = Object.entries(s.recorded?.accounts ?? {}).find(([, id]) => id === account);
  if (own) reasons.push({ level: "info", text: `This is the run's own ${own[0]} account.` });
  if (s.agent.account_id === account) reasons.push({ level: "warn", text: "Paying the agent account itself." });
  reasons.push({ level: "info", text: "No entry in this run's blocklist. The live list is checked on the landing page and by `standin pay`." });
  reasons.push({ level: "info", text: "Whether the account exists, its age (< 7 days) and contract-code changes (72 h) are checked by `standin pay` over RPC, not from this page." });
  return { account, verdict: reasons.some((r) => r.level === "warn") ? "warn" : "allow", reasons };
}

const V = {
  // The page sees only the recorded list; `standin pay` still decides allow or warn (age, code, existence).
  allow: { icon: CircleCheck, cls: "border-safe/30 bg-safe-soft text-safe", label: "not listed" },
  warn: { icon: TriangleAlert, cls: "border-warn/30 bg-warn/10 text-warn", label: "warn · ask a human" },
  block: { icon: Ban, cls: "border-trip/40 bg-trip-soft text-trip", label: "block" },
};

export function CheckAccount({ state }: { state: StandinState }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const suggestions = [...new Set([state.blocklist[0]?.account_id, state.trips[0]?.attacker_account, state.recorded?.accounts.project].filter((x): x is string => Boolean(x)))];

  const run = (raw: string) => {
    const acct = raw.trim().toLowerCase();
    if (!ACCOUNT_RE.test(acct) && !/^[0-9a-f]{64}$/.test(acct)) {
      setErr("Enter a NEAR account id, e.g. alice.testnet");
      setRes(null);
      return;
    }
    setErr(null);
    setRes(checkAccount(state, acct));
  };
  const submit = (e: FormEvent) => { e.preventDefault(); run(value); };

  return (
    <Panel title="Check an account" icon={Search} id="check-title" meta="before an agent pays">
      <form onSubmit={submit} className="flex gap-2" noValidate>
        <label htmlFor={id} className="sr-only">Account id</label>
        <input
          id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="receiver.testnet" autoComplete="off" spellCheck={false}
          aria-invalid={Boolean(err)} aria-describedby={err ? `${id}-err` : undefined}
          className={cn("h-9 min-w-0 flex-1 rounded-md border bg-ink-900 px-3 font-mono text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring", err ? "border-trip/60" : "border-line-strong")}
        />
        <button type="submit" className="h-9 shrink-0 rounded-md bg-fg px-3.5 text-xs font-medium text-ink-950 outline-none hover:bg-fg/90 focus-visible:ring-2 focus-visible:ring-ring">Check</button>
      </form>
      {err && <p id={`${id}-err`} className="mt-2 text-xs text-trip">{err}</p>}
      {suggestions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-faint">
          try
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => { setValue(s); run(s); }} className="rounded border border-line px-1.5 py-0.5 font-mono text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">{s}</button>
          ))}
        </div>
      )}
      <div aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          {res && (
            <motion.div key={res.account + res.verdict} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }} className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-xs", V[res.verdict].cls)}>
                  {(() => { const I = V[res.verdict].icon; return <I className="size-3.5" aria-hidden />; })()}
                  {V[res.verdict].label}
                </span>
                <span className="truncate font-mono text-xs text-fg-muted">{res.account}</span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {res.reasons.map((r) => (
                  <li key={r.text} className="flex gap-2 text-xs leading-relaxed text-fg-muted">
                    {r.level === "block" ? <Ban className="mt-0.5 size-3.5 shrink-0 text-trip" aria-hidden /> : r.level === "warn" ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden /> : <Info className="mt-0.5 size-3.5 shrink-0 text-fg-faint" aria-hidden />}
                    {r.text}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
