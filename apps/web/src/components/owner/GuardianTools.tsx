import { useState } from "react";
import { Fingerprint, KeySquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyText, ExtLink, Panel, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import { explorerTx, type GuardianState } from "@/lib/wallet/near";
import { generateKeyPair, isPublicKey } from "@/lib/wallet/keys";
import { readableError, type TxOutcome } from "@/lib/wallet/connector";
import { hasIntentsKey, readTx, type TxRead } from "@/lib/wallet/txStatus";

type Check = { status: "idle" } | { status: "reading"; hash: string } | { status: "done"; hash: string; line: string; ok: boolean };

/**
 * NEAR Intents: the owner registers a key on the intents registry through the guardian (owner-only add_intents_key, 1 yocto
 * attached by the guardian). A freeze removes every such key, which the registry's has_public_key then shows.
 */
export function IntentsPanel({ guardianId, state, busy, onAdd }: {
  guardianId: string; state: GuardianState; busy: boolean; onAdd: (publicKey: string) => Promise<TxOutcome | null>;
}) {
  const suggested = state.agent_keys.find((k) => !state.intents_keys.includes(k)) ?? "";
  const [key, setKey] = useState(suggested);
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const valid = isPublicKey(key) && !state.intents_keys.includes(key);
  const add = async () => {
    const out = await onAdd(key);
    if (!out?.hash) { setCheck({ status: "idle" }); return; }
    setCheck({ status: "reading", hash: out.hash });
    const on = await hasIntentsKey(state.intents_contract, guardianId, key).catch(() => null);
    setCheck({ status: "done", hash: out.hash, ok: on === true, line: on === null ? "could not read the registry" : `${state.intents_contract}.has_public_key = ${on}` });
  };
  return (
    <Panel title="NEAR Intents key" icon={KeySquare} id="intents-title" meta="owner only" bodyClassName="p-0">
      <div className="space-y-2.5 p-3.5 text-xs" data-testid="intents-panel">
        <p className="leading-relaxed text-fg-muted">
          Registers a key on <span className="font-mono text-fg">{state.intents_contract}</span> for this guardian, so intents it signs can settle. A
          freeze removes every key registered here (one <code className="font-mono">remove_public_key</code> per key).
        </p>
        <div className="space-y-1.5">
          <label htmlFor="intents-key" className="font-medium text-fg">Public key</label>
          <input id="intents-key" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="ed25519:…" autoComplete="off" spellCheck={false}
            aria-invalid={!!key && !valid}
            className="block w-full rounded-md border border-line-strong bg-ink-900 px-2.5 py-1.5 font-mono text-[12px] text-fg outline-none placeholder:text-fg-faint focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-trip/60" />
          <p className="text-[11px] text-fg-faint">
            {suggested && key === suggested ? "Prefilled with this guardian's agent key." : "An agent key, or "}
            {!(suggested && key === suggested) && <button type="button" className="underline underline-offset-4 hover:text-fg" onClick={() => setKey(generateKeyPair().public_key)}>a fresh test key</button>}
            {!(suggested && key === suggested) && " (its secret is not kept: it only shows the freeze removing it)."}
            {key && state.intents_keys.includes(key) ? <span className="text-warn"> Already registered.</span> : key && !isPublicKey(key) ? <span className="text-trip"> Not an ed25519 public key.</span> : null}
          </p>
        </div>
        <Button size="sm" variant="line" className="w-full" data-testid="intents-add" disabled={busy || state.frozen || !valid} onClick={() => void add()}>
          <KeySquare aria-hidden />{state.frozen ? "Frozen: unfreeze first" : busy ? "Waiting for wallet…" : "Add intents key"}
        </Button>
        <CheckLine check={check} />
      </div>
    </Panel>
  );
}

const randomPayload = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Chain Signatures: the owner asks the guardian for an MPC signature over a random 32-byte payload (sign_evm, path
 * standin-evm-1). Frozen, the guardian refuses before the MPC network sees anything; active, the MPC signs. Read back by hash.
 */
export function ChainSigTry({ ownerId, state, busy, onSign }: {
  ownerId: string; state: GuardianState; busy: boolean; onSign: (payloadHex: string, path: string) => Promise<TxOutcome | null>;
}) {
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const run = async () => {
    const out = await onSign(randomPayload(), "standin-evm-1");
    if (!out?.hash) { setCheck({ status: "idle" }); return; }
    setCheck({ status: "reading", hash: out.hash });
    const r: TxRead = await readTx(out.hash, ownerId);
    if (r.status === "failure") setCheck({ status: "done", hash: out.hash, ok: false, line: readableError(r.failure) });
    else if (r.status === "success") setCheck({ status: "done", hash: out.hash, ok: true, line: sigLine(r.value) });
    else setCheck({ status: "done", hash: out.hash, ok: false, line: "No final result yet: the MPC network can take a few blocks. Open the transaction." });
  };
  return (
    <Panel title="Chain Signatures" icon={Fingerprint} id="chainsig-title" meta={<Tag tone={state.frozen ? "trip" : "safe"}>{state.frozen ? "frozen: refused" : "active: signs"}</Tag>} bodyClassName="p-0">
      <div className="space-y-2.5 p-3.5 text-xs" data-testid="chainsig-panel">
        <p className="leading-relaxed text-fg-muted">
          The guardian's <code className="font-mono text-fg">sign_evm</code> asks NEAR's MPC network (<span className="font-mono">v1.signer-prod.testnet</span>) to sign an EVM
          payload for this account. {state.frozen ? "While it is frozen it refuses, so the MPC network never sees the request." : "Freeze it and try again: it refuses before the MPC network sees anything."}
        </p>
        <Button size="sm" variant="line" className="w-full" data-testid="chainsig-try" disabled={busy || check.status === "reading"} onClick={() => void run()}>
          <Fingerprint aria-hidden />{busy ? "Waiting for wallet…" : "Try a Chain Signatures request"}
        </Button>
        <p className="text-[11px] text-fg-faint">One transaction from your wallet, 150 TGas (about 0.15 NEAR up front; unused gas comes back). A random payload; nothing is broadcast to another chain.</p>
        <CheckLine check={check} />
      </div>
    </Panel>
  );
}

function sigLine(v: unknown): string {
  const s = v as { big_r?: { affine_point?: string }; s?: { scalar?: string }; recovery_id?: number } | null;
  if (!s?.big_r?.affine_point) return "Signed by the MPC network.";
  return `Signed by the MPC network: big_r ${shortKey(s.big_r.affine_point, 8, 6)}, s ${shortKey(s.s?.scalar ?? "", 8, 6)}, recovery_id ${s.recovery_id ?? "?"}`;
}

function CheckLine({ check }: { check: Check }) {
  if (check.status === "idle") return null;
  return (
    <div className="space-y-1 rounded-md border border-line bg-ink-900 px-2.5 py-2 text-[11px]" data-testid="tool-readback" aria-live="polite">
      <p className="flex items-center gap-1.5 text-fg-faint">read back from chain · <ExtLink href={explorerTx(check.hash)} className="text-[11px]">{shortKey(check.hash, 8, 6)}</ExtLink></p>
      {check.status === "reading"
        ? <p className="flex items-center gap-1.5 text-fg-muted"><Loader2 className="size-3 animate-spin" aria-hidden />Reading the transaction…</p>
        : <p className={check.ok ? "text-safe [overflow-wrap:anywhere]" : "text-trip [overflow-wrap:anywhere]"}>{check.line}</p>}
      {check.status === "done" && <CopyText value={check.hash} display="copy hash" className="text-[11px]" />}
    </div>
  );
}
