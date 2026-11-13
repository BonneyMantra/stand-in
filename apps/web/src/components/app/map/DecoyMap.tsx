import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Play } from "lucide-react";
import type { StandinState, Trip } from "@/data/types";
import { alreadyFrozen, shortHash } from "@/data/derive";
import { useStandin } from "@/data/useStandin";
import { EmptyState, Panel } from "../common";
import { AGENT, ATTACKER, H, W, arc, dotField, layoutClusters, type MapNode } from "./layout";
import { MapTooltip } from "./MapTooltip";
import { useTripReplay } from "./useTripReplay";

const FILL = { dormant: "var(--color-fg-muted)", exposed: "var(--color-warn)", tripped: "var(--color-trip)" };
const EASE = [0.23, 1, 0.32, 1] as const;

export function DecoyMap({ state }: { state: StandinState }) {
  const nav = useNavigate();
  const { lastTripSignal } = useStandin();
  const clusters = useMemo(() => layoutClusters(state), [state]);
  const dots = useMemo(() => dotField(), []);
  const [hover, setHover] = useState<string | null>(null);

  // The trip to replay: newest live trip, else the latest trip with a measured freeze.
  const focus: Trip | undefined = useMemo(() => {
    const signalled = lastTripSignal && state.trips.find((t) => t.tx_hash === lastTripSignal.tx);
    return signalled || [...state.trips].reverse().find((t) => !alreadyFrozen(t) && t.freeze.block_height > 0) || state.trips.at(-1);
  }, [state.trips, lastTripSignal]);
  const blocks = focus ? Math.max(0, focus.freeze.blocks_after_trip) : 0;
  const autoKey = focus ? `${focus.tx_hash}:${lastTripSignal?.n ?? 0}` : null;
  const { phase, block, play, running } = useTripReplay(blocks, autoKey);

  const nodes = clusters.flatMap((c) => c.nodes);
  const byPk = new Map(nodes.map((n) => [n.pk, n]));
  const focusNode = focus ? byPk.get(focus.decoy_public_key) : undefined;
  const hovered = hover ? byPk.get(hover) : undefined;
  const hoveredCluster = hovered ? clusters.find((c) => c.id === hovered.group) : undefined;
  const tripsWithNode = state.trips.filter((t) => byPk.has(t.decoy_public_key));
  const frozenShown = focus ? phase === "frozen" && state.agent.frozen : state.agent.frozen;
  const statusOf = (n: MapNode) => (n.pk === focus?.decoy_public_key && phase === "idle" ? "exposed" : n.status);
  const counts = { dormant: 0, exposed: 0, tripped: 0 };
  for (const n of nodes) counts[n.status] += 1;

  return (
    <Panel
      title="Decoy map"
      icon={KeyRound}
      meta={`${nodes.length} keys · ${clusters.length} ${clusters.length === 1 ? "group" : "groups"}`}
      id="decoy-map-title"
      bodyClassName="p-0"
      actions={
        focus && (
          <button type="button" onClick={play} disabled={running} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-[11px] text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            <Play className="size-3" aria-hidden />Replay<span className="hidden sm:inline"> trip</span>
          </button>
        )
      }
    >
      {!nodes.length ? (
        <EmptyState icon={KeyRound} title="No decoys planted yet" className="min-h-[300px]">
          Run <code className="font-mono text-fg">standin adopt</code> or start a Claude Code / Codex session with the plugin; every planted decoy appears here as a node.
        </EmptyState>
      ) : (
        <>
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label="Map of planted decoy keys">
            <defs>
              <radialGradient id="dm-vignette" cx="0.45" cy="0.5" r="0.75">
                <stop offset="0.55" stopColor="var(--color-ink-950)" stopOpacity="0" />
                <stop offset="1" stopColor="var(--color-ink-950)" stopOpacity="0.95" />
              </radialGradient>
              <filter id="dm-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3.5" /></filter>
            </defs>
            <path d={dots.sparse} fill="var(--color-fg)" opacity="0.07" />
            <path d={dots.dense} fill="var(--color-fg)" opacity="0.16" />
            <rect width={W} height={H} fill="url(#dm-vignette)" />

            {clusters.map((c) => (
              <g key={c.id} aria-hidden>
                {c.nodes.map((n) => <line key={n.pk} x1={c.x} y1={c.y} x2={n.x} y2={n.y} stroke="var(--color-line-strong)" strokeWidth="0.8" />)}
                <circle cx={c.x} cy={c.y} r="2.6" fill="var(--color-ink-950)" stroke="var(--color-decoy)" strokeWidth="1" />
                {(c.status !== "dormant" || c.id === hovered?.group) && <text x={c.x + 24} y={c.y + 3} className="font-mono" fontSize="10" fill={c.status === "tripped" ? "var(--color-trip)" : c.status === "exposed" ? "var(--color-warn)" : "var(--color-fg-muted)"}>
                  {c.label.length > 26 ? `${c.label.slice(0, 25)}…` : c.label}
                </text>}
              </g>
            ))}

            {/* trip lines: decoy → thief */}
            {tripsWithNode.map((t) => {
              const n = byPk.get(t.decoy_public_key)!;
              const isFocus = t.tx_hash === focus?.tx_hash;
              const show = !isFocus || phase === "line" || phase === "count" || phase === "frozen";
              return (
                <AnimatePresence key={t.tx_hash}>
                  {show && (
                    <motion.path
                      d={arc(n, ATTACKER)} fill="none" stroke="var(--color-trip)" strokeWidth={isFocus ? 1.4 : 0.9}
                      strokeOpacity={isFocus ? 0.9 : 0.45} strokeDasharray={isFocus ? undefined : "3 3"}
                      initial={isFocus ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.7, ease: EASE }}
                    />
                  )}
                </AnimatePresence>
              );
            })}

            {/* freeze: watcher → agent account */}
            {focusNode && (phase === "count" || phase === "frozen") && (
              <motion.path d={arc(focusNode, AGENT, -0.12)} fill="none" stroke="var(--color-fg-faint)" strokeWidth="0.8" strokeDasharray="2 3"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: EASE }} aria-hidden />
            )}

            {nodes.map((n) => {
              const st = statusOf(n);
              const pulse = n.pk === focus?.decoy_public_key && phase === "pulse";
              return (
                <g
                  key={n.pk} tabIndex={0} role="button"
                  aria-label={`Decoy ${n.kind}, ${st}`}
                  className="cursor-pointer outline-none [&:focus-visible>circle:last-child]:stroke-fg"
                  onMouseEnter={() => setHover(n.pk)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(n.pk)} onBlur={() => setHover(null)}
                  onClick={() => st === "tripped" && state.trips.find((t) => t.decoy_public_key === n.pk) && nav(`/app/trips/${state.trips.find((t) => t.decoy_public_key === n.pk)!.tx_hash}`)}
                  onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }))}
                >
                  {st !== "dormant" && <circle cx={n.x} cy={n.y} r={st === "tripped" ? 7 : 5} fill={FILL[st]} opacity="0.5" filter="url(#dm-glow)" />}
                  {pulse && (
                    <motion.circle cx={n.x} cy={n.y} r={4} fill="none" stroke="var(--color-trip)" strokeWidth="1.2"
                      initial={{ scale: 1, opacity: 0.9 }} animate={{ scale: 5, opacity: 0 }}
                      transition={{ duration: 0.7, ease: "easeOut", repeat: 1 }} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
                  )}
                  <circle cx={n.x} cy={n.y} r="9" fill="transparent" />
                  <circle cx={n.x} cy={n.y} r={st === "dormant" ? 2.2 : 3} fill={FILL[st]} stroke="transparent" strokeWidth="1.5" />
                </g>
              );
            })}

            <AgentNode frozen={frozenShown} account={state.agent.account_id} phase={phase} block={block} blocks={blocks} />
            {state.trips.length > 0 && <AttackerNode account={focus?.attacker_account ?? state.trips[0].attacker_account} />}
          </svg>

          {hovered && hoveredCluster && <MapTooltip node={{ ...hovered, status: statusOf(hovered) }} cluster={hoveredCluster} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3.5 py-2 font-mono text-[10.5px] text-fg-faint">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-fg-muted" />dormant {counts.dormant}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-warn" />exposed {counts.exposed}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-trip" />tripped {counts.tripped}</span>
          {focus && (
            <p className="ml-auto hidden sm:block">
              trip {shortHash(focus.tx_hash)} · block {focus.block_height.toLocaleString()}
            </p>
          )}
          </div>
        </>
      )}
    </Panel>
  );
}

function AgentNode({ frozen, account, phase, block, blocks }: { frozen: boolean; account: string; phase: string; block: number; blocks: number }) {
  const c = frozen ? "var(--color-trip)" : "var(--color-safe)";
  return (
    <g aria-label={`Agent account ${account}, ${frozen ? "frozen" : "active"}`} role="img">
      <circle cx={AGENT.x} cy={AGENT.y} r="20" fill={c} opacity="0.12" filter="url(#dm-glow)" />
      <motion.circle cx={AGENT.x} cy={AGENT.y} r="13" fill="var(--color-ink-950)" stroke={c} strokeWidth="1.2"
        animate={{ stroke: c }} transition={{ duration: 0.3 }} />
      <circle cx={AGENT.x} cy={AGENT.y} r="4" fill={c} />
      {(phase === "count" || (frozen && phase === "frozen")) && (
        <motion.g initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }}>
          <rect x={AGENT.x - 52} y={AGENT.y - 52} width="104" height="24" rx="6" fill="var(--color-ink-900)" stroke={phase === "count" ? "var(--color-line-strong)" : "var(--color-trip)"} strokeOpacity="0.8" />
          <text x={AGENT.x} y={AGENT.y - 36} textAnchor="middle" className="font-mono" fontSize="11.5" fill={phase === "count" ? "var(--color-fg)" : "var(--color-trip)"}>
            {phase === "count" ? `block +${block} / ${blocks}` : "FROZEN"}
          </text>
        </motion.g>
      )}
      <text x={AGENT.x} y={AGENT.y + 32} textAnchor="middle" className="font-mono" fontSize="10" fill="var(--color-fg-muted)">{account}</text>
      <text x={AGENT.x} y={AGENT.y + 46} textAnchor="middle" className="font-mono" fontSize="10" fill={c}>
        {phase === "count" ? `freeze landing · block +${block}` : frozen ? (blocks > 0 ? `frozen · ${blocks} blocks after trip` : "frozen") : "guarded · keys live"}
      </text>
    </g>
  );
}

function AttackerNode({ account }: { account: string }) {
  const { x, y } = ATTACKER;
  return (
    <g role="img" aria-label={`Attacker ${account}`}>
      <circle cx={x} cy={y} r="14" fill="var(--color-trip)" opacity="0.18" filter="url(#dm-glow)" />
      <path d={`M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}`} stroke="var(--color-trip)" strokeWidth="1.6" strokeLinecap="round" />
      <text x={x + 8} y={y + 26} textAnchor="end" className="font-mono" fontSize="10" fill="var(--color-trip)">{account}</text>
    </g>
  );
}
