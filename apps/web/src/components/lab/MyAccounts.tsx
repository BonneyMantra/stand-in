import { Frame, FramePanel, PanelBar } from "@/components/landing/frame";
import { explorerAccount } from "@/lib/wallet/near";
import type { HomeRecord } from "@/lib/wallet/homeStore";
import type { Preflight } from "@/lib/tabwatcher/preflight";
import { spendableOf } from "@/lib/tabwatcher/preflight";

function Row({ k, id, extra }: { k: string; id: string; extra?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-fg-faint">{k}</dt>
      <dd className="flex min-w-0 items-baseline gap-2">
        <a href={explorerAccount(id)} target="_blank" rel="noreferrer" title={id} className="min-w-0 truncate text-fg-muted underline-offset-4 hover:text-fg hover:underline">{id}</a>
        {extra ? <span className="shrink-0 text-fg-faint tabular-nums">{extra}</span> : null}
      </dd>
    </div>
  );
}

/** The accounts a run on the owner's own guardian touches, each linked to the explorer, with what the bait and watcher can spend. */
export function MyAccounts({ owner, home, pre, thief }: { owner: string | null; home: HomeRecord | null; pre: Preflight | null; thief: string | null }) {
  return (
    <Frame>
      <FramePanel className="bg-ink-950">
        <PanelBar>your accounts</PanelBar>
        {owner ? (
          <dl className="space-y-1 p-4 font-mono text-[11.5px]">
            <Row k="owner" id={owner} />
            {pre ? <Row k="guardian" id={pre.guardian} extra={pre.state ? (pre.state.frozen ? "frozen" : "active") : undefined} /> : null}
            {home ? <Row k="bait" id={home.bait.account_id} extra={pre ? `${spendableOf(pre.bait)} N` : undefined} /> : null}
            {home ? <Row k="watcher" id={home.watcher.account_id} extra={pre ? `${spendableOf(pre.watcher)} N` : undefined} /> : null}
            {thief ? <Row k="thief" id={thief} /> : null}
          </dl>
        ) : (
          <p className="p-4 text-[12.5px] leading-relaxed text-fg-muted">Connect a wallet to see the accounts a run uses. Every one of them is yours; the thief is a throwaway account this tab creates.</p>
        )}
        {owner ? <p className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-fg-faint">N = NEAR the account can spend (its storage stays locked). The thief is a throwaway implicit account made in this tab for each run.</p> : null}
      </FramePanel>
    </Frame>
  );
}
