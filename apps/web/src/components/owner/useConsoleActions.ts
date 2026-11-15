import { useState } from "react";
import { FACTORY, guardiansOf, sendCreateGuardian } from "@/lib/wallet/factory";
import { DEFAULT_INTENTS, type GuardianCode } from "@/lib/wallet/guardianCode";
import { createAccountTx, readHomeAccount, watcherFor } from "@/lib/wallet/homeAccounts";
import { commitHomePlan, type HomePlan } from "@/lib/wallet/homePlan";
import { recordHomeTx, updateHome } from "@/lib/wallet/homeStore";
import { deployTx, ownerTx, sendOwnerTx, sendTransactions, sendUnfreeze, type OwnerCall, type TxOutcome, type WalletTx } from "@/lib/wallet/connector";
import { accountExists, readGuardian, viewAccessKey } from "@/lib/wallet/near";
import type { ApproveRequest } from "@/lib/wallet/deeplink";
import type { NearWallet } from "./useNearWallet";
import type { useOwnerTx } from "./useOwnerTx";
import type { AdoptSend } from "./AdoptPanel";
import type { ApproveResult } from "./ApprovePanel";
import type { ProtectInit } from "./ProtectPanel";

type Tx = ReturnType<typeof useOwnerTx>;

const addKeyCall = (r: { agent_key: string; receiver: string; methods: string[]; allowance: bigint }): OwnerCall =>
  ({ method: "add_agent_key", args: { public_key: r.agent_key, receiver_id: r.receiver, method_names: r.methods, allowance: r.allowance.toString() } });

/** Home accounts in a request land when the account exists with this browser's key. */
const homeLanded = (accountId: string, publicKey: string) => async () => (await accountExists(accountId, "optimistic")) && (await viewAccessKey(accountId, publicKey)) !== null;

/**
 * The owner console's wallet requests. Protect and Create carry the browser-held home (bait + watcher) in the same
 * approval: its keys are saved here before the wallet opens, and nothing is created if storage refused them.
 */
export function useConsoleActions(w: NearWallet, tx: Tx, target: string | null, onHomeChanged: () => void) {
  const [approved, setApproved] = useState<ApproveResult | null>(null);
  const [deployed, setDeployed] = useState<{ hash: string; guardian: string; home: boolean } | null>(null);
  const [homeKey, setHomeKey] = useState(0);
  const [factoryKey, setFactoryKey] = useState(0);
  const [storageRefused, setStorageRefused] = useState(false);
  const bumpHome = () => { setHomeKey((k) => k + 1); window.setTimeout(() => setHomeKey((k) => k + 1), 4000); onHomeChanged(); };

  const owner = (label: string, calls: OwnerCall[], landed?: () => Promise<boolean>, tgas?: bigint) =>
    tx.run(label, (wallet, id) => sendOwnerTx(wallet, id, target ?? id, calls, tgas), landed);
  const frozenIs = (want: boolean) => async () => {
    const g = target ? await readGuardian(target) : null;
    return g?.kind === "guardian" && g.state.frozen === want;
  };
  const keyIsOn = (account: string, key: string) => async () => (await viewAccessKey(account, key)) !== null;

  /** Builds the home part of a request; null when the keys could not be stored (then the request goes without it). */
  const homePart = (plan: HomePlan | null) => {
    if (!plan) return { txs: [] as WalletTx[], labels: [] as string[], landed: [] as (() => Promise<boolean>)[] };
    const parts = commitHomePlan(plan);
    if (parts === null) { setStorageRefused(true); return { txs: [], labels: [], landed: [] }; }
    setStorageRefused(false);
    const keyOf = (role: "bait" | "watcher") => (plan.kind === "plan" ? (role === "bait" ? plan.home.bait.public_key : plan.home.watcher.public_key) : "");
    return {
      txs: parts.map((p) => p.tx as WalletTx),
      labels: parts.map((p) => `create ${p.accountId} (${p.role})`),
      landed: parts.map((p) => homeLanded(p.accountId, keyOf(p.role))),
    };
  };

  /** Keeps the explorer links of what landed with the home, and adds a guardian a full-access watcher can freeze. */
  const remember = (ownerId: string, labels: string[], outs: ({ hash: string } | null)[], guardian: string) => {
    const at = Date.now();
    outs.forEach((o, i) => { if (o?.hash) recordHomeTx(ownerId, { hash: o.hash, label: labels[i] ?? "transaction", at }); });
    updateHome(ownerId, (h) => (h.watcher.scope.kind === "full-access" && !h.guardians.includes(guardian) ? { ...h, guardians: [...h.guardians, guardian] } : h));
  };

  const protect = async (code: GuardianCode, init: ProtectInit, plan: HomePlan | null) => {
    if (!w.accountId) return;
    const id = w.accountId;
    const home = homePart(plan);
    const labels = ["deploy guardian + new", ...home.labels];
    const isGuardian = async () => (await readGuardian(id)).kind === "guardian";
    const outs = await tx.runBatch(labels, (wallet, signer) => sendTransactions(wallet, signer, [deployTx(signer, code.bytes, init), ...home.txs]), [isGuardian, ...home.landed]);
    remember(id, labels, outs, id);
    if (outs[0]) setDeployed({ hash: outs[0].hash, guardian: id, home: home.txs.length > 0 });
    bumpHome();
  };

  const create = async (name: string, deposit: bigint, plan: HomePlan | null, onCreated: (id: string) => void) => {
    if (!w.accountId) return;
    const ownerId = w.accountId;
    const expected = `${name}.${FACTORY}`;
    const home = homePart(plan);
    const listed = async () => (await guardiansOf(ownerId)).includes(expected);
    const labels = [`create_guardian ${name}`, ...home.labels];
    const createTx: WalletTx = {
      receiverId: FACTORY,
      actions: [{ type: "FunctionCall", params: { methodName: "create_guardian", args: { name, watcher: watcherFor(ownerId), intents_contract: DEFAULT_INTENTS }, gas: (100n * 10n ** 12n).toString(), deposit: deposit.toString() } }],
    };
    let outs: Awaited<ReturnType<Tx["runBatch"]>>;
    if (home.txs.length === 0) {
      // One transaction: the factory's own helper, which reads the created id from the result.
      const out = await tx.run(labels[0]!, async (wallet, signer) => {
        const r = await sendCreateGuardian(wallet, signer, name, watcherFor(signer), DEFAULT_INTENTS, deposit);
        return r.failure || r.guardianId ? r : { ...r, failure: "The factory returned null: the name is taken or creation failed. The deposit was refunded." };
      }, listed);
      outs = [out];
    } else {
      outs = await tx.runBatch(labels, (wallet, signer) => sendTransactions(wallet, signer, [createTx, ...home.txs]), [listed, ...home.landed]);
    }
    setFactoryKey((k) => k + 1);
    remember(ownerId, labels, outs, expected);
    if (outs[0] && (await listed().catch(() => false))) {
      onCreated(expected);
      setDeployed({ hash: outs[0].hash, guardian: expected, home: home.txs.length > 0 });
    }
    bumpHome();
  };

  /** The home alone (a guardian already exists): one approval for whatever is still missing. */
  const createHome = async (plan: HomePlan) => {
    if (!w.accountId || plan.kind !== "plan") return;
    const home = homePart(plan);
    if (!home.txs.length) return;
    const outs = await tx.runBatch(home.labels, (wallet, signer) => sendTransactions(wallet, signer, home.txs), home.landed);
    remember(w.accountId, home.labels, outs, plan.home.guardians[0] ?? w.accountId);
    bumpHome();
  };

  // A standin adopt --wallet link: the guardian part (unless it already landed) and the CLI home's missing accounts.
  const adopt = async ({ req, code, guardianDone, creates }: AdoptSend) => {
    const txs: WalletTx[] = [], labels: string[] = [], landed: (() => Promise<boolean>)[] = [];
    if (!guardianDone) {
      txs.push(code ? deployTx(req.account, code.bytes, { watcher: req.watcher, intents_contract: req.intents }, [addKeyCall(req)]) : ownerTx(req.account, [addKeyCall(req)]));
      labels.push(code ? "deploy guardian + new + add_agent_key" : "add_agent_key");
      landed.push(keyIsOn(req.account, req.agent_key));
    }
    for (const a of creates) {
      txs.push(createAccountTx(a));
      labels.push(`create ${a.accountId}`);
      landed.push(async () => (await readHomeAccount(a)).status === "ready");
    }
    const outs = await tx.runBatch(labels, (wallet, id) => sendTransactions(wallet, id, txs), landed);
    bumpHome();
    if (!guardianDone && outs[0]) setApproved({ hash: outs[0].hash, key: await viewAccessKey(req.account, req.agent_key).catch(() => null) });
  };

  const approve = async (req: ApproveRequest, unfreezeFirst: boolean) => {
    const calls: OwnerCall[] = [...(unfreezeFirst ? [{ method: "unfreeze" as const, args: {} }] : []), addKeyCall(req)];
    const out = await owner(unfreezeFirst ? "unfreeze + add_agent_key" : "add_agent_key", calls, keyIsOn(req.account, req.agent_key));
    if (out) setApproved({ hash: out.hash, key: await viewAccessKey(req.account, req.agent_key).catch(() => null) });
  };

  const freeze = (reason: string) => void owner("freeze", [{ method: "freeze", args: { reason, decoy_public_key: null, tx_hash: null } }], frozenIs(true)).then(onHomeChanged);
  const unfreeze = () => void tx.run("unfreeze", (wallet, id) => sendUnfreeze(wallet, id, target ?? id), frozenIs(false)).then(onHomeChanged);
  const withdraw = (yocto: bigint) => void owner("withdraw", [{ method: "withdraw", args: { amount: yocto.toString() } }]).then(() => setFactoryKey((k) => k + 1));
  /** Runs one owner call and returns the wallet's outcome even when the contract refused (the panels read it back by hash). */
  const capture = async (label: string, calls: OwnerCall[], tgas?: bigint, landed?: () => Promise<boolean>) => {
    let got: TxOutcome | null = null;
    await tx.run(label, async (wallet, id) => (got = await sendOwnerTx(wallet, id, target ?? id, calls, tgas)), landed);
    onHomeChanged();
    return got as TxOutcome | null;
  };
  const addIntentsKey = (publicKey: string) => {
    const on = async () => { const g = target ? await readGuardian(target) : null; return g?.kind === "guardian" && g.state.intents_keys.includes(publicKey); };
    return capture("add_intents_key", [{ method: "add_intents_key", args: { public_key: publicKey } }], undefined, on);
  };
  // 150 TGas: the guardian forwards 100 TGas to the MPC signer's `sign` (packages/chainsig uses the same).
  const signEvm = (payloadHex: string, path: string) => capture("sign_evm (Chain Signatures)", [{ method: "sign_evm", args: { payload_hex: payloadHex, path } }], 150n);

  const forget = () => { setDeployed(null); setApproved(null); };
  return {
    approved, deployed, homeKey, factoryKey, storageRefused, setFactoryKey, forget,
    protect, create, createHome, adopt, approve, freeze, unfreeze, withdraw, addIntentsKey, signEvm,
  };
}
