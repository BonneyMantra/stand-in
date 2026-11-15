import type { ReactNode } from "react";
import { KeyRound, MonitorSmartphone, Plus, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyText, ExtLink, Panel, Tag } from "@/components/app/common";
import { shortKey } from "@/data/derive";
import type { AccountSnapshot, HomeAccountView } from "@/data/account";
import type { HomeAcctStatus, HomeSummary } from "@/data/accountDerive";
import { explorerAccount } from "@/lib/wallet/near";
import { nearShort } from "@/lib/wallet/guardianCode";
import { quoteAdopt } from "@/lib/wallet/funding";
import type { HomeRecord } from "@/lib/wallet/homeStore";
import type { HomePlan } from "@/lib/wallet/homePlan";
import { Row } from "./ApprovePanel";
import { QuoteBlock } from "./QuoteBlock";
import { HomeTransfer } from "./HomeTransfer";
import type { ToolNote } from "./useHomeTools";

const TAG: Record<HomeAcctStatus, ReactNode> = {
  missing: <Tag tone="muted">not created</Tag>,
  pending: <Tag tone="warn">not on chain yet · key kept here</Tag>,
  held: <Tag tone="safe">key in this browser</Tag>,
  foreign: <Tag tone="warn">key not in this browser</Tag>,
};

/**
 * The owner's bait and watcher as this browser holds them: on chain or not, which key is here and what it may do, which
 * guardians it can freeze. Creates what is missing (one approval), adds decoys, exports to and imports from a CLI home.
 */
export function HomePanel({ snapshot, summary, home, plan, eth, busy, working, note, slot, onCreate, onAddDecoy, onExport, onImport }: {
  snapshot: AccountSnapshot; summary: HomeSummary; home: HomeRecord | null; plan: HomePlan | null; eth: boolean; busy: boolean;
  working: "decoy" | "import" | null; note: ToolNote; slot?: ReactNode;
  onCreate: () => void; onAddDecoy: () => void; onExport: () => void; onImport: (files: FileList, replace: boolean) => Promise<boolean>;
}) {
  if (eth) {
    return (
      <Panel title="Your bait and watcher" icon={KeyRound} id="home-title">
        <p className="p-3.5 text-xs leading-relaxed text-fg-muted" data-testid="home-eth">
          An Ethereum Wallets (0x) account cannot create sub-accounts, so it has no bait or watcher of its own. Its guarded agent account keeps the
          project's watcher; freeze, unfreeze and withdraw from the owner console with this wallet.
        </p>
      </Panel>
    );
  }
  const held = summary.bait === "held" && summary.watcher === "held";
  const none = summary.bait === "missing" && summary.watcher === "missing";
  const foreign = summary.bait === "foreign" || summary.watcher === "foreign";
  const toCreate = plan?.kind === "plan" && !plan.blocked && (plan.create.bait || plan.create.watcher) ? plan : null;
  const guardians = snapshot.guardians.filter((g) => g.state.watcher === snapshot.watcher.id);
  const quote = toCreate && snapshot.ownerAccount
    ? quoteAdopt({ storageBytes: snapshot.ownerAccount.storageUsage, deployGuardian: false, createBait: toCreate.create.bait, createWatcher: toCreate.create.watcher, watcherFreezeOnly: toCreate.home.watcher.scope.kind === "function-call" })
    : null;
  const short = quote && snapshot.ownerAccount ? snapshot.ownerAccount.amount < quote.total : true;
  return (
    <Panel title="Your bait and watcher" icon={KeyRound} id="home-title" meta={held ? "keys in this browser" : foreign ? "keys elsewhere" : "not set up"} bodyClassName="p-0">
      <dl className="divide-y divide-line px-3.5 py-1" data-testid="home-panel">
        <AccountRow k="bait" view={snapshot.bait} status={summary.bait}>
          Every key on it but its own is a decoy; a decoy that signs trips the watcher.
          {summary.bait === "held" && home ? <> Its full-access key is here: <CopyText value={home.bait.public_key} display={shortKey(home.bait.public_key, 8, 6)} /></> : null}
        </AccountRow>
        <AccountRow k="watcher" view={snapshot.watcher} status={summary.watcher}>
          Signs <code className="font-mono">freeze</code> on your guardians when a decoy is used.{" "}
          {summary.watcherKey ? (summary.watcherKey.kind === "full"
            ? <>The key here is a full-access key (imported from a CLI home).</>
            : <>The key here is a function-call key: <span className="font-mono text-fg">{(summary.watcherKey.method_names ?? []).join(", ") || "any method"}</span> on <span className="font-mono text-fg">{summary.watcherKey.receiver_id}</span>, nothing else.</>)
            : null}
        </AccountRow>
        {guardians.length > 0 && (
          <Row k="can freeze">
            <div className="space-y-1 font-sans [overflow-wrap:anywhere]" data-testid="home-coverage">
              {summary.covered.map((g) => <p key={g} className="flex items-center gap-1.5 text-fg"><Snowflake className="size-3 text-safe" aria-hidden /><span className="font-mono">{g}</span></p>)}
              {summary.uncovered.map((g) => <p key={g} className="text-[11px] text-warn"><span className="font-mono">{g}</span>: watched by {snapshot.watcher.id}, but no key in this browser can sign its freeze{held ? " (the watcher key here is scoped to another guardian)" : ""}. Your wallet can always freeze it in the owner console.</p>)}
            </div>
          </Row>
        )}
      </dl>
      {none && !toCreate && (
        <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-muted" data-testid="home-none">
          Not created yet. Protect your account (or create a guarded agent account) in the owner console: the same approval creates both, with keys generated in this browser.
        </p>
      )}
      {foreign && (
        <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-warn" data-testid="home-foreign">
          {summary.bait === "foreign" && summary.watcher === "foreign" ? "Both accounts exist" : `${summary.bait === "foreign" ? snapshot.bait.id : snapshot.watcher.id} exists`}, but this browser holds no key for {summary.bait === "foreign" && summary.watcher === "foreign" ? "them" : "it"}: they were
          created in another browser or by <code className="font-mono">standin adopt</code>. Keys never travel on their own: export them there (My account → Export to CLI home, or the CLI home folder itself) and import them below, or keep running <code className="font-mono">standin dev up --home DIR</code> where they are.
        </p>
      )}
      {(held || summary.bait === "held") && (
        <div className="flex items-start gap-2 border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-muted" data-testid="home-browser-note">
          <MonitorSmartphone className="mt-0.5 size-3.5 shrink-0 text-fg-faint" aria-hidden />
          <p>These keys are kept in this browser only, never sent anywhere. They are low-value test keys (the bait's NEAR is there to be stolen; the watcher key can only freeze): never use them for real funds. Clearing this site's data deletes them, so export a copy.</p>
        </div>
      )}
      {toCreate && quote && snapshot.ownerAccount && (
        <div className="space-y-2.5 border-t border-line p-3.5" data-testid="home-create">
          <p className="text-xs text-fg">
            {toCreate.create.bait && toCreate.create.watcher ? "Create both accounts" : `Create ${toCreate.create.bait ? snapshot.bait.id : snapshot.watcher.id}`} in one approval, with keys generated in this browser
            {toCreate.home.watcher.scope.kind === "function-call" ? <> (the watcher's may only call freeze on <span className="font-mono">{toCreate.home.watcher.scope.receiver_id}</span>)</> : null}.
          </p>
          <QuoteBlock quote={quote} signerId={snapshot.owner} balance={snapshot.ownerAccount.amount} testid="home-create-quote" />
          <Button size="sm" variant="invert" disabled={busy || short} onClick={onCreate} data-testid="home-create-sign">
            <KeyRound aria-hidden />{busy ? "Waiting for wallet…" : "Review and sign in wallet"}
          </Button>
        </div>
      )}
      {summary.bait === "held" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3.5">
          <Button size="sm" variant="line" disabled={working === "decoy"} onClick={onAddDecoy} data-testid="home-add-decoy">
            <Plus aria-hidden />{working === "decoy" ? "Adding…" : "Add a decoy key"}
          </Button>
          <p className="min-w-0 flex-1 text-[11px] text-fg-muted">Signed here by the bait's own key (no wallet): one AddKey on {snapshot.bait.id}, paid from the bait's balance.</p>
        </div>
      )}
      {slot}
      {held || foreign ? (
        <div className="border-t border-line p-3.5">
          <HomeTransfer owner={snapshot.owner} canExport={!!home && held} working={working === "import"} note={note} onExport={onExport} onImport={onImport} />
        </div>
      ) : (
        <details className="group border-t border-line" data-testid="home-import-details">
          <summary className="cursor-pointer list-none px-3.5 py-2.5 text-[11px] text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>Already set up with the CLI? Bring that home into this browser
          </summary>
          <div className="px-3.5 pb-3.5">
            <HomeTransfer owner={snapshot.owner} canExport={false} working={working === "import"} note={note} onExport={onExport} onImport={onImport} />
          </div>
        </details>
      )}
      {!held && !foreign && note && <p role="status" className="border-t border-line px-3.5 py-2.5 text-[11px] text-fg-muted">{note.text}</p>}
    </Panel>
  );
}

function AccountRow({ k, view, status, children }: { k: string; view: HomeAccountView; status: HomeAcctStatus; children: ReactNode }) {
  return (
    <Row k={k}>
      <span className="inline-flex flex-wrap items-center gap-2">
        <ExtLink href={explorerAccount(view.id)}>{view.id}</ExtLink>{TAG[status]}
        {view.amount !== null && <span className="font-mono text-[11px] text-fg-faint">{nearShort(view.amount, 3)} NEAR</span>}
      </span>
      <p className="mt-1 font-sans text-[11px] leading-relaxed text-fg-muted [word-break:normal] [overflow-wrap:anywhere]">{children}</p>
    </Row>
  );
}
