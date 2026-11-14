import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { StandinState } from "@/data/types";
import { alreadyFrozen, shortKey } from "@/data/derive";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CopyText, Panel, Tag } from "./common";

interface KeyRow {
  pk: string;
  state: "active" | "deleted";
  block?: number;
}

function rows(live: string[], removedBy: (t: StandinState["trips"][number]) => string[], s: StandinState, extra: string[]): KeyRow[] {
  const out = new Map<string, KeyRow>();
  for (const pk of live) out.set(pk, { pk, state: "active" });
  for (const t of s.trips) {
    if (alreadyFrozen(t)) continue;
    for (const pk of removedBy(t)) if (!out.has(pk)) out.set(pk, { pk, state: "deleted", block: t.freeze.block_height });
  }
  for (const pk of extra) if (!out.has(pk)) out.set(pk, { pk, state: "deleted" });
  return [...out.values()];
}

const SHOWN = 4;

function Registry({ title, where, list }: { title: string; where: string; list: KeyRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-3.5 py-2">
        <h3 className="shrink-0 text-xs font-medium whitespace-nowrap text-fg">{title}</h3>
        <span className="truncate font-mono text-[10.5px] text-fg-faint">{where}</span>
      </div>
      {list.length === 0 ? (
        <p className="px-3.5 py-4 text-xs text-fg-faint">No keys registered.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((k) => (
            <li key={k.pk} className="flex min-w-0 items-center gap-2 px-3.5 py-2">
              <span className={cn("size-1.5 shrink-0 rounded-full", k.state === "active" ? "bg-safe" : "bg-trip")} aria-hidden />
              <CopyText value={k.pk} display={shortKey(k.pk, 8, 6)} className={cn(k.state === "deleted" && "line-through decoration-trip/60")} />
              <span className="ml-auto shrink-0">
                {k.state === "active" ? <Tag tone="safe">active</Tag> : <Tag tone="trip">{k.block ? `deleted #${k.block}` : "deleted"}</Tag>}
              </span>
            </li>
          ))}
          {list.length > SHOWN && (
            <li>
              <Button variant="bare" size="bare" onClick={() => setAll((v) => !v)} aria-expanded={all} className="w-full justify-start rounded-none px-3.5 py-2 text-left font-mono text-[11px] text-fg-muted outline-none transition-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                {all ? "show fewer" : `+${list.length - SHOWN} more`}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Both registries the guardian controls: function-call keys on the agent account and keys in the intents registry. */
export function AgentKeysPanel({ state }: { state: StandinState }) {
  const intents = state.recorded?.accounts.intents ?? "intents registry";
  const agentRows = rows(state.agent.agent_keys, (t) => t.freeze.deleted_keys, state, state.recorded?.deleted_agent_keys ?? []);
  const intentRows = rows(state.agent.intents_keys, (t) => t.freeze.intents_keys_removed, state, state.recorded?.removed_intents_keys ?? []);
  return (
    <Panel
      title="Agent account" icon={ShieldCheck} id="agent-title" bodyClassName="p-0"
      meta={state.agent.account_id}
      actions={state.agent.frozen ? <Tag tone="trip">frozen</Tag> : <Tag tone="safe">active</Tag>}
    >
      <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <Registry title="Agent keys" where={`function-call · ${state.agent.account_id}`} list={agentRows} />
        <Registry title="Intents keys" where={intents} list={intentRows} />
      </div>
      <p className="border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-faint">
        The owner's full-access key lives in the macOS keychain and is never registered here; a freeze deletes every key above and leaves the owner key.
      </p>
    </Panel>
  );
}
