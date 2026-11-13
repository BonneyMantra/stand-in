import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INSTALL } from "./content";
import { Frame, FramePanel } from "./frame";
import { CommandLine, Reveal, Section, SectionHead } from "./primitives";

const TABS = [
  {
    id: "claude",
    label: "Claude Code",
    version: "v2.1.323",
    lines: INSTALL.claude,
    prompt: ">",
    after: "Hooks watch every tool input and output for decoy keys. Each new session gets its own decoy.",
  },
  {
    id: "codex",
    label: "Codex",
    version: "codex-cli 0.169.0",
    lines: INSTALL.codex,
    prompt: "$",
    after: "Adds the same hooks to Codex. Sessions are told apart by their own decoy key.",
  },
  {
    id: "cli",
    label: "CLI",
    version: "npx",
    lines: INSTALL.cli,
    prompt: "$",
    after: "Moves the real full-access key out of the agent's reach and plants the decoys.",
  },
] as const;

const POINTS = [
  "The agent keeps working: it holds a function-call key scoped to your contract.",
  "No prompt changes. Decoys sit where real keys used to be.",
  "Tested against Claude Code 2.1.323 and codex-cli 0.169.0.",
];

function InstallPanel() {
  return (
    <Frame>
      <FramePanel className="overflow-hidden">
        <Tabs defaultValue="claude" className="gap-0">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
            <TabsList variant="line" className="h-8 gap-1 bg-transparent p-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="rounded-md !border-transparent px-2.5 font-mono text-[12px] data-[state=active]:!bg-ink-800">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span aria-hidden className="mt-0.5 grid size-8 shrink-0 grid-cols-3 gap-px rounded-md bg-ink-950 p-1.5">
                  {Array.from({ length: 9 }, (_, i) => (
                    <i key={i} className={i === 4 ? "bg-trip" : i % 2 ? "bg-fg-faint" : "bg-fg-muted"} />
                  ))}
                </span>
                <div className="min-w-0 font-mono text-[12px] leading-relaxed">
                  <p className="text-fg">
                    {t.label} <span className="text-fg-muted">{t.version}</span>
                  </p>
                  <p className="truncate text-fg-muted">~/code/near-payments-agent</p>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                {t.lines.map((l) => (
                  <CommandLine key={l} command={l} prompt={t.prompt} />
                ))}
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-fg-muted">{t.after}</p>
            </TabsContent>
          ))}
        </Tabs>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3 font-mono text-[12px] text-fg-muted">
          <span aria-hidden>&gt;</span>
          <span className="truncate">Install Stand-in for this project and show me where the decoys went</span>
          <span aria-hidden className="h-4 w-[7px] shrink-0 animate-pulse bg-fg-muted" />
        </div>
      </FramePanel>
    </Frame>
  );
}

export function Agents() {
  return (
    <Section id="agents" labelledBy="agents-title">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <SectionHead id="agents-title" eyebrow="Install" title="Built for engineers" muted="and their agents.">
          <p>
            Stand-in ships as a Claude Code plugin, a Codex setup command and a CLI. Install it from inside the agent you
            already use; it does the key work and tells you where every decoy went.
          </p>
          <ul className="space-y-2 pt-2">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-2.5">
                <span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-fg-faint" />
                {p}
              </li>
            ))}
          </ul>
        </SectionHead>
        <Reveal delay={0.08}>
          <InstallPanel />
        </Reveal>
      </div>
    </Section>
  );
}
