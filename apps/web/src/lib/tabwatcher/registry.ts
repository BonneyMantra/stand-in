import { canFreeze, type HomeRecord } from "../wallet/homeStore";
import { WatcherFreezer } from "./freezer";
import { KeySigner } from "./sign";
import { TabRpc, TAB_RPCS } from "./rpc";
import { TabWatcher } from "./watcher";

interface Entry { key: string; watcher: TabWatcher; freezer: WatcherFreezer; rpc: TabRpc }

/** One watcher per owner for the whole page, so the lab, the dashboard and any other mount share it. */
const entries = new Map<string, Entry>();

const keyOf = (h: HomeRecord) => [h.bait.account_id, h.bait.public_key, h.watcher.account_id, h.watcher.public_key, ...h.guardians].join("|");

/** The page's tab watcher for `home` (created stopped). A home whose keys or guardians changed gets a new one. */
export function tabWatcherFor(home: HomeRecord): Entry {
  const key = keyOf(home);
  const cur = entries.get(home.owner);
  if (cur && cur.key === key) return cur;
  cur?.watcher.stop();
  // Short timeouts and a 450 ms hedge: a slow node never holds a read for long, so a theft is seen within a block or two
  // and a stall shows within seconds.
  const rpc = new TabRpc(TAB_RPCS, undefined, 3000, 450);
  const signer = new KeySigner(rpc, home.watcher.account_id, home.watcher.secret_key);
  const freezer = new WatcherFreezer(rpc, signer, home.guardians.filter((g) => canFreeze(home, g)));
  const watcher = new TabWatcher({
    rpc, bait: home.bait.account_id, admin: home.bait.public_key, freezer, intervalMs: 350,
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    prepare: () => freezer.warm(),
  });
  const entry = { key, watcher, freezer, rpc };
  entries.set(home.owner, entry);
  return entry;
}

export const existingTabWatcher = (owner: string) => entries.get(owner)?.watcher ?? null;
