import { Suspense, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { CircleAlert, Search, ShieldCheck, ShieldOff, ShieldQuestion, Snowflake, UserX, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/app/common";
import { FOCUS } from "@/components/landing/primitives";
import { explorerAccount } from "@/lib/wallet/near";
import { ACCOUNT_RE, type CheckResult } from "@/lib/verify/guardian";
import { useGuardianCheck } from "@/lib/verify/useGuardianCheck";
import { cn } from "@/lib/utils";
import { lazyWithReload } from "@/lib/lab/lazyPage";
import { LoadBoundary } from "@/components/lab/LoadBoundary";
import { Ext, GuardianFacts } from "./GuardianFacts";

// The wallet session and browser home are read only when this browser has one, so /verify stays light without them.
const Prefill = lazyWithReload(() => import("./VerifyPrefill"));
const hasSession = () => {
  try {
    if (localStorage.getItem("selected-wallet")) return true;
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith("standin.home.v1:")) return true;
  } catch {
    // storage blocked
  }
  return false;
};

function Verdict({ icon: Icon, tone, title, children }: { icon: LucideIcon; tone: "safe" | "trip" | "warn" | "muted"; title: string; children?: ReactNode }) {
  const c = { safe: "text-safe border-safe/30 bg-safe-soft", trip: "text-trip border-trip/40 bg-trip-soft", warn: "text-warn border-warn/30 bg-warn/10", muted: "text-fg-muted border-line-strong bg-ink-900" }[tone];
  return (
    <div className="flex items-start gap-3" data-testid="guardian-verdict">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", c)}><Icon aria-hidden className="size-4" /></span>
      <div className="min-w-0">
        <p className="text-[16px] leading-snug font-medium text-fg">{title}</p>
        {children ? <div className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">{children}</div> : null}
      </div>
    </div>
  );
}

function Outcome({ r }: { r: CheckResult }) {
  const acct = <span className="font-mono break-all text-fg">{r.account}</span>;
  if (r.kind === "missing") return <Verdict icon={UserX} tone="muted" title="No such account on testnet">{acct} does not exist (view_account answered UNKNOWN_ACCOUNT).</Verdict>;
  if (r.kind === "no-contract") return <Verdict icon={ShieldOff} tone="muted" title="No guardian: this account has no contract">{acct} exists but runs no code, so nothing can freeze its keys. <Ext href={explorerAccount(r.account)}>explorer</Ext></Verdict>;
  if (r.kind === "not-guardian") return <Verdict icon={ShieldQuestion} tone="warn" title="Not a Stand-in guardian">{acct} runs a contract with code hash <span className="font-mono break-all">{r.codeHash}</span>{r.build ? ` (${r.build})` : ", not a guardian build"}, and {r.detail}.</Verdict>;
  const pinned = !!r.build;
  return r.state.frozen
    ? <Verdict icon={Snowflake} tone="trip" title="Stand-in guardian · frozen">{acct}: its agent keys are deleted and Chain Signatures refused until the owner unfreezes. Read at block {r.height.toLocaleString("en-US")}.</Verdict>
    : <Verdict icon={ShieldCheck} tone={pinned ? "safe" : "warn"} title={pinned ? "Stand-in guardian · active" : "Guardian-shaped contract, unknown build"}>{acct} answers get_state with a guardian's fields{pinned ? `; code is the ${r.build!.split(" (")[0]}` : ", but its code hash is neither Stand-in build"}. Read at block {r.height.toLocaleString("en-US")}.</Verdict>;
}

/** /verify, first section: the visitor names any account and this browser reads its guardian from public RPC. */
export function GuardianCheck() {
  const id = useId();
  const [params, setParams] = useSearchParams();
  const initial = params.get("account") ?? "";
  const [value, setValue] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<{ id: string; why: string }[]>([]);
  const { state, freezeTxs, served, check } = useGuardianCheck();
  const ran = useRef(false);

  const run = (raw: string, fromUser = true) => {
    const a = raw.trim().toLowerCase();
    if (!ACCOUNT_RE.test(a)) return setErr("Enter a NEAR account id, like alice.testnet or name.guard.si-project-5289.testnet.");
    setErr(null);
    setValue(a);
    if (fromUser) setParams((p) => { p.set("account", a); return p; }, { replace: true });
    void check(a);
  };
  useEffect(() => {
    if (ran.current || !initial) return;
    ran.current = true;
    run(initial, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onPrefill = (list: { id: string; why: string }[]) => {
    setSuggest(list);
    if (!ran.current && !initial && list[0]) {
      ran.current = true;
      run(list[0].id, false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); run(value); };

  return (
    <section aria-labelledby={`${id}-h`} className="overflow-hidden rounded-[14px] border border-line bg-ink-900/60 p-[3px]">
      <div className="rounded-[10px] border border-line bg-ink-950 p-4 sm:p-5">
        <p className="font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">Check any guardian · testnet</p>
        <h2 id={`${id}-h`} className="mt-2 text-[20px] leading-tight font-medium tracking-[-0.01em] text-fg">Is this account guarded, and by whom?</h2>
        <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-fg-muted">Enter your own account or any other. This browser reads its code hash, guardian state, keys and freeze log from public RPC and compares the code with the pinned build.</p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row" noValidate>
          <label htmlFor={id} className="sr-only">Account id</label>
          <input
            id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="alice.testnet" autoComplete="off" spellCheck={false} autoCapitalize="none"
            aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} data-testid="guardian-input"
            className={cn("h-10 min-w-0 flex-1 rounded-md border bg-ink-900 px-3 font-mono text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring", err ? "border-trip/60" : "border-line-strong")}
          />
          <Button type="submit" variant="invert" className={cn("h-10 gap-2 px-4", FOCUS)} disabled={state.status === "loading"} data-testid="guardian-check">
            <Search aria-hidden className="size-4" />{state.status === "loading" ? "Reading…" : "Check"}
          </Button>
        </form>
        {err ? <p id={`${id}-err`} className="mt-2 text-[12.5px] text-trip">{err}</p> : null}
        {suggest.length ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-faint">
            <span>yours:</span>
            {suggest.map((s) => (
              <button key={s.id} type="button" title={s.why} onClick={() => run(s.id)} className={cn("max-w-full truncate rounded border border-line px-1.5 py-0.5 font-mono text-fg-muted hover:text-fg", FOCUS)}>{s.id}</button>
            ))}
          </div>
        ) : null}
        {hasSession() ? <LoadBoundary what="Your accounts"><Suspense fallback={null}><Prefill onList={onPrefill} /></Suspense></LoadBoundary> : null}
        <div className="mt-5" aria-live="polite">
          {state.status === "loading" ? (
            <div className="space-y-2" aria-label={`Reading ${state.account}`}><Shimmer className="h-9 w-2/3" /><Shimmer className="h-28 w-full" /></div>
          ) : state.status === "error" ? (
            <Verdict icon={WifiOff} tone="warn" title="Testnet RPC did not answer">
              <p className="[overflow-wrap:anywhere]">Nothing could be read for <span className="font-mono">{state.account}</span>: {state.message}</p>
              <Button variant="line" size="sm" onClick={() => run(state.account, false)} className={cn("mt-2 h-8", FOCUS)}>Try again</Button>
            </Verdict>
          ) : state.status === "ok" ? (
            <div className="space-y-4">
              <Outcome r={state.result} />
              {state.result.kind === "guardian" ? <GuardianFacts r={state.result} freezeTxs={freezeTxs} served={served} /> : null}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] text-fg-faint"><CircleAlert aria-hidden className="size-3.5" />Try si-agent-5289.testnet (the film's guardian) or your own account.</p>
          )}
        </div>
      </div>
    </section>
  );
}
