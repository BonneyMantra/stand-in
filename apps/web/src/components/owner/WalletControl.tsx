import { LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/app/common";
import type { WalletInfo } from "./useNearWallet";

export function WalletIcon({ src, name }: { src: string | null; name: string | null }) {
  if (!src) return <span className="grid size-5 place-items-center rounded border border-line bg-ink-850"><Wallet className="size-3 text-fg-faint" aria-hidden /></span>;
  return <img src={src} alt="" title={name ?? undefined} className="size-5 shrink-0 rounded" />;
}

/** Header control: connect, the connected account and wallet, disconnect. */
export function WalletControl({ info, onConnect, onDisconnect }: { info: WalletInfo; onConnect: () => void; onDisconnect: () => void }) {
  if (info.status === "restoring") return <Shimmer className="h-8 w-44" />;
  if (info.status !== "connected") {
    return (
      <Button variant="invert" size="sm" onClick={onConnect} disabled={info.status === "connecting"} aria-busy={info.status === "connecting"}>
        <Wallet aria-hidden />{info.status === "connecting" ? "Waiting for wallet…" : "Connect wallet"}
      </Button>
    );
  }
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-line bg-ink-900 py-1 pr-1 pl-2">
      <WalletIcon src={info.walletIcon} name={info.walletName} />
      <div className="min-w-0 leading-tight">
        <p className="truncate font-mono text-xs text-fg" data-testid="connected-account">{info.accountId}</p>
        <p className="truncate text-[10.5px] text-fg-faint">{info.walletName} · testnet</p>
      </div>
      <Button variant="quiet" size="xs" onClick={onDisconnect} aria-label="Disconnect wallet" className="ml-1">
        <LogOut aria-hidden /><span className="hidden sm:inline">Disconnect</span>
      </Button>
    </div>
  );
}
