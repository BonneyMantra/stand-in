import type { ReactNode } from "react";
import { CircleAlert, MonitorSmartphone } from "lucide-react";
import { ExtLink, Shimmer, Tag } from "@/components/app/common";
import { explorerAccount } from "@/lib/wallet/near";
import { nearShort } from "@/lib/wallet/guardianCode";
import { BAIT_FUND, WATCHER_FUND } from "@/lib/wallet/funding";
import { homeIds } from "@/lib/wallet/homeStore";
import type { RoleStatus } from "@/lib/wallet/homePlan";
import type { HomePlanRead } from "./useHomePlan";
import { Row } from "./ApprovePanel";

const TAG: Record<RoleStatus, ReactNode> = {
  missing: <Tag tone="muted">created now</Tag>,
  pending: <Tag tone="muted">created now · key kept here</Tag>,
  held: <Tag tone="safe">exists · key in this browser</Tag>,
  foreign: <Tag tone="warn">exists · key not in this browser</Tag>,
};

/**
 * The home part of a Protect or Create request, before signing: which of the owner's two accounts it creates, what each
 * gets, which key, and where that key lives (this browser). `guardian` is what the watcher key may freeze.
 */
export function HomeCreateRows({ owner, guardian, read }: { owner: string; guardian: string; read: HomePlanRead }) {
  const ids = homeIds(owner);
  if (read.status === "idle") return null;
  if (read.status === "loading") return <div className="space-y-2 px-3.5 py-3" aria-busy="true"><Shimmer className="h-4" /><Shimmer className="h-4 w-2/3" /></div>;
  if (read.status === "error") return <p className="flex items-start gap-2 px-3.5 py-2.5 text-xs text-trip" data-testid="home-plan-error"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />Could not read your bait and watcher accounts: {read.error}</p>;
  const plan = read.plan;
  if (plan.kind === "eth") return <p className="px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-muted" data-testid="home-plan-eth">{plan.reason}</p>;
  const s = plan.home.watcher.scope;
  const scope = s.kind === "full-access" ? "a full-access key (imported from a CLI home)" : <>a function-call key that may only call <code className="font-mono text-fg">freeze</code> on <span className="font-mono text-fg">{guardian}</span></>;
  return (
    <div data-testid="home-plan">
      <dl className="divide-y divide-line px-3.5 py-1">
        <Row k="bait">
          <span className="inline-flex flex-wrap items-center gap-2"><ExtLink href={explorerAccount(ids.bait)}>{ids.bait}</ExtLink>{TAG[plan.bait]}</span>
          <p className="mt-1 font-sans text-[11px] leading-relaxed text-fg-muted [word-break:normal] [overflow-wrap:anywhere]">
            Every decoy is a key on it, so a stolen decoy signs from here and trips the watcher.
            {plan.create.bait ? <> Gets {nearShort(BAIT_FUND)} NEAR and a full-access key generated in this browser, so it can add decoy keys to itself.</> : null}
          </p>
        </Row>
        <Row k="watcher">
          <span className="inline-flex flex-wrap items-center gap-2"><ExtLink href={explorerAccount(ids.watcher)}>{ids.watcher}</ExtLink>{TAG[plan.watcher]}</span>
          <p className="mt-1 font-sans text-[11px] leading-relaxed text-fg-muted [word-break:normal] [overflow-wrap:anywhere]">
            The guardian's watcher: it freezes when a decoy signs; it can never unfreeze, add keys or move your funds.
            {plan.create.watcher ? <> Gets {nearShort(WATCHER_FUND)} NEAR and {scope}, generated in this browser.</> : null}
          </p>
        </Row>
      </dl>
      {plan.blocked ? (
        <p className="flex items-start gap-2 border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-warn" data-testid="home-plan-blocked">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{plan.bait === "foreign" && plan.watcher === "foreign" ? "Both accounts" : plan.bait === "foreign" ? ids.bait : ids.watcher} already exist{plan.bait === "foreign" && plan.watcher === "foreign" ? "" : "s"} with a key this browser does not hold (another browser, or <code className="font-mono">standin adopt</code>). Nothing is created for them: import that home on My account, or keep running it from the CLI.</span>
        </p>
      ) : !plan.covers && !plan.create.watcher ? (
        <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-warn" data-testid="home-plan-uncovered">
          This browser's watcher key may only freeze {s.kind === "function-call" ? <span className="font-mono">{s.receiver_id}</span> : "its first guardian"}. The new guardian is still watched by {ids.watcher}, but a freeze for it needs a full-access watcher key (a CLI home from <code className="font-mono">standin adopt</code>); your wallet can always freeze it here.
        </p>
      ) : null}
      {(plan.create.bait || plan.create.watcher || plan.bait === "held") && (
        <div className="flex items-start gap-2 border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-muted" data-testid="home-plan-browser-note">
          <MonitorSmartphone className="mt-0.5 size-3.5 shrink-0 text-fg-faint" aria-hidden />
          <p>
            These keys are kept in this browser only (its local storage for this site), never sent anywhere. They are low-value test keys: the
            bait's 0.2 NEAR is there to be stolen, and the watcher key can only freeze. Never use them for real funds. Export them to a CLI home
            from My account to run the always-on watcher; clearing this site's data deletes them.
          </p>
        </div>
      )}
    </div>
  );
}
