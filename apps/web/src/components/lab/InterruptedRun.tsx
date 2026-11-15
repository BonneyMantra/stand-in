import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, History } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { FOCUS } from "@/components/landing/primitives";
import { shortHash } from "@/lib/lab/types";
import { explorerTx } from "@/lib/wallet/near";
import { canFreeze, recordHomeTx, type HomeRecord } from "@/lib/wallet/homeStore";
import { assessInterrupted, type Interrupted } from "@/lib/tabwatcher/interrupted";
import { writeJournal, type Journal } from "@/lib/tabwatcher/journal";
import { freezeArgs } from "@/lib/tabwatcher/detect";
import { tabWatcherFor } from "@/lib/tabwatcher/registry";
import { cleanUp } from "@/lib/tabwatcher/runSteps";
import { KeySigner } from "@/lib/tabwatcher/sign";
import { uiRpc } from "@/lib/tabwatcher/useMyLab";
import { cn } from "@/lib/utils";

const TONE = { safe: "text-safe", trip: "text-trip", warn: "text-warn", muted: "text-fg-muted" } as const;

/**
 * A run whose tab closed before it finished. It says only what the chain shows now (assessInterrupted), and offers what is
 * left to do: freeze with the watcher key if the theft landed unfrozen, send the loot back, delete the decoy.
 */
export function InterruptedRun({ journal, home, onClosed }: { journal: Journal; home: HomeRecord; onClosed: () => void }) {
  const [a, setA] = useState<Interrupted | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const assess = useCallback(() => {
    assessInterrupted(uiRpc, journal).then((r) => { setErr(null); setA(r); }, (e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [journal]);
  useEffect(assess, [assess]);

  const close = () => {
    writeJournal({ ...journal, phase: "failed", finished_at: new Date().toISOString(), current: `${journal.current ?? "run"} (tab closed)` });
    onClosed();
  };

  const freezeNow = async () => {
    if (!journal.decoy_pk) return;
    setBusy("freeze");
    const r = await tabWatcherFor(home).freezer.freeze(journal.guardian, freezeArgs({ public_key: journal.decoy_pk, tx_hash: journal.tx.theft ?? null }, journal.bait), () => undefined);
    setNote(r.status === "landed" ? `Frozen in block ${r.block?.toLocaleString("en-US")} by ${home.watcher.account_id}.` : `Freeze ${r.status}: ${r.error ?? ""}`);
    if (r.tx_hash) {
      writeJournal({ ...journal, tx: { ...journal.tx, freeze: r.tx_hash } });
      recordHomeTx(home.owner, { hash: r.tx_hash, label: "lab run: freeze (after the tab closed)", at: Date.now() });
    }
    setBusy(null);
    assess();
  };

  const cleanNow = async () => {
    setBusy("clean");
    const out = await cleanUp(uiRpc, {
      bait: new KeySigner(uiRpc, home.bait.account_id, home.bait.secret_key),
      thief: { account: journal.thief.account, secret: journal.thief.secret_key },
      decoyPk: a?.decoyOnBait ? journal.decoy_pk ?? null : null, stole: a?.thiefExists ?? false,
    }, (label, h) => recordHomeTx(home.owner, { hash: h, label: `lab run: ${label}`, at: Date.now() }));
    setNote(out.map((o) => `${o.label}: ${o.hash ? `landed (${shortHash(o.hash)})${o.detail ? `, ${o.detail}` : ""}` : o.error}`).join(" · ") || "Nothing left to clean up.");
    setBusy(null);
    assess();
  };

  const canFreezeNow = !!a && a.theftLanded && !a.frozen && canFreeze(home, journal.guardian);
  const canClean = !!a && (a.decoyOnBait || a.thiefExists);
  return (
    <Alert variant="warning" className="border-warn/30 bg-warn/5" data-testid="my-interrupted">
      <History />
      <AlertTitle className="line-clamp-none">The last run on your account did not finish in this tab</AlertTitle>
      <AlertDescription>
        {err ? <p className="text-trip">Could not read the chain: {err}</p> : !a ? <p>Reading what happened from chain…</p> : (
          <ul className="space-y-1">
            {a.lines.map((l, i) => (
              <li key={i} className={TONE[l.tone]}>
                {l.text}
                {l.tx ? <> <a href={explorerTx(l.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-[11.5px] text-fg-muted underline-offset-4 hover:underline">{shortHash(l.tx)}<ArrowUpRight aria-hidden className="size-3" /></a></> : null}
              </li>
            ))}
          </ul>
        )}
        {note ? <p className="font-mono text-[11.5px] [overflow-wrap:anywhere] text-fg-muted">{note}</p> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          {canFreezeNow ? <Button variant="invert" size="sm" onClick={() => void freezeNow()} disabled={!!busy} className={cn("h-8", FOCUS)}>{busy === "freeze" ? "Freezing…" : "Freeze now with your watcher"}</Button> : null}
          {canClean ? <Button variant="line" size="sm" onClick={() => void cleanNow()} disabled={!!busy} className={cn("h-8", FOCUS)}>{busy === "clean" ? "Cleaning up…" : "Return the loot, delete the decoy"}</Button> : null}
          <Button variant="quiet" size="sm" onClick={close} disabled={!!busy} className={cn("h-8 border border-line-strong", FOCUS)}>Close this report</Button>
          {err ? <Button variant="quiet" size="sm" onClick={assess} className={cn("h-8", FOCUS)}>Read again</Button> : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
