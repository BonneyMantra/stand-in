import type { LucideIcon } from "lucide-react";
import { KeyRound, Lock, ScanSearch, ShieldBan, Snowflake, TriangleAlert } from "lucide-react";
import { Frame, FramePanel } from "./frame";
import { Reveal, Section, SectionHead } from "./primitives";

type Step = { verb: string; icon: LucideIcon; body: string; mono: string; tone: string };

const STEPS: Step[] = [
  {
    verb: "Adopt",
    icon: Lock,
    body: "Moves the real full-access key out of the agent's reach. The agent gets a function-call key scoped to one contract.",
    mono: "pnpm standin adopt",
    tone: "bg-fg-muted",
  },
  {
    verb: "Plant",
    icon: KeyRound,
    body: "Every place the real key used to be, and every new Claude Code or Codex session, gets its own decoy key. All on one bait account.",
    mono: "1 bait account · 1 key per location",
    tone: "bg-decoy",
  },
  {
    verb: "Trip",
    icon: TriangleAlert,
    body: "Someone signs with a decoy. The watcher sees the decoy key in the block stream and knows which one it was.",
    mono: "decoy signer seen on-chain",
    tone: "bg-trip",
  },
  {
    verb: "Freeze",
    icon: Snowflake,
    body: "Within about three blocks every agent key is deleted and removed from the NEAR Intents registry, so already-signed intents fail.",
    mono: "PublicKeyNotExist",
    tone: "bg-trip",
  },
  {
    verb: "Attribute",
    icon: ScanSearch,
    body: "The key that signed tells you where it leaked. The dashboard names the session and the exact tool call that exposed it.",
    mono: "session → tool call",
    tone: "bg-decoy",
  },
  {
    verb: "Blocklist",
    icon: ShieldBan,
    body: "The thief's account joins a shared blocklist with a proof computed in an OutLayer TEE. Other agents check it before paying.",
    mono: "allow · warn · block",
    tone: "bg-safe",
  },
];

/* Six-step sequence adapted from ReUI card-2 (frame grid, bordered icon tile, dotted backdrop on hover). */
export function HowItWorks() {
  return (
    <Section id="how" labelledBy="how-title">
      <SectionHead id="how-title" eyebrow="How it works" title="Let the leak happen." muted="Catch who leaked it.">
        <p>
          Stand-in does not try to stop an agent from reading files. It makes sure that what it reads is bait, and that
          using the bait costs the thief more than it costs you.
        </p>
      </SectionHead>

      <Reveal delay={0.05} className="mt-12">
        <Frame>
          <ol className="grid grid-cols-1 gap-[3px] sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.verb} className="contents">
                <FramePanel className="group/step flex min-h-[236px] flex-col overflow-hidden p-6 transition-colors duration-200 hover:bg-ink-850">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/step:opacity-100 [background-image:radial-gradient(var(--color-line-strong)_1px,transparent_1px)] [background-size:12px_12px] [mask-image:linear-gradient(160deg,black,transparent_55%)]"
                  />
                  <span aria-hidden className={`absolute top-0 left-6 h-px w-10 ${s.tone}`} />
                  <div className="relative flex items-center justify-between">
                    <span className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-ink-950 text-fg">
                      <s.icon className="size-4" aria-hidden />
                    </span>
                    <span className="font-mono text-[11px] text-fg-muted">{String(i + 1).padStart(2, "0")} / 06</span>
                  </div>
                  <h3 className="relative mt-6 text-[17px] font-medium tracking-tight">{s.verb}</h3>
                  <p className="relative mt-2 flex-1 text-[14px] leading-relaxed text-fg-muted">{s.body}</p>
                  <p className="relative mt-5 truncate font-mono text-[11.5px] text-fg">{s.mono}</p>
                </FramePanel>
              </li>
            ))}
          </ol>
        </Frame>
      </Reveal>
    </Section>
  );
}
