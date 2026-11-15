import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Tag } from "@/components/app/common";
import { shortHash } from "@/lib/lab/types";
import { explorerAccount, explorerTx } from "@/lib/wallet/near";
import { GUARDIAN_CODE_HASH } from "@/lib/wallet/guardianCode";
import { FACTORY_GUARDIAN_HASH, MPC_SIGNER, type GuardianReport, type KeyRow } from "@/lib/verify/guardian";
import type { KeyPermission } from "@/lib/tabwatcher/rpc";
import type { FreezeTxs, ServedWasm } from "@/lib/verify/useGuardianCheck";
import { cn } from "@/lib/utils";

const NEAR = 10n ** 24n;
const near = (y: string | null) => (y === null ? "unlimited" : `${(Number((BigInt(y) * 1000n) / NEAR) / 1000).toString()} NEAR`);
const pk = (k: string) => shortHash(k.replace("ed25519:", ""), 6, 4);

export const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-4 hover:text-fg hover:underline">{children}<ArrowUpRight aria-hidden className="size-3" /></a>
);

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[10px] border border-line bg-ink-950" aria-label={title}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">{title}</h3>
        {right}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function R({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 py-1 text-[12.5px]">
      <dt className="text-fg-faint">{k}</dt>
      <dd className="min-w-0 font-mono text-[12px] [overflow-wrap:anywhere] text-fg-muted">{children}</dd>
    </div>
  );
}

function permText(p: KeyPermission | null): string {
  if (!p) return "not on chain (deleted)";
  if (p === "FullAccess") return "full access";
  const f = p.FunctionCall;
  return `function-call · ${f.receiver_id} · ${f.method_names.length ? f.method_names.join(", ") : "any method"} · ${near(f.allowance)}`;
}

const WATCHER_TAG = { "self-serve": ["safe", "self-serve: watch.<owner>"], project: ["warn", "Stand-in's project watcher"], other: ["muted", "another account"] } as const;

function keysSummary(keys: KeyRow[]) {
  const full = keys.filter((k) => k.permission === "FullAccess").length;
  return `${full} full-access, ${keys.length - full} function-call`;
}

export function GuardianFacts({ r, freezeTxs, served }: { r: GuardianReport; freezeTxs: FreezeTxs; served: ServedWasm }) {
  const s = r.state;
  const pinned = r.codeHash === GUARDIAN_CODE_HASH;
  const factory = r.codeHash === FACTORY_GUARDIAN_HASH;
  const [wTone, wText] = WATCHER_TAG[r.watcher.kind];
  const last = s.freeze_log.at(-1);
  const deletedLast = s.frozen && last ? last.deleted_keys.length : 0;
  const removedLast = s.frozen && last ? last.intents_keys_removed.length : 0;
  const freezeKeys = (r.watcher.keys ?? []).filter((k) => typeof k.permission === "object" && k.permission.FunctionCall.receiver_id === r.account && k.permission.FunctionCall.method_names.includes("freeze"));
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="guardian-facts">
      <Card title="Code" right={<Tag tone={pinned || factory ? "safe" : "warn"}>{pinned ? "pinned hash" : factory ? "factory build" : "unknown build"}</Tag>}>
        <dl>
          <R k="code hash">{r.codeHash}</R>
          <R k="pinned">{GUARDIAN_CODE_HASH}{pinned ? <span className="text-safe"> · match</span> : null}</R>
          {!pinned ? <R k="factory build">{FACTORY_GUARDIAN_HASH}{factory ? <span className="text-safe"> · match</span> : null}</R> : null}
          {pinned ? <R k="served wasm">{served.status === "ok" ? <>{served.hash === GUARDIAN_CODE_HASH ? <span className="text-safe">hashes to the pinned value</span> : served.hash}{" "}<span className="text-fg-faint">(re-hashed in this browser)</span></> : served.status === "error" || served.status === "mismatch" ? <span className="text-trip">{served.message}</span> : served.status === "loading" ? "hashing /guardian/standin_guardian.wasm…" : "—"}</R> : null}
          <R k="storage">{r.storageBytes.toLocaleString("en-US")} bytes</R>
        </dl>
      </Card>
      <Card title="State" right={s.frozen ? <Tag tone="trip">frozen</Tag> : <Tag tone="safe">active</Tag>}>
        <dl>
          <R k="owner"><Ext href={explorerAccount(s.owner)}>{s.owner}</Ext>{s.owner === r.account ? <span className="text-fg-faint"> · the account itself</span> : r.isFactory ? <span className="text-fg-faint"> · factory owner{r.factoryListed ? ", listed by guardians_of" : r.factoryListed === false ? ", NOT listed by guardians_of" : ""}</span> : null}</R>
          <R k="watcher"><Ext href={explorerAccount(s.watcher)}>{s.watcher}</Ext></R>
          <R k="watcher looks"><Tag tone={wTone}>{wText}</Tag>{r.watcher.exists === false ? <span className="text-trip"> · account does not exist</span> : null}</R>
          {r.watcher.keys ? <R k="watcher keys">{keysSummary(r.watcher.keys)}{freezeKeys.length ? <span className="text-fg-faint"> · {freezeKeys.length} may only call freeze here (a browser home)</span> : null}</R> : null}
          <R k="intents contract">{s.intents_contract}</R>
          <R k="account keys">{keysSummary(r.accessKeys)}{r.isFactory && !r.accessKeys.length ? <span className="text-fg-faint"> · keyless, as the factory makes it</span> : null}</R>
        </dl>
      </Card>
      <Card title={`Agent keys · ${s.agent_keys.length}`}>
        {r.agentKeys.length ? (
          <ul className="space-y-1.5">{r.agentKeys.map((a) => (
            <li key={a.key} className="font-mono text-[11.5px] [overflow-wrap:anywhere] text-fg-muted"><span className="text-fg">{pk(a.key)}</span> · <span className={cn(!a.onChain && "text-trip")}>{permText(a.onChain)}</span></li>
          ))}</ul>
        ) : <p className="text-[12.5px] text-fg-faint">{deletedLast ? `None: the last freeze deleted ${deletedLast}.` : "None registered."}</p>}
      </Card>
      <Card title={`Intents keys · ${s.intents_keys.length}`} right={<Tag tone={s.frozen ? "trip" : "safe"}>{s.frozen ? "sign_evm refused" : "sign_evm allowed"}</Tag>}>
        {r.intents.length ? (
          <ul className="space-y-1.5">{r.intents.map((i) => (
            <li key={i.key} className="font-mono text-[11.5px] text-fg-muted"><span className="text-fg">{pk(i.key)}</span> · has_public_key on {s.intents_contract}: <span className={i.registered ? "text-safe" : "text-trip"}>{i.registered === null ? "unreadable" : String(i.registered)}</span></li>
          ))}</ul>
        ) : <p className="text-[12.5px] text-fg-faint">{removedLast ? `None: the last freeze removed ${removedLast} from the intents registry.` : "None registered."}</p>}
        <p className="mt-2 text-[12px] leading-relaxed text-fg-faint">Chain Signatures: the guardian forwards the owner's <span className="font-mono">sign_evm</span> to {MPC_SIGNER} and refuses it while frozen (its code; the state's frozen flag is {String(s.frozen)}).</p>
      </Card>
      <div className="md:col-span-2">
        <Card title={`Freeze log · ${s.freeze_log.length}`}>
          {s.freeze_log.length ? (
            <ol className="divide-y divide-line">{s.freeze_log.slice().reverse().map((f) => {
              const ft = freezeTxs[f.at_block];
              return (
                <li key={f.at_block + f.by} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
                    <span className="font-mono text-fg tabular-nums">block {Number(f.at_block).toLocaleString("en-US")}</span>
                    <span className="font-mono text-[11.5px] text-fg-muted">by {f.by}{f.by === s.watcher ? " (watcher)" : f.by === s.owner ? " (owner)" : ""}</span>
                  </p>
                  <p className="text-[12.5px] [overflow-wrap:anywhere] text-fg-muted">{f.reason}</p>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11.5px] text-fg-faint">
                    {f.tx_hash ? <Ext href={explorerTx(f.tx_hash)}>theft {shortHash(f.tx_hash)}</Ext> : <span>{f.decoy_public_key ? "theft tx not recorded" : "no theft tx (manual freeze)"}</span>}
                    {ft === "loading" ? <span>finding the freeze tx…</span> : typeof ft === "string" && ft !== "unreachable" ? <Ext href={explorerTx(ft)}>freeze {shortHash(ft)}</Ext> : ft === null ? <span>freeze tx not found in blocks {Number(f.at_block) - 3}–{Number(f.at_block)}</span> : ft === "unreachable" ? <span>freeze tx: RPC did not answer</span> : <span>older record: freeze tx not looked up</span>}
                    {f.decoy_public_key ? <span>decoy {pk(f.decoy_public_key)}</span> : null}
                    <span>{f.deleted_keys.length} agent key(s) deleted · {f.intents_keys_removed.length} intents key(s) removed</span>
                  </p>
                </li>
              );
            })}</ol>
          ) : <p className="text-[12.5px] text-fg-faint">Never frozen.</p>}
        </Card>
      </div>
    </div>
  );
}
