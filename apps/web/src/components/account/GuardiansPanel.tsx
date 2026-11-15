import { Link } from "react-router";
import { ShieldCheck } from "lucide-react";
import { CopyText, EmptyState, ExtLink, Panel, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import type { AccountSnapshot, GuardianView } from "@/data/account";
import { explorerAccount } from "@/lib/wallet/near";

/** The owner's guardians, each with its on-chain state: frozen or active, agent keys, intents keys, freezes logged. */
export function GuardiansPanel({ snapshot }: { snapshot: AccountSnapshot }) {
  const { guardians, unreadable } = snapshot;
  return (
    <Panel title="Guardians" icon={ShieldCheck} id="guardians-title" meta={`${guardians.length} on testnet`} bodyClassName="p-0">
      {guardians.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No guardian yet" className="py-8">
          <p data-testid="guardians-empty">
            {snapshot.self.kind === "not-guardian"
              ? `${snapshot.owner} runs another contract, so the guardian cannot go on it. Create a guarded agent account instead.`
              : `Nothing is guarding ${snapshot.owner} or an agent account it owns.`}
          </p>
          <Link to="/app/owner" className="mt-3 inline-block font-medium text-fg underline-offset-4 hover:underline">Protect your account</Link>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line" data-testid="guardians">
          {guardians.map((g) => <GuardianRow key={g.id} g={g} owner={snapshot.owner} ownWatcher={snapshot.watcher.id} />)}
        </ul>
      )}
      {unreadable.length > 0 && (
        <p className="border-t border-line px-3.5 py-2.5 text-[11px] text-warn" data-testid="guardians-unreadable">
          Could not read {unreadable.map((u) => `${u.id} (${u.why})`).join(", ")}.
        </p>
      )}
    </Panel>
  );
}

function GuardianRow({ g, owner, ownWatcher }: { g: GuardianView; owner: string; ownWatcher: string }) {
  const s = g.state;
  const consoleTo = g.hosted === "self" ? "/app/owner" : `/app/owner?guardian=${encodeURIComponent(g.id)}`;
  return (
    <li className="space-y-2 px-3.5 py-3" data-testid="guardian-row" data-guardian={g.id}>
      <div className="flex flex-wrap items-center gap-2">
        <ExtLink href={explorerAccount(g.id)} className="min-w-0 text-[13px] text-fg [overflow-wrap:anywhere]">{g.id}</ExtLink>
        <Tag tone="muted">{g.hosted === "self" ? "your account" : g.hosted === "factory" ? "guarded agent account" : "owned by you"}</Tag>
        <Tag tone={s.frozen ? "trip" : "safe"}><span data-testid="guardian-state">{s.frozen ? "frozen" : "active"}</span></Tag>
        <Link to={consoleTo} className="ml-auto text-[11px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">Owner console</Link>
      </div>
      <p className="text-[11px] text-fg-muted [overflow-wrap:anywhere]">
        Watcher <span className="font-mono text-fg">{s.watcher}</span>{" "}
        {s.watcher === ownWatcher ? <Tag tone="safe" className="ml-1">yours</Tag> : <Tag tone="muted" className="ml-1">the project's</Tag>}
        {g.hosted !== "self" && <> · owner <span className="font-mono">{owner}</span></>}
        {" "}· {s.freeze_log.length} freeze{s.freeze_log.length === 1 ? "" : "s"} logged
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <KeyList title="Agent keys" keys={s.agent_keys} empty={s.frozen ? "None: the freeze deleted them." : "None registered."} />
        <KeyList title="Intents keys" keys={s.intents_keys} empty="None registered." />
      </div>
    </li>
  );
}

function KeyList({ title, keys, empty }: { title: string; keys: string[]; empty: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-ink-900">
      <p className="flex items-baseline justify-between border-b border-line px-2.5 py-1.5 text-[11px]">
        <span className="text-fg-muted">{title}</span><span className="font-mono text-fg-faint">{keys.length}</span>
      </p>
      {keys.length === 0 ? <p className="px-2.5 py-2 text-[11px] text-fg-faint">{empty}</p> : (
        <ul className="divide-y divide-line">
          {keys.map((k) => <li key={k} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5"><span className="size-1.5 shrink-0 rounded-full bg-safe" aria-hidden /><CopyText value={k} display={shortKey(k, 8, 6)} /></li>)}
        </ul>
      )}
    </div>
  );
}
