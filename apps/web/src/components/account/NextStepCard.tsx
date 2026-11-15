import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, CircleCheck, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NextStep } from "@/data/accountDerive";
import { FAUCET_URL } from "@/lib/wallet/guardianCode";

const cta = "inline-flex h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-xs font-medium text-ink-950 outline-none hover:bg-fg/90 focus-visible:ring-2 focus-visible:ring-ring";

/** The one thing a new owner should do next, with the control that does it. */
export function NextStepCard({ step, owner, onAddDecoy, onScrollHome }: { step: NextStep; owner: string; onAddDecoy: () => void; onScrollHome: () => void }) {
  const c = content(step, owner, onAddDecoy, onScrollHome);
  const done = step.kind === "protected";
  return (
    <section aria-labelledby="next-title" data-testid="next-step" data-step={step.kind}
      className={cn("flex flex-col gap-3 rounded-[10px] border px-4 py-3.5 sm:flex-row sm:items-center", done ? "border-safe/30 bg-safe-soft" : step.kind === "unfreeze" ? "border-trip/40 bg-trip-soft" : "border-line-strong bg-ink-900")}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg border", done ? "border-safe/40 text-safe" : "border-line-strong text-fg-muted")}>
        {done ? <CircleCheck className="size-4" aria-hidden /> : <CircleDot className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-fg-faint">{done ? "Protected" : "Next step"}</p>
        <h2 id="next-title" className="text-[14px] font-medium text-fg">{c.title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]">{c.body}</p>
      </div>
      {c.action && <div className="shrink-0">{c.action}</div>}
    </section>
  );
}

function content(step: NextStep, owner: string, onAddDecoy: () => void, onScrollHome: () => void): { title: string; body: ReactNode; action?: ReactNode } {
  const go = (to: string, label: string) => <Link to={to} className={cta} data-testid="next-action">{label}<ArrowRight className="size-3.5" aria-hidden /></Link>;
  const btn = (label: string, fn: () => void) => <button type="button" onClick={fn} className={cta} data-testid="next-action">{label}<ArrowRight className="size-3.5" aria-hidden /></button>;
  switch (step.kind) {
    case "no-account":
      return { title: "This account is not on testnet yet", body: <>{owner} does not exist on NEAR testnet. Fund it from the <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-fg underline underline-offset-4">testnet faucet</a>, then read again.</> };
    case "protect":
      return { title: "Protect your account", body: "No guardian is watching it. One approval in your wallet deploys the guardian (or creates a guarded agent account) and creates your own bait and watcher; the console shows every NEAR it spends first.", action: go("/app/owner", "Protect your account") };
    case "create-home":
      return { title: "Create your bait and watcher", body: <>Your guardian <span className="font-mono">{step.guardian}</span> is watched by your own watcher account, which does not exist in this browser yet. One approval creates both, with keys kept in this browser.</>, action: btn("Set them up", onScrollHome) };
    case "import-home":
      return { title: "Your bait and watcher keys are elsewhere", body: "They exist on chain, but this browser holds no key for them (another browser or a CLI home made them). Import that home below, or keep running its CLI watcher.", action: btn("Import them", onScrollHome) };
    case "unfreeze":
      return { title: "Your account is frozen", body: <>A freeze deleted the agent keys on <span className="font-mono">{step.guardian}</span>. Find out what leaked below, then unfreeze from your wallet and give the agent a new key.</>, action: go(`/app/owner?guardian=${encodeURIComponent(step.guardian)}`, "Open the owner console") };
    case "add-decoy":
      return { title: "Plant your first decoy", body: "Your bait has no decoy keys yet. Add one here (signed by the bait's own key, no wallet), or run standin dev up with this home exported to the CLI.", action: btn("Add a decoy key", onAddDecoy) };
    case "agent-key":
      return { title: "Give your agent a scoped key", body: <>No agent key is registered on <span className="font-mono">{step.guardian}</span> yet. Export your home to a CLI home below, then in that DIR, from a stand-in checkout: <code className="font-mono text-fg">pnpm standin adopt --wallet --account {step.guardian}{step.guardian !== owner ? ` --owner ${owner}` : ""} --home DIR</code>, and approve its link here. It reuses your bait and watcher and plants a decoy for the agent.</> };
    case "protected":
      return { title: "Your account is guarded", body: "A guardian, your own bait with decoys, and a watcher that can freeze. Everything below is read from testnet." };
  }
}
