import { useState } from "react";
import { WatcherHeartbeat } from "@/components/lab/WatcherHeartbeat";
import type { HomeRecord } from "@/lib/wallet/homeStore";

const KEY = (owner: string) => `standin.tabwatch.autostart:${owner}`;

function readOptIn(owner: string): boolean {
  try { return localStorage.getItem(KEY(owner)) === "1"; } catch { return false; }
}
function writeOptIn(owner: string, on: boolean) {
  try { if (on) localStorage.setItem(KEY(owner), "1"); else localStorage.removeItem(KEY(owner)); } catch { /* storage blocked: the choice lasts this visit */ }
}

/**
 * The in-tab watcher (lib/tabwatcher, shared with the lab) for this browser's home. It starts only when the owner presses
 * Start or has opted in to starting it whenever My account is open; the CLI export is the always-on route.
 */
export function TabWatchSlot({ owner, home }: { owner: string; home: HomeRecord }) {
  const [auto, setAuto] = useState(() => readOptIn(owner));
  return (
    <div className="space-y-2 border-t border-line p-3.5" data-testid="tab-watch-slot">
      <WatcherHeartbeat home={home} autoStart={auto} />
      <label className="flex items-start gap-2 text-[11px] leading-relaxed text-fg-muted">
        <input type="checkbox" checked={auto} className="mt-0.5 accent-[var(--color-safe)]" data-testid="tab-watch-autostart"
          onChange={(e) => { setAuto(e.target.checked); writeOptIn(owner, e.target.checked); }} />
        Start watching whenever My account is open in this browser
      </label>
    </div>
  );
}
