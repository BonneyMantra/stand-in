import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { ArrowRight, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { ExtLink, PageHeader, Panel } from "@/components/app/common";
import { WalletControl } from "@/components/owner/WalletControl";
import { GuardianPanel } from "@/components/owner/GuardianPanel";
import { OwnerActions } from "@/components/owner/OwnerActions";
import { ActivityLog } from "@/components/owner/ActivityLog";
import { ApprovePanel } from "@/components/owner/ApprovePanel";
import { AdoptPanel } from "@/components/owner/AdoptPanel";
import { ProtectPanel } from "@/components/owner/ProtectPanel";
import { FactoryPanel } from "@/components/owner/FactoryPanel";
import { WithdrawPanel } from "@/components/owner/WithdrawPanel";
import { ChainSigTry, IntentsPanel } from "@/components/owner/GuardianTools";
import { useOwnerTx } from "@/components/owner/useOwnerTx";
import { useWallet } from "@/components/owner/WalletProvider";
import { useGuardian } from "@/components/owner/useGuardian";
import { useConsoleActions } from "@/components/owner/useConsoleActions";
import { useMyAccount } from "@/data/useMyAccount";
import { isFactoryGuardian } from "@/lib/wallet/factory";
import { parseDeepLink } from "@/lib/wallet/deeplink";
import { supportsBatch } from "@/lib/wallet/connector";
import { explorerTx, isEthAccount, looksMainnet } from "@/lib/wallet/near";

// NEAR Connect's manifest, filtered to testnet + signAndSendTransaction. WalletConnect and Unity also qualify but NEAR Connect
// drops wallets that need WalletConnect unless a WalletConnect projectId is configured; this site has none.
const TESTNET_WALLETS = "Meteor, Intear, Nightly, Ledger, NEAR CLI and Ethereum Wallets (MetaMask). WalletConnect and Unity need a WalletConnect project id this site does not have, so they are not listed";

export default function OwnerPage() {
  const { search } = useLocation();
  const [params] = useSearchParams();
  const link = useMemo(() => parseDeepLink(search), [search]);
  const w = useWallet();
  const mine = useMyAccount();
  const wrongNet = w.status === "connected" && !!w.accountId && looksMainnet(w.accountId);
  // The guardian account: the link's `account` when a link is open, else the picked factory guardian (?guardian= or the
  // list), else the connected account (a self-hosted guardian).
  const [picked, setPicked] = useState<string | null>(() => params.get("guardian"));
  const target = link.kind === "ok" || link.kind === "adopt" ? link.req.account : picked ?? w.accountId;
  const eth = !!w.accountId && isEthAccount(w.accountId);
  const { read, refresh } = useGuardian(w.status === "connected" && !wrongNet ? target : null);
  const tx = useOwnerTx(w.wallet, w.accountId, refresh);
  const a = useConsoleActions(w, tx, target, mine.refreshSoon);
  // Everything this page remembers belongs to the connected account: a switch (or disconnect) starts clean, so another
  // account's selected guardian, deploy notice or transactions never show under the new one.
  const seenAccount = useRef(w.accountId);
  const { reset } = tx;
  const { forget } = a;
  useEffect(() => {
    if (seenAccount.current === w.accountId) return;
    seenAccount.current = w.accountId;
    setPicked(null); forget(); reset();
  }, [w.accountId, reset, forget]);

  const lookup = read.status === "ready" ? read.lookup : read.status === "loading" ? read.previous : undefined;
  const guardian = lookup?.kind === "guardian" ? lookup.state : null;
  const isOwner = !!guardian && guardian.owner === w.accountId;
  const switchAccount = async () => { await w.disconnect(); await w.connect(); };
  const busy = tx.busy;

  const factory = w.accountId && (
    <FactoryPanel ownerId={w.accountId} eth={eth} busy={busy} selected={picked} reloadKey={a.factoryKey + a.homeKey}
      onCreate={(n, d, h) => void a.create(n, d, h, setPicked)} onSelect={setPicked} />
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Owner console"
        sub={<>Your own NEAR wallet protects the account and signs every owner call. Testnet. Your guardians, keys and decoys are on{" "}
          <Link to="/app" className="text-fg-muted underline underline-offset-4">My account</Link>.</>}
        actions={<WalletControl info={w} onConnect={() => void w.connect()} onDisconnect={() => void w.disconnect()} />}
      />

      {w.error && (
        <Alert variant="destructive" data-testid="wallet-error">
          <AlertTitle>Wallet</AlertTitle>
          <AlertDescription><p>{w.error}</p></AlertDescription>
        </Alert>
      )}

      {a.storageRefused && (
        <Alert variant="warning" data-testid="storage-refused">
          <AlertTitle>This browser refused to store the keys</AlertTitle>
          <AlertDescription><p>Its storage is blocked (a private window, or site data turned off), so the bait and watcher were left out of the request: an account whose key is lost cannot be used. Allow site data and try again, or create them with <code className="font-mono">standin adopt --wallet</code>.</p></AlertDescription>
        </Alert>
      )}

      {(link.kind === "adopt" || (link.kind === "invalid" && link.op === "adopt")) && (
        <AdoptPanel
          link={link} accountId={w.status === "connected" ? w.accountId : null} guardian={lookup}
          busy={busy} result={a.approved} batch={supportsBatch(w.wallet.current)} homeKey={a.homeKey}
          onAdopt={(s) => void a.adopt(s)} onSwitch={() => void switchAccount()}
        />
      )}

      {a.deployed && (
        <Alert variant="success" data-testid="deployed">
          <AlertTitle>{isFactoryGuardian(a.deployed.guardian) ? "Guarded agent account created" : "Guardian deployed"}{a.deployed.home ? ", with your bait and watcher" : ""}</AlertTitle>
          <AlertDescription>
            <p>
              <span className="font-mono break-all">{a.deployed.guardian}</span> is protected; the console below is read back from chain.
              Transaction <ExtLink href={explorerTx(a.deployed.hash)}>{a.deployed.hash.slice(0, 12)}…</ExtLink>
            </p>
            <Link to="/app" className="mt-2 inline-flex items-center gap-1.5 font-medium text-fg underline-offset-4 hover:underline" data-testid="to-my-account">
              See it on My account<ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {(link.kind === "ok" || (link.kind === "invalid" && link.op !== "adopt")) && (
        <ApprovePanel
          link={link} accountId={w.status === "connected" ? w.accountId : null} guardian={lookup}
          busy={busy} result={a.approved} onApprove={(r, u) => void a.approve(r, u)}
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
                <div className="order-1 min-w-0"><ProtectPanel accountId={w.accountId} lookup={lookup} busy={busy} reloadKey={a.homeKey} onDeploy={(c, i, h) => void a.protect(c, i, h)} /></div>
              )}
              {eth && link.kind === "none" && <div className="order-2 min-w-0">{factory}</div>}
              <div className="order-3 min-w-0"><GuardianPanel accountId={target ?? w.accountId} read={read} onRefresh={() => void refresh()} /></div>
              {!eth && link.kind === "none" && <div className="order-8 min-w-0">{factory}</div>}
            </div>
            <div className="contents xl:block xl:space-y-4">
              {guardian && isOwner && <div className="order-4 min-w-0"><OwnerActions state={guardian} busy={busy} onFreeze={a.freeze} onUnfreeze={a.unfreeze} /></div>}
              {guardian && isOwner && target && (
                <div className="order-5 min-w-0 space-y-4">
                  <ChainSigTry ownerId={w.accountId} state={guardian} busy={busy} onSign={a.signEvm} />
                  <IntentsPanel guardianId={target} state={guardian} busy={busy} onAdd={a.addIntentsKey} />
                </div>
              )}
              {guardian && isOwner && target && isFactoryGuardian(target) && (
                <div className="order-6 min-w-0"><WithdrawPanel guardianId={target} ownerId={w.accountId} busy={busy} reloadKey={a.factoryKey} onWithdraw={a.withdraw} /></div>
              )}
              {guardian && !isOwner && (
                <Alert variant="warning" data-testid="not-owner" className="order-4">
                  <AlertTitle>Not this guardian's owner</AlertTitle>
                  <AlertDescription>
                    <p>Its owner is <span className="font-mono break-all">{guardian.owner}</span>; connected as <span className="font-mono break-all">{w.accountId}</span>. Owner actions need the owner's wallet.</p>
                  </AlertDescription>
                </Alert>
              )}
              <div className="order-7 min-w-0"><ActivityLog entries={tx.log} /></div>
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
  ["The guardian lives on your account", "Connect, then Protect this account: one approval deploys it on the account itself and creates your bait and watcher. Meteor refuses contract deployment and a MetaMask (0x) account already runs NEAR's wallet contract: with either, create a guarded agent account instead (one function call)."],
  ["Its owner is the account", "Unfreeze and adding agent keys need a transaction signed by the account's own full-access key, the one your wallet holds."],
  ["Your wallet signs; your owner key never reaches this page", `Wallets run in NEAR Connect's sandbox. Offered on testnet: ${TESTNET_WALLETS}. Only the low-value bait and watcher keys are made and kept in this browser.`],
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
      <div className="flex flex-wrap items-center gap-3 border-t border-line p-3.5">
        <Button variant="invert" size="sm" onClick={onConnect} disabled={connecting}>
          <Wallet aria-hidden />{connecting ? "Waiting for wallet…" : "Connect wallet"}
        </Button>
        <Link to="/app/example" className="text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline">No wallet? See an example</Link>
      </div>
    </Panel>
  );
}
