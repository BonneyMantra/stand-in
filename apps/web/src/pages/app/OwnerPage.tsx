import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { ExtLink, PageHeader, Panel } from "@/components/app/common";
import { WalletControl } from "@/components/owner/WalletControl";
import { GuardianPanel } from "@/components/owner/GuardianPanel";
import { OwnerActions } from "@/components/owner/OwnerActions";
import { ActivityLog, type TxEntry } from "@/components/owner/ActivityLog";
import { ApprovePanel, type ApproveResult } from "@/components/owner/ApprovePanel";
import { AdoptPanel } from "@/components/owner/AdoptPanel";
import { ProtectPanel, type ProtectInit } from "@/components/owner/ProtectPanel";
import { FactoryPanel } from "@/components/owner/FactoryPanel";
import { WithdrawPanel } from "@/components/owner/WithdrawPanel";
import { FACTORY, guardiansOf, isFactoryGuardian, sendCreateGuardian } from "@/lib/wallet/factory";
import { DEFAULT_INTENTS, DEFAULT_WATCHER } from "@/lib/wallet/guardianCode";
import { useNearWallet } from "@/components/owner/useNearWallet";
import { useGuardian } from "@/components/owner/useGuardian";
import { parseDeepLink, type AdoptRequest, type ApproveRequest } from "@/lib/wallet/deeplink";
import { readableError, sendDeployTx, sendOwnerTx, type OwnerCall, type TxOutcome } from "@/lib/wallet/connector";
import { explorerTx, isEthAccount, looksMainnet, readGuardian, viewAccessKey } from "@/lib/wallet/near";
import type { GuardianCode } from "@/lib/wallet/guardianCode";
import type { NearWalletBase } from "@hot-labs/near-connect";

// NEAR Connect's manifest, filtered to testnet + signAndSendTransaction. WalletConnect and Unity also qualify but NEAR Connect
// drops wallets that need WalletConnect unless a WalletConnect projectId is configured; this site has none.
const TESTNET_WALLETS = "Meteor, Intear, Nightly, Ledger, NEAR CLI and Ethereum Wallets (MetaMask). WalletConnect and Unity need a WalletConnect project id this site does not have, so they are not listed";

export default function OwnerPage() {
  const { search } = useLocation();
  const link = useMemo(() => parseDeepLink(search), [search]);
  const w = useNearWallet();
  const wrongNet = w.status === "connected" && !!w.accountId && looksMainnet(w.accountId);
  // The guardian account: the link's `account` when a link is open, else the connected account (self-hosted guardian).
  // A factory guardian lives on another account and is owned by the connected one (get_state.owner).
  const [picked, setPicked] = useState<string | null>(null);
  const [factoryKey, setFactoryKey] = useState(0);
  const target = link.kind === "ok" || link.kind === "adopt" ? link.req.account : picked ?? w.accountId;
  const eth = !!w.accountId && isEthAccount(w.accountId);
  const { read, refresh } = useGuardian(w.status === "connected" && !wrongNet ? target : null);
  const [log, setLog] = useState<TxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState<ApproveResult | null>(null);
  const [deployed, setDeployed] = useState<string | null>(null);
  const nextId = useRef(1);
  // Everything this page remembers belongs to the connected account: a switch (or disconnect) starts clean, so another
  // account's selected guardian, deploy notice or transactions never show under the new one.
  const seenAccount = useRef(w.accountId);
  useEffect(() => {
    if (seenAccount.current === w.accountId) return;
    seenAccount.current = w.accountId;
    setPicked(null); setDeployed(null); setApproved(null); setLog([]);
  }, [w.accountId]);

  const lookup = read.status === "ready" ? read.lookup : read.status === "loading" ? read.previous : undefined;
  const guardian = lookup?.kind === "guardian" ? lookup.state : null;
  const isOwner = !!guardian && guardian.owner === w.accountId;

  // `landed` re-reads the chain when the wallet gives no result (window closed, or an error after broadcasting: Meteor
  // Web reported "Cannot read properties of undefined" after create_guardian had landed, 15 Nov). Never claim
  // "nothing was sent" from a missing answer alone.
  const run = useCallback(async (label: string, send: (wallet: NearWalletBase, accountId: string) => Promise<TxOutcome>, landed?: () => Promise<boolean>) => {
    const wallet = w.wallet.current;
    if (!wallet || !w.accountId) return null;
    const id = nextId.current++;
    const patch = (p: Partial<TxEntry>) => setLog((l) => l.map((e) => (e.id === id ? { ...e, ...p } : e)));
    setLog((l) => [{ id, label, status: "pending", message: "Confirm in your wallet", at: Date.now() }, ...l]);
    setBusy(true);
    try {
      const out = await send(wallet, w.accountId);
      if (out.failure) patch({ status: "failed", hash: out.hash || undefined, message: readableError(out.failure) });
      else patch({ status: "ok", hash: out.hash, message: "Landed on testnet. State read again from chain." });
      return out.failure ? null : out;
    } catch (e) {
      const msg = readableError(e);
      const rejected = /rejected in the wallet/.test(msg);
      const onChain = !rejected && landed ? await landed().catch(() => false) : false;
      if (onChain) patch({ status: "ok", message: "Landed on testnet: the wallet gave no result, so this was confirmed by reading the chain." });
      else patch({ status: "failed", message: rejected || !landed ? msg : `${msg} Nothing new was found on chain.` });
      return onChain ? { hash: "" } : null;
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [w.wallet, w.accountId, refresh]);

  const owner = (label: string, calls: OwnerCall[], landed?: () => Promise<boolean>) =>
    run(label, (wallet, id) => sendOwnerTx(wallet, id, target ?? id, calls), landed);
  const frozenIs = (want: boolean) => async () => {
    const g = target ? await readGuardian(target) : null;
    return g?.kind === "guardian" && g.state.frozen === want;
  };
  const keyIsOn = (account: string, key: string) => async () => (await viewAccessKey(account, key)) !== null;
  const freeze = (reason: string) => void owner("freeze", [{ method: "freeze", args: { reason, decoy_public_key: null, tx_hash: null } }], frozenIs(true));
  const unfreeze = () => void owner("unfreeze", [{ method: "unfreeze", args: {} }], frozenIs(false));
  const protect = async (code: GuardianCode, init: ProtectInit) => {
    const isGuardian = async () => !!w.accountId && (await readGuardian(w.accountId)).kind === "guardian";
    const out = await run("deploy guardian + new", (wallet, id) => sendDeployTx(wallet, id, code.bytes, init), isGuardian);
    if (out?.hash) setDeployed(out.hash);
  };
  const addKeyCall = (r: { agent_key: string; receiver: string; methods: string[]; allowance: bigint }): OwnerCall =>
    ({ method: "add_agent_key", args: { public_key: r.agent_key, receiver_id: r.receiver, method_names: r.methods, allowance: r.allowance.toString() } });
  const adopt = async (req: AdoptRequest, code: GuardianCode | null) => {
    const out = code
      ? await run("deploy guardian + new + add_agent_key", (wallet, id) => sendDeployTx(wallet, id, code.bytes, { watcher: req.watcher, intents_contract: req.intents }, [addKeyCall(req)]), keyIsOn(req.account, req.agent_key))
      : await owner("add_agent_key", [addKeyCall(req)], keyIsOn(req.account, req.agent_key));
    if (out) setApproved({ hash: out.hash, key: await viewAccessKey(req.account, req.agent_key).catch(() => null) });
  };
  const create = async (name: string, deposit: bigint) => {
    let created: string | null = null;
    const expected = `${name}.${FACTORY}`;
    const listed = async () => {
      const mine = w.accountId ? await guardiansOf(w.accountId) : [];
      if (mine.includes(expected)) created = expected;
      return created !== null;
    };
    const out = await run(`create_guardian ${name}`, async (wallet, id) => {
      const r = await sendCreateGuardian(wallet, id, name, DEFAULT_WATCHER, DEFAULT_INTENTS, deposit);
      created = r.guardianId;
      return r.failure || r.guardianId ? r : { ...r, failure: "The factory returned null: the name is taken or creation failed. The deposit was refunded." };
    }, listed);
    setFactoryKey((k) => k + 1);
    if (out && created) { setPicked(created); if (out.hash) setDeployed(out.hash); }
  };
  const withdraw = (yocto: bigint) => void owner("withdraw", [{ method: "withdraw", args: { amount: yocto.toString() } }]).then(() => setFactoryKey((k) => k + 1));
  const switchAccount = async () => { await w.disconnect(); await w.connect(); };
  const approve = async (req: ApproveRequest, unfreezeFirst: boolean) => {
    const calls: OwnerCall[] = [...(unfreezeFirst ? [{ method: "unfreeze" as const, args: {} }] : []), addKeyCall(req)];
    const out = await owner(unfreezeFirst ? "unfreeze + add_agent_key" : "add_agent_key", calls, keyIsOn(req.account, req.agent_key));
    if (out) setApproved({ hash: out.hash, key: await viewAccessKey(req.account, req.agent_key).catch(() => null) });
  };

  const factory = w.accountId && (
    <FactoryPanel ownerId={w.accountId} eth={eth} busy={busy} selected={picked} reloadKey={factoryKey}
      onCreate={(n, d) => void create(n, d)} onSelect={setPicked} />
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Owner console"
        sub={<>The main owner path: your own NEAR wallet protects the account and signs every owner call. Testnet. No wallet?
          The judge route is <Link to="/lab" className="text-fg-muted underline underline-offset-4">/lab</Link>,{" "}
          <Link to="/verify" className="text-fg-muted underline underline-offset-4">/verify</Link> and the CLI.</>}
        actions={<WalletControl info={w} onConnect={() => void w.connect()} onDisconnect={() => void w.disconnect()} />}
      />

      {w.error && (
        <Alert variant="destructive" data-testid="wallet-error">
          <AlertTitle>Wallet</AlertTitle>
          <AlertDescription><p>{w.error}</p></AlertDescription>
        </Alert>
      )}

      {(link.kind === "adopt" || (link.kind === "invalid" && link.op === "adopt")) && (
        <AdoptPanel
          link={link} accountId={w.status === "connected" ? w.accountId : null} guardian={lookup}
          busy={busy} result={approved} onAdopt={(r, c) => void adopt(r, c)} onSwitch={() => void switchAccount()}
        />
      )}

      {deployed && (
        <Alert variant="success" data-testid="deployed">
          <AlertTitle>{picked ? "Guarded agent account created" : "Guardian deployed"}</AlertTitle>
          <AlertDescription>
            <p>{picked ? <><span className="font-mono break-all">{picked}</span> is yours; the console below is read back from chain.</> : "The account is protected; the console below is read back from chain."} Transaction <ExtLink href={explorerTx(deployed)}>{deployed.slice(0, 12)}…</ExtLink></p>
          </AlertDescription>
        </Alert>
      )}

      {(link.kind === "ok" || (link.kind === "invalid" && link.op !== "adopt")) && (
        <ApprovePanel
          link={link} accountId={w.status === "connected" ? w.accountId : null} guardian={lookup}
          busy={busy} result={approved} onApprove={(r, u) => void approve(r, u)}
        />
      )}

      {w.status === "connected" && w.accountId ? (
        wrongNet ? (
          <Alert variant="warning" data-testid="wrong-network">
            <AlertTitle>Wrong network</AlertTitle>
            <AlertDescription>
              <p><span className="font-mono break-all">{w.accountId}</span> is a mainnet account. This console signs on testnet only: switch the wallet
              to testnet, then disconnect and connect again. The guardian is not deployed on mainnet accounts from here.</p>
            </AlertDescription>
          </Alert>
        ) : (
          // Below xl the two columns dissolve (display: contents) into one ordered column: the guardian and its owner
          // actions come before the optional factory panel, so Freeze is never below the fold of an unrelated form.
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="contents xl:block xl:min-w-0 xl:space-y-4">
              {lookup && lookup.kind !== "guardian" && link.kind !== "adopt" && target === w.accountId && (
                <div className="order-1 min-w-0"><ProtectPanel accountId={w.accountId} lookup={lookup} busy={busy} onDeploy={(c, i) => void protect(c, i)} /></div>
              )}
              {eth && link.kind === "none" && <div className="order-2 min-w-0">{factory}</div>}
              <div className="order-3 min-w-0"><GuardianPanel accountId={target ?? w.accountId} read={read} onRefresh={() => void refresh()} /></div>
              {!eth && link.kind === "none" && <div className="order-6 min-w-0">{factory}</div>}
            </div>
            <div className="contents xl:block xl:space-y-4">
              {guardian && isOwner && <div className="order-4 min-w-0"><OwnerActions state={guardian} busy={busy} onFreeze={freeze} onUnfreeze={unfreeze} /></div>}
              {guardian && isOwner && target && isFactoryGuardian(target) && (
                <div className="order-5 min-w-0"><WithdrawPanel guardianId={target} ownerId={w.accountId} busy={busy} reloadKey={factoryKey} onWithdraw={withdraw} /></div>
              )}
              {guardian && !isOwner && (
                <Alert variant="warning" data-testid="not-owner" className="order-4">
                  <AlertTitle>Not this guardian's owner</AlertTitle>
                  <AlertDescription>
                    <p>Its owner is <span className="font-mono break-all">{guardian.owner}</span>; connected as <span className="font-mono break-all">{w.accountId}</span>. Owner actions need the owner's wallet.</p>
                  </AlertDescription>
                </Alert>
              )}
              <div className="order-7 min-w-0"><ActivityLog entries={log} /></div>
            </div>
          </div>
        )
      ) : w.status === "restoring" ? null : (
        <ConnectPrompt onConnect={() => void w.connect()} connecting={w.status === "connecting"} />
      )}
    </div>
  );
}

const STEPS: [string, string][] = [
  ["The guardian lives on your account", "Connect, then Protect this account: your wallet deploys it on the account itself, so it can delete that account's agent keys. Meteor refuses contract deployment and a MetaMask (0x) account already runs NEAR's wallet contract: with either, create a guarded agent account instead (one function call)."],
  ["Its owner is the account", "Unfreeze and adding agent keys need a transaction signed by the account's own full-access key, the one your wallet holds."],
  ["Your wallet signs; this page never holds a key", `Wallets run in NEAR Connect's sandbox. Offered on testnet: ${TESTNET_WALLETS}.`],
];

function ConnectPrompt({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
  return (
    <Panel title="Connect the owner's wallet" icon={Wallet} id="connect-title" bodyClassName="p-0">
      <ol className="divide-y divide-line" data-testid="connect-prompt">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="flex gap-3 px-3.5 py-3">
            <span className="grid size-5 shrink-0 place-items-center rounded border border-line font-mono text-[11px] text-fg-faint">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-[13px] text-fg">{t}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="border-t border-line p-3.5">
        <Button variant="invert" size="sm" onClick={onConnect} disabled={connecting}>
          <Wallet aria-hidden />{connecting ? "Waiting for wallet…" : "Connect wallet"}
        </Button>
      </div>
    </Panel>
  );
}
