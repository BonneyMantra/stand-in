import { motion } from "motion/react";
import { agentName, KIND_LABEL, shortKey } from "@/data/derive";
import { cn } from "@/lib/utils";
import { H, W, type MapCluster, type MapNode } from "./layout";

/** Hover/focus card, after the Edge dashboard's "Singapore" region card. */
export function MapTooltip({ node, cluster }: { node: MapNode; cluster: MapCluster }) {
  const left = (node.x / W) * 100;
  const top = (node.y / H) * 100;
  const flipX = left > 62;
  const flipY = top > 58;
  const dot = node.status === "tripped" ? "bg-trip" : node.status === "exposed" ? "bg-warn" : "bg-fg-muted";
  return (
    <motion.div
      role="tooltip"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
      className="pointer-events-none absolute z-10 w-60 rounded-lg border border-line-strong bg-ink-850/95 p-3 shadow-2xl shadow-black/60 backdrop-blur"
      style={{
        left: `${left}%`, top: `${top}%`,
        translate: `${flipX ? "calc(-100% - 14px)" : "14px"} ${flipY ? "calc(-100% - 10px)" : "10px"}`,
        transformOrigin: `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
        <span className="truncate text-xs font-medium text-fg">{cluster.label}</span>
        <span className={cn("ml-auto font-mono text-[10px]", node.status === "tripped" ? "text-trip" : node.status === "exposed" ? "text-warn" : "text-fg-faint")}>
          {node.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
        <dt className="text-fg-faint">key</dt>
        <dd className="truncate text-fg-muted">{shortKey(node.pk, 8, 6)}</dd>
        <dt className="text-fg-faint">where</dt>
        <dd className="truncate text-fg-muted">{KIND_LABEL[node.kind] ?? node.kind}</dd>
        <dt className="text-fg-faint">path</dt>
        <dd className="truncate text-fg-muted" title={node.path}>{node.path}</dd>
        <dt className="text-fg-faint">agent</dt>
        <dd className="truncate text-fg-muted">{agentName(node.agent)}</dd>
      </dl>
    </motion.div>
  );
}
