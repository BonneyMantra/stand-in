import { PageHeader } from "@/components/app/common";
import { FreezesPanel } from "@/components/account/FreezesPanel";
import { ActivityPanel } from "@/components/account/ActivityPanel";
import { useAccountTools } from "@/components/account/useAccountTools";
import { useMyAccount } from "@/data/useMyAccount";
import { OwnGate } from "./OwnGate";

/** Every freeze on the owner's guardians (freeze_log, from chain) and every transaction on them. */
export default function MyTripsPage() {
  const m = useMyAccount();
  const t = useAccountTools();
  const s = m.snapshot;
  return (
    <div className="space-y-4">
      <PageHeader title="Trips and freezes" sub="Each guardian's freeze_log, read from testnet: who froze, why, the decoy and its theft, the keys deleted." />
      <OwnGate>
        {s && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <FreezesPanel freezes={t.freezes} activity={t.activityTxs} />
            <ActivityPanel read={t.activity.read} local={m.home?.txs ?? []} ctx={{ bait: s.bait.id, watcher: s.watcher.id }} onReload={() => void t.activity.reload()} limit={25} />
          </div>
        )}
      </OwnGate>
    </div>
  );
}
