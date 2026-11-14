import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/app/common";
import { WalletControl } from "@/components/owner/WalletControl";
import { GuardianPanel } from "@/components/owner/GuardianPanel";
import { OwnerActions } from "@/components/owner/OwnerActions";
import { ActivityLog, type TxEntry } from "@/components/owner/ActivityLog";
import { ApprovePanel, type ApproveResult } from "@/components/owner/ApprovePanel";
import { useNearWallet } from "@/components/owner/useNearWallet";
import { useGuardian } from "@/components/owner/useGuardian";
import { parseDeepLink, type ApproveRequest } from "@/lib/wallet/deeplink";
import { readableError, sendOwnerTx, type OwnerCall } from "@/lib/wallet/connector";
import { looksMainnet, viewAccessKey } from "@/lib/wallet/near";

const TESTNET_WALLETS = "Meteor, Intear, Nightly, Ledger, NEAR CLI and Ethereum wallets";

export default function OwnerPage() {
  const { search } = useLocation();
  const link = useMemo(() => parseDeepLink(search), [search]);
  const w = useNearWallet();
  const wrongNet = w.status === "connected" && !!w.accountId && looksMainnet(w.accountId);
  const { read, refresh } = useGuardian(w.status === "connected" && !wrongNet ? w.accountId : null);
  const [log, setLog] = useState<TxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState<ApproveResult | null>(null);
  const nextId = useRef(1);

  const lookup = read.status === "ready" ? read.lookup : read.status === "loading" ? read.previous : undefined;
  const guardian = lookup?.kind === "guardian" ? lookup.state : null;

  const run = useCallback(async (label: string, calls: OwnerCall[]) => {
    const wallet = w.wallet.current;
    if (!wallet || !w.accountId) return null;
    const id = nextId.current++;
    const patch = (p: Partial<TxEntry>) => setLog((l) => l.map((e) => (e.id === id ? { ...e, ...p } : e)));
    setLog((l) => [{ id, label, status: "pending", message: "Confirm in your wallet", at: Date.now() }, ...l]);
    setBusy(true);
    try {
      const out = await sendOwnerTx(wallet, w.accountId, calls);
      if (out.failure) patch({ status: "failed", hash: out.hash || undefined, message: readableError(out.failure) });
      else patch({ status: "ok", hash: out.hash, message: "Landed on testnet. State read again from chain." });
      return out.failure ? null : out;
    } catch (e) {
      patch({ status: "failed", message: readableError(e) });
      return null;
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [w.wallet, w.accountId, refresh]);

  const freeze = (reason: string) => void run("freeze", [{ method: "freeze", args: { reason, decoy_public_key: null, tx_hash: null } }]);
  const unfreeze = () => void run("unfreeze", [{ method: "unfreeze", args: {} }]);
  const approve = async (req: ApproveRequest, unfreezeFirst: boolean) => {
    const calls: OwnerCall[] = [
      ...(unfreezeFirst ? [{ method: "unfreeze" as const, args: {} }] : []),
      { method: "add_agent_key", args: { public_key: req.agent_key, receiver_id: req.receiver, method_names: req.methods, allowance: req.allowance.toString() } },
    ];
    const out = await run(unfreezeFirst ? "unfreeze + add_agent_key" : "add_agent_key", calls);
    if (out) setApproved({ hash: out.hash, key: await viewAccessKey(req.account, req.agent_key).catch(() => null) });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Owner console"
        sub="Sign the guardian's owner-only calls with your own NEAR wallet. Testnet."
        actions={<WalletControl info={w} onConnect={() => void w.connect()} onDisconnect={() => void w.disconnect()} />}
      />

      {w.error && (
        <Alert variant="destructive" data-testid="wallet-error">
          <AlertTitle>Wallet</AlertTitle>
          <AlertDescription>{w.error}</AlertDescription>
        </Alert>
      )}

      {link.kind !== "none" && (
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
              <span className="font-mono">{w.accountId}</span> is a mainnet account. This console signs on testnet only: switch the wallet
              to testnet, then disconnect and connect again.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <GuardianPanel accountId={w.accountId} read={read} onRefresh={() => void refresh()} />
            <div className="space-y-4">
              {guardian && <OwnerActions state={guardian} busy={busy} onFreeze={freeze} onUnfreeze={unfreeze} />}
              <ActivityLog entries={log} />
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
  ["The guardian lives on your account", "standin adopt deploys it on the guarded account itself, so it can delete that account's keys."],
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
