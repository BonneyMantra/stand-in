import { PageHeader } from "@/components/app/common";
import { DecoysPanel } from "@/components/account/DecoysPanel";
import { useAccountTools } from "@/components/account/useAccountTools";
import { useMyAccount } from "@/data/useMyAccount";
import { OwnGate } from "./OwnGate";

/** The keys on the owner's bait (view_access_key_list), with what each has signed. */
export default function MyDecoysPage() {
  const m = useMyAccount();
  const t = useAccountTools();
  const s = m.snapshot;
  return (
    <div className="space-y-4">
      <PageHeader title="Decoys" sub={s ? <>Every key on <span className="font-mono text-fg">{s.bait.id}</span> but its own is a decoy. A decoy whose nonce moved has signed a transaction.</> : "The decoy keys on your own bait account."} />
      <OwnGate>
        {s && (
          <>
            <DecoysPanel bait={s.bait.id} exists={s.bait.exists} decoys={t.decoys} home={m.home} canAdd={m.summary?.bait === "held"} adding={t.tools.working === "decoy"} onAdd={() => void t.tools.addDecoy()} thefts={t.thefts} />
            {t.tools.note && <p role="status" className={t.tools.note.tone === "error" ? "text-xs text-trip" : "text-xs text-safe"}>{t.tools.note.text}</p>}
          </>
        )}
      </OwnGate>
    </div>
  );
}
