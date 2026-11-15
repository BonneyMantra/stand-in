import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { FOCUS } from "@/components/landing/primitives";

export type LabMode = "mine" | "demo";

const MODES: { id: LabMode; label: string; hint: string }[] = [
  { id: "mine", label: "Your account", hint: "your guardian, bait and watcher" },
  { id: "demo", label: "Lab accounts", hint: "no wallet needed" },
];

/**
 * Opens on "Your account" when this browser already holds a Stand-in home or a wallet session (the owner's own data comes
 * first), else on the no-wallet lab accounts. Reads storage directly so the demo tab does not load the wallet code.
 */
export function defaultMode(): LabMode {
  try {
    const s = window.localStorage;
    if (s.getItem("selected-wallet")) return "mine";
    for (let i = 0; i < s.length; i++) if (s.key(i)?.startsWith("standin.home.v1:")) return "mine";
  } catch {
    // storage blocked: the lab accounts need none
  }
  return "demo";
}

/** Two tabs above the run: arrow keys move between them (roving tab stop). */
export function LabModeSwitch({ mode, onChange }: { mode: LabMode; onChange: (m: LabMode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const j = (i + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length;
    onChange(MODES[j]!.id);
    refs.current[j]?.focus();
  };
  return (
    <div role="tablist" aria-label="Where the attack runs" className="mt-10 inline-flex max-w-full rounded-[12px] border border-line bg-ink-900/70 p-[3px]">
      {MODES.map((m, i) => {
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(m.id)}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={`lab-mode-${m.id}`}
            className={cn(
              "flex min-w-0 flex-col items-start rounded-[9px] px-3.5 py-2 text-left transition-colors duration-200 sm:px-4",
              on ? "bg-ink-800 text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-fg-muted hover:text-fg",
              FOCUS,
            )}
          >
            <span className="text-[13.5px] font-medium">{m.label}</span>
            <span className="truncate font-mono text-[10.5px] text-fg-faint">{m.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
