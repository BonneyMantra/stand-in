import { Link } from "react-router";
import { Eye, Radio, Snowflake, Zap } from "lucide-react";
import type { StandinState } from "@/data/types";
import { agentName, alreadyFrozen, fmtTime, sessionLabel, shortHash, tripTime } from "@/data/derive";
import { cn } from "@/lib/utils";
import { EmptyState, Panel } from "./common";

interface Item {
  key: string;
  icon: typeof Zap;
  tone: "trip" | "warn" | "decoy" | "muted";
  title: string;
  detail: string;
  when: string;
  href?: string;
  t: number;
}

export function buildFeed(s: StandinState, limit = 9): Item[] {
  const items: Item[] = [];
  for (const t of s.trips) {
    const at = tripTime(s, t);
    const base = at ? new Date(at).getTime() : t.block_height;
    items.push({
      key: `trip-${t.tx_hash}`, icon: Zap, tone: "trip", href: `/app/trips/${t.tx_hash}`, t: base + 0.5,
      title: `Decoy used by ${t.attacker_account}`,
      detail: `${t.attributed_to.tool_name || "no tool call"} · ${sessionLabel(s, t.attributed_to.session_id)}`,
      when: at ? fmtTime(at) : `#${t.block_height}`,
    });
    if (t.freeze.tx_hash) {
      items.push({
        key: `freeze-${t.tx_hash}`, icon: Snowflake, tone: alreadyFrozen(t) ? "muted" : "trip", href: `/app/trips/${t.tx_hash}`, t: base + 1,
        title: alreadyFrozen(t) ? "Agent already frozen" : `Freeze landed in ${t.freeze.blocks_after_trip} blocks`,
        detail: `${t.freeze.deleted_keys.length} agent keys deleted · ${t.freeze.intents_keys_removed.length} intents key removed · ${shortHash(t.freeze.tx_hash)}`,
        when: s.recorded?.freeze_times[t.tx_hash] ? fmtTime(s.recorded.freeze_times[t.tx_hash]) : `#${t.freeze.block_height}`,
      });
    }
  }
  for (const e of s.exposures) {
    items.push({
      key: `exp-${e.tool_use_id}-${e.where}`, icon: Eye, tone: "warn", t: new Date(e.at).getTime(),
      title: `Decoy in ${e.tool_name} ${e.where.replace("_", " ")}`,
      detail: `${agentName(e.agent)} · ${sessionLabel(s, e.session_id)}`, when: fmtTime(e.at),
    });
  }
  return items.sort((a, b) => b.t - a.t).slice(0, limit);
}

const TONE = {
  trip: "border-trip/40 bg-trip-soft text-trip",
  warn: "border-warn/30 bg-warn/10 text-warn",
  decoy: "border-decoy/30 bg-decoy/10 text-decoy",
  muted: "border-line-strong bg-ink-850 text-fg-muted",
};

export function TripFeed({ state, live }: { state: StandinState; live: boolean }) {
  const items = buildFeed(state);
  return (
    <Panel
      title="Trip feed" icon={Radio} id="feed-title" bodyClassName="p-0 min-h-0 overflow-y-auto" className="xl:absolute xl:inset-0"
      meta={live ? "streaming /api/events" : "recorded"}
      actions={<Link to="/app/trips" className="text-[11px] text-fg-muted hover:text-fg">All trips</Link>}
    >
      {!items.length ? (
        <EmptyState icon={Radio} title="Quiet so far">No exposures or trips yet. Decoys seen in a tool call, decoys used on chain and freezes appear here the moment the watcher sees them.</EmptyState>
      ) : (
        <ol className="divide-y divide-line">
          {items.map((it) => {
            const body = (
              <div className="flex items-start gap-3 px-3.5 py-2.5">
                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border", TONE[it.tone])}>
                  <it.icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-[13px]", it.tone === "trip" ? "text-fg" : "text-fg-muted")}>{it.title}</p>
                  <p className="truncate font-mono text-[11px] text-fg-faint">{it.detail}</p>
                </div>
                <time className="shrink-0 font-mono text-[11px] text-fg-faint tabular-nums">{it.when}</time>
              </div>
            );
            return (
              <li key={it.key}>
                {it.href ? (
                  <Link to={it.href} className="block outline-none hover:bg-ink-900 focus-visible:bg-ink-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">{body}</Link>
                ) : body}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
