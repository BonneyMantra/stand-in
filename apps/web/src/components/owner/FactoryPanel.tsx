import { useCallback, useEffect, useState } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtLink, Panel, Shimmer, Tag } from "@/components/app/common";
import { cn } from "@/lib/utils";
import { accountExists, explorerAccount } from "@/lib/wallet/near";
import { FAUCET_URL, nearShort, viewAccount } from "@/lib/wallet/guardianCode";
import { quoteFactory, shortOf } from "@/lib/wallet/funding";
import { ownsWatcher, watcherFor } from "@/lib/wallet/homeAccounts";
import { FACTORY, GuardianName, guardiansOf, requiredDeposit } from "@/lib/wallet/factory";

type Load = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; deposit: bigint; guardians: string[]; amount: bigint; storageBytes: bigint };

/**
 * "Create a guarded agent account": the factory makes <name>.guard.si-project-5289.testnet with a guardian whose owner is
 * the connected account. Lists the owner's guardians (guardians_of) so the console can act on one.
 */
export function FactoryPanel({ ownerId, eth, busy, selected, reloadKey, onCreate, onSelect }: {
  ownerId: string; eth: boolean; busy: boolean; selected: string | null; reloadKey: number;
  onCreate: (name: string, deposit: bigint) => void; onSelect: (id: string | null) => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [name, setName] = useState("");
  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const [deposit, guardians, owner] = await Promise.all([requiredDeposit(), guardiansOf(ownerId), viewAccount(ownerId)]);
      // The owner's storage (a deployed guardian, for one) stays locked: the quote counts it before the deposit.
      setLoad({ status: "ready", deposit, guardians, amount: owner.amount, storageBytes: owner.storageUsage });
      // A name that is now one of this owner's guardians was just created: clear it so it is not offered again.
      setName((n) => (n && guardians.includes(`${n}.${FACTORY}`) ? "" : n));
    } catch (e) {
      setLoad({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [ownerId]);
  useEffect(() => { void reload(); }, [reload, reloadKey]);

  const parsed = GuardianName.safeParse(name);
  const id = `${name || "name"}.${FACTORY}`;
  // Shared with the CLI (packages/core/src/funding.ts): locked storage + the factory's required_deposit + up-front gas.
  const quote = load.status === "ready" ? quoteFactory({ storageBytes: load.storageBytes, deposit: load.deposit }) : null;
  const short = quote && load.status === "ready" ? shortOf(load.amount, quote) : 0n;
  // Ask the chain whether the account exists before offering to sign: a taken name only costs gas and a refund.
  const [taken, setTaken] = useState<{ id: string; exists: boolean | null } | null>(null);
  useEffect(() => {
    if (!parsed.success) return;
    let alive = true;
    const t = setTimeout(() => {
      setTaken({ id, exists: null });
      accountExists(id).then((exists) => alive && setTaken({ id, exists }), () => alive && setTaken(null));
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [id, parsed.success]);
  const isTaken = taken?.id === id && taken.exists === true;
  const checking = parsed.success && (taken?.id !== id || taken.exists === null);
  const nameError = name && !parsed.success ? parsed.error.issues[0]?.message : isTaken ? `${id} already exists on testnet: pick another name` : null;

  return (
    <Panel title="Create a guarded agent account" icon={Boxes} id="factory-title" meta={eth ? "for an Ethereum wallet owner" : "optional for a NEAR account"} bodyClassName="p-0"
      actions={<Button variant="quiet" size="icon-xs" onClick={() => void reload()} aria-label="Read guardians again"><RefreshCw aria-hidden /></Button>}>
      <div className="space-y-3 p-3.5 text-xs">
        <p className="leading-relaxed text-fg-muted">
          The factory <ExtLink href={explorerAccount(FACTORY)}>{FACTORY}</ExtLink> creates a new account for the agent with the guardian already
          on it. Its owner is <span className="font-mono break-all text-fg">{ownerId}</span>; the account itself has no keys, so every owner call
          is signed by this wallet. Watcher: <span className="font-mono break-all text-fg">{watcherFor(ownerId)}</span> (freeze only){ownsWatcher(ownerId, watcherFor(ownerId))
            ? <>, your own account: <code className="font-mono text-fg">standin adopt --wallet --account &lt;name&gt;.{FACTORY} --owner {ownerId} --home DIR</code> creates it, with the bait, and runs it on your machine.</>
            : <>: a 0x account cannot create sub-accounts, so no watcher of yours can run for it yet; freeze it from this console.</>}
        </p>
        <div className="space-y-1.5">
          <label htmlFor="guardian-name" className="font-medium text-fg">Name</label>
          <input id="guardian-name" value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="build-agent-1" maxLength={40}
            aria-invalid={!!nameError} autoComplete="off" spellCheck={false}
            className="block w-full rounded-md border border-line-strong bg-ink-900 px-2.5 py-1.5 font-mono text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-trip/60" />
          <p className={cn("font-mono text-[11px] break-all", nameError ? "text-trip" : "text-fg-faint")} data-testid="factory-name-hint">{nameError ?? id}</p>
        </div>
        <div className="rounded-md border border-line bg-ink-900 px-2.5 py-2 text-[11px] leading-relaxed text-fg-muted" data-testid="factory-deposit">
          {load.status === "ready" ? (
            <>Deposit <span className="font-mono text-fg">{nearShort(load.deposit, 3)} NEAR</span> (the factory's required_deposit). It moves into the new
              account: most is locked for the guardian's code and state, about 0.3 NEAR stays withdrawable by you.
              {short > 0n ? (
                <span className="mt-1.5 block text-warn" data-testid="factory-shortfall">
                  {ownerId} holds {nearShort(load.amount, 3)} NEAR and this needs {nearShort(quote!.total, 3)} ({quote!.lines.map((l) => `${nearShort(l.yocto, 3)} ${l.label}`).join(" + ")}):
                  short by {nearShort(short, 3)} NEAR, so nothing is offered for signing. Add testnet NEAR from the <ExtLink href={FAUCET_URL}>testnet faucet</ExtLink>, then read again.
                </span>
              ) : null}</>
          ) : load.status === "error" ? <span className="text-trip">Could not read the factory: {load.error}</span> : <Shimmer className="h-4 w-48" />}
        </div>
        <Button size="sm" variant="invert" className="w-full sm:w-auto" data-testid="factory-create"
          disabled={busy || !parsed.success || isTaken || checking || load.status !== "ready" || short > 0n} onClick={() => load.status === "ready" && parsed.success && onCreate(parsed.data, load.deposit)}>
          <Boxes aria-hidden />{busy ? "Waiting for wallet…" : "Review and sign in wallet"}
        </Button>
      </div>
      <div className="border-t border-line">
        <p className="px-3.5 pt-2.5 text-[11px] text-fg-faint">Your guardians (guardians_of)</p>
        {load.status === "ready" && load.guardians.length === 0 && <p className="px-3.5 py-2.5 text-xs text-fg-faint">None yet.</p>}
        <ul className="divide-y divide-line" data-testid="factory-guardians">
          {load.status === "ready" && load.guardians.map((g) => (
            <li key={g} className="flex min-w-0 items-center gap-2 px-3.5 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={g}>{g}</span>
              {selected === g ? <Tag tone="safe">open</Tag> : <Button variant="line" size="xs" onClick={() => onSelect(g)}>Open</Button>}
            </li>
          ))}
        </ul>
        {selected && <div className="px-3.5 pb-3"><Button variant="quiet" size="xs" onClick={() => onSelect(null)}>Back to {ownerId.length > 24 ? "my account" : ownerId}</Button></div>}
      </div>
    </Panel>
  );
}
