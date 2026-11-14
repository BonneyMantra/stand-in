import type { LucideIcon } from "lucide-react";
import { KeyRound, Lock, ScanSearch, ShieldBan, Snowflake, TriangleAlert } from "lucide-react";
import { Frame, FramePanel } from "./frame";
import { Bleed, LiveLink } from "./cta";
import { Reveal, Section, SectionHead } from "./primitives";

type Step = { verb: string; icon: LucideIcon; body: string; mono: string; tone: string };

const STEPS: Step[] = [
  {
    verb: "Adopt",
    icon: Lock,
    body: "The owner's key stays in their own wallet, which approves a function-call key for the agent, scoped to one contract. No wallet? The CLI moves the real key out of the agent's reach.",
    mono: "pnpm standin adopt --wallet",
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

/* The six steps as one framed shot beside a short text column; the frame runs off the right edge. */
export function HowItWorks() {
  return (
    <Section id="how" labelledBy="how-title">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,470px)_minmax(0,1fr)] lg:gap-16">
        <SectionHead
          id="how-title"
          title="Let the leak happen."
          second="Catch who leaked it."
          live={<LiveLink to="/lab">Run the whole loop live</LiveLink>}
          className="lg:sticky lg:top-28 lg:self-start"
        >
          <p>
            Adopt once. Each new Claude Code or Codex session gets its own decoy, and the first signature from one
            freezes the real account.
          </p>
        </SectionHead>

        <Reveal delay={0.05} className="min-w-0">
          <Bleed fade={false}>
            <Frame>
              <FramePanel className="overflow-hidden">
                <ol className="divide-y divide-line">
                  {STEPS.map((s, i) => (
                    <li key={s.verb} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-4 gap-y-1 px-5 py-5 sm:grid-cols-[36px_120px_minmax(0,1fr)] sm:px-6 lg:max-w-[760px]">
                      <span className="row-span-2 flex size-9 items-center justify-center rounded-lg border border-line-strong bg-ink-950 text-fg sm:row-span-1">
                        <s.icon className="size-4" aria-hidden />
                      </span>
                      <h3 className="flex items-center gap-2 text-[15px] font-medium tracking-tight sm:h-9">
                        <span aria-hidden className={`size-1.5 rounded-full ${s.tone}`} />
                        {s.verb}
                        <span className="sr-only">, step {i + 1} of 6</span>
                      </h3>
                      <div className="min-w-0 sm:col-start-3 sm:row-start-1">
                        <p className="text-[14px] leading-[21px] text-white/[0.63]">{s.body}</p>
                        <p className="mt-2 truncate font-mono text-[11.5px] text-fg">{s.mono}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </FramePanel>
            </Frame>
          </Bleed>
        </Reveal>
      </div>
    </Section>
  );
}
