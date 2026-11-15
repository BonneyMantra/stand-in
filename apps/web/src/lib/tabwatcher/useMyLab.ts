import { useCallback, useEffect, useState } from "react";
import { readGuardian } from "../wallet/near";
import { guardiansOf } from "../wallet/factory";
import type { HomeRecord } from "../wallet/homeStore";
import { preflight, type Preflight } from "./preflight";
import { readJournal, type Journal } from "./journal";
import { myRunFor, IDLE_RUN, type MyRunState } from "./run";
import { TabRpc } from "./rpc";

export const uiRpc = new TabRpc();

/** `watchers`: each guardian's watcher from get_state (it cannot change, so it decides who can freeze it). */
export type Discovery = { status: "idle" | "loading" } | { status: "error"; message: string } | { status: "ok"; guardians: string[]; watchers: Record<string, string> };
export type PreState = { status: "idle" | "loading" } | { status: "error"; message: string } | { status: "ok"; pre: Preflight };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Everything the lab's "Run on my account" reads for a connected owner: the guardians they own (their own account and any
 * factory guardian), the one this run uses, and the preflight for it. `refresh()` reads all of it again.
 */
export function useMyLab(owner: string | null, home: HomeRecord | null) {
  const [disc, setDisc] = useState<Discovery>({ status: "idle" });
  const [pre, setPre] = useState<PreState>({ status: "idle" });
  const [pick, setPick] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const refresh = useCallback(() => setGen((g) => g + 1), []);
  const homeGuardians = home?.guardians.join(",") ?? "";

  useEffect(() => {
    if (!owner) {
      setDisc({ status: "idle" });
      return;
    }
    let alive = true;
    setDisc((d) => (d.status === "ok" ? d : { status: "loading" }));
    (async () => {
      const [own, factory] = await Promise.all([readGuardian(owner), guardiansOf(owner).catch(() => [] as string[])]);
      const list = [...(own.kind === "guardian" ? [owner] : []), ...factory];
      for (const g of homeGuardians ? homeGuardians.split(",") : []) if (!list.includes(g)) list.push(g);
      const watchers: Record<string, string> = {};
      if (own.kind === "guardian") watchers[owner] = own.state.watcher;
      await Promise.all(list.filter((g) => !watchers[g]).map(async (g) => {
        const r = await readGuardian(g).catch(() => null);
        if (r?.kind === "guardian") watchers[g] = r.state.watcher;
      }));
      if (alive) setDisc({ status: "ok", guardians: list, watchers });
    })().catch((e) => alive && setDisc({ status: "error", message: msg(e) }));
    return () => {
      alive = false;
    };
  }, [owner, homeGuardians, gen]);

  const found = disc.status === "ok" ? disc.guardians : [];
  const guardian = (pick && found.includes(pick) ? pick : null) ?? home?.guardians.find((g) => found.includes(g)) ?? home?.guardians[0] ?? found[0] ?? null;

  useEffect(() => {
    if (!home || !guardian) {
      setPre({ status: "idle" });
      return;
    }
    let alive = true;
    setPre((p) => (p.status === "ok" && p.pre.guardian === guardian ? p : { status: "loading" }));
    preflight(uiRpc, home, guardian).then(
      (p) => alive && setPre({ status: "ok", pre: p }),
      (e) => alive && setPre({ status: "error", message: msg(e) }),
    );
    return () => {
      alive = false;
    };
    // the keys and guardians identify the home; txs and decoys changing must not re-read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.bait.public_key, home?.watcher.public_key, guardian, gen]);

  return { disc, pre, guardian, setGuardian: setPick, refresh };
}

/** The page's run for this home, and the journal a closed tab left behind. */
export function useMyRun(home: HomeRecord | null) {
  const [state, setState] = useState<MyRunState>(IDLE_RUN);
  const [journal, setJournal] = useState<Journal | null>(() => (home ? readJournal(home.owner) : null));
  useEffect(() => {
    if (!home) {
      setState(IDLE_RUN);
      setJournal(null);
      return;
    }
    setJournal(readJournal(home.owner));
    const off = myRunFor(home).subscribe((s) => {
      setState(s);
      if (s.phase !== "running") setJournal(readJournal(home.owner));
    });
    return () => {
      off();
    };
  }, [home]);
  const start = useCallback((guardian: string) => (home ? myRunFor(home).start(guardian) : Promise.resolve()), [home]);
  const reloadJournal = useCallback(() => setJournal(home ? readJournal(home.owner) : null), [home]);
  return { state, journal, start, reloadJournal };
}
