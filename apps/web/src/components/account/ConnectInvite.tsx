import { Link } from "react-router";
import { ArrowRight, History, KeyRound, ShieldCheck, Snowflake, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/app/common";

const STEPS = [
  { icon: Wallet, t: "Connect your testnet wallet", d: "Meteor, Intear, Ledger, Nightly, NEAR CLI or MetaMask (Ethereum Wallets), through NEAR Connect. Your owner key stays in the wallet." },
  { icon: ShieldCheck, t: "Protect your account", d: "One approval deploys the guardian (or creates a guarded agent account) and creates your own bait and watcher. You see every NEAR it spends first." },
  { icon: KeyRound, t: "Plant decoys", d: "Decoy keys are keys on your bait. Add one here, or let the CLI plant them where agents look for keys." },
  { icon: Snowflake, t: "A decoy signs: your account freezes", d: "Your own watcher deletes the agent's keys through the guardian. This page shows it from chain." },
];

/** /app without a wallet: what My account is, how to start, and the recorded example as the secondary path. */
export function ConnectInvite({ connecting, onConnect }: { connecting: boolean; onConnect: () => void }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="connect-invite">
      <Panel title="Your account, read from chain" icon={Wallet} id="invite-title" bodyClassName="p-0">
        <div className="space-y-2 px-3.5 pt-3.5 pb-1">
          <p className="text-[15px] font-medium text-fg">Connect a wallet to see your own guardians, keys and decoys.</p>
          <p className="text-xs leading-relaxed text-fg-muted">
            Everything on My account is read from NEAR testnet for the account you connect: nothing here is sample data. A new account starts empty,
            and this page tells you the next step.
          </p>
        </div>
        <ol className="divide-y divide-line">
          {STEPS.map((s, i) => (
            <li key={s.t} className="flex gap-3 px-3.5 py-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-ink-850 text-fg-muted"><s.icon className="size-3.5" aria-hidden /></span>
              <div className="min-w-0">
                <p className="text-[13px] text-fg"><span className="mr-1.5 font-mono text-[11px] text-fg-faint">{i + 1}</span>{s.t}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3 border-t border-line p-3.5">
          <Button variant="invert" size="sm" onClick={onConnect} disabled={connecting} data-testid="invite-connect">
            <Wallet aria-hidden />{connecting ? "Waiting for wallet…" : "Connect wallet"}
          </Button>
          <span className="text-[11px] text-fg-faint">Testnet only. No testnet NEAR yet? The setup quotes what it needs and links the faucet.</span>
        </div>
      </Panel>
      <Panel title="No wallet?" icon={History} id="example-title" bodyClassName="p-0">
        <div className="space-y-3 p-3.5 text-xs leading-relaxed text-fg-muted">
          <p>See what a protected account looks like: a recorded testnet run on the project's own accounts, with real transactions. It is an example, not your data.</p>
          <Link to="/app/example" className="inline-flex items-center gap-1.5 font-medium text-fg underline-offset-4 hover:underline" data-testid="invite-example">
            See an example<ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <p className="border-t border-line pt-3">Or leak a decoy yourself in the <Link to="/lab" className="text-fg underline-offset-4 hover:underline">lab</Link>: a real theft and freeze on testnet, no wallet needed.</p>
        </div>
      </Panel>
    </div>
  );
}
