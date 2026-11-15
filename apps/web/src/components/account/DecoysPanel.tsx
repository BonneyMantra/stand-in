import { KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyText, EmptyState, ExtLink, Panel, Tag } from "@/components/app/common";
import { blockUrl, shortKey } from "@/data/derive";
import type { DecoyView } from "@/data/accountDerive";
import type { HomeRecord } from "@/lib/wallet/homeStore";
import { explorerAccount, explorerTx } from "@/lib/wallet/near";
import { freezeKey, type TheftLookup } from "@/data/useTheftTxs";
import { TheftLink } from "./FreezesPanel";

/**
 * The decoys on the owner's bait: every key on deployer.<owner> except the bait's own key, from view_access_key_list. A key
 * whose nonce moved has signed a transaction: on a decoy, that is a theft.
 */
export function DecoysPanel({ bait, exists, decoys, home, canAdd, adding, onAdd, limit, thefts = {} }: {
  bait: string; exists: boolean; decoys: DecoyView[]; home: HomeRecord | null; canAdd: boolean; adding: boolean; onAdd: () => void; limit?: number;
  thefts?: Record<string, TheftLookup>;
}) {
  const real = decoys.filter((d) => !d.admin);
  const admin = decoys.find((d) => d.admin);
  const shown = limit ? real.slice(0, limit) : real;
  const secretOf = (pk: string) => home?.decoys.find((d) => d.public_key === pk);
  return (
    <Panel title="Decoys" icon={KeyRound} id="decoys-title" meta={<ExtLink href={explorerAccount(bait)} className="text-fg-faint">{bait}</ExtLink>} bodyClassName="p-0"
      actions={canAdd ? <Button variant="line" size="xs" onClick={onAdd} disabled={adding} data-testid="decoys-add"><Plus aria-hidden />{adding ? "Adding…" : "Add"}</Button> : undefined}>
      {!exists ? (
        <EmptyState icon={KeyRound} title="No bait account yet" className="py-8">
          <p data-testid="decoys-no-bait">Decoys are keys on your bait, <span className="font-mono">{bait}</span>, which is created with your guardian. Protect your account first.</p>
        </EmptyState>
      ) : real.length === 0 ? (
        <EmptyState icon={KeyRound} title="No decoys yet" className="py-8">
          <p data-testid="decoys-empty">
            Your bait holds {admin ? "only its own key" : decoys.length ? "only keys this browser cannot tell apart" : "no keys"}.{" "}
            {canAdd ? "Add a decoy: a fresh key on the bait, signed here by the bait's own key." : "With the home exported to a CLI home, standin dev up mints a pool of decoys."}
          </p>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line" data-testid="decoys">
          {shown.map((d) => {
            const mine = secretOf(d.public_key);
            const trip = d.trippedBy[0];
            return (
              <li key={d.public_key} className="space-y-1.5 px-3.5 py-2.5" data-testid="decoy-row" data-signed={d.signed}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={d.signed ? "size-1.5 shrink-0 rounded-full bg-trip" : "size-1.5 shrink-0 rounded-full bg-decoy"} aria-hidden />
                  <CopyText value={d.public_key} display={shortKey(d.public_key, 10, 6)} />
                  {d.signed ? <Tag tone={home ? "trip" : "muted"}>{home ? "used · " : ""}signed {d.signedTxs} tx</Tag> : <Tag tone="decoy">dormant</Tag>}
                  {trip && <Tag tone="trip">froze {trip.guardian.split(".")[0]}</Tag>}
                  {mine && <Tag tone="muted">secret in this browser</Tag>}
                </div>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-faint">
                  {mine?.tx_hash && <span>added in <ExtLink href={explorerTx(mine.tx_hash)} className="text-[11px]">{shortKey(mine.tx_hash, 6, 4)}</ExtLink></span>}
                  {trip && <TheftLink txHash={trip.trip_tx} lookup={thefts[freezeKey(trip)]} />}
                  {trip && <span>freeze at block <ExtLink href={blockUrl(Number(trip.at_block))} className="text-[11px]">{trip.at_block}</ExtLink></span>}
                  {mine && !d.signed && (
                    <span className="inline-flex items-center gap-1">
                      leak it on purpose: <CopyText value={mine.secret_key} display="copy decoy secret" className="text-[11px]" />
                    </span>
                  )}
                </p>
              </li>
            );
          })}
          {limit && real.length > limit && <li className="px-3.5 py-2 text-[11px] text-fg-faint">{real.length - limit} more on the Decoys page.</li>}
        </ul>
      )}
      {admin && (
        <p className="border-t border-line px-3.5 py-2 text-[11px] text-fg-faint">
          Not a decoy: <span className="font-mono">{shortKey(admin.public_key, 8, 6)}</span>, the bait's own key{admin.heldHere ? " (in this browser)" : ""}, which adds decoys.
        </p>
      )}
      {!admin && real.length > 0 && !home && (
        <p className="border-t border-line px-3.5 py-2 text-[11px] text-fg-faint">One of these keys is the bait's own key, held by whoever created it (a CLI home or another browser).</p>
      )}
    </Panel>
  );
}
