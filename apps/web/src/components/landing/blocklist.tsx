import { Cpu, FileCheck2, Link2, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { Frame, FramePanel, PanelBar } from "./frame";
import { Reveal, Section, SectionHead } from "./primitives";

const CHECKS = [
  { icon: Link2, text: "Reads the transaction from NEAR RPC itself and checks the hash." },
  { icon: FileCheck2, text: "Confirms the signer is the bait account and the key was one of its decoys at that block." },
  { icon: PenLine, text: "Names the attacker from the transfer and signs the verdict with a key that never leaves the enclave." },
  { icon: Cpu, text: "The blocklist contract verifies that signature against the pinned key before it adds an entry." },
];

type Verdict = "block" | "warn" | "allow";
const RUNS: { cmd: string; verdict: Verdict; reason: string; outcome: string }[] = [
  {
    cmd: "standin pay kx-sweeper.testnet 2",
    verdict: "block",
    reason: "on Stand-in blocklist · TEE verdict",
    outcome: "refused",
  },
  {
    cmd: "standin pay new-vendor.testnet 1",
    verdict: "warn",
    reason: "account is younger than 7 days",
    outcome: "needs --approve-warn",
  },
  {
    cmd: "standin pay si-project.testnet record_deploy",
    verdict: "allow",
    reason: "no flags · earlier tool calls touched this account",
    outcome: "sent",
  },
];

const PILL: Record<Verdict, string> = {
  block: "border-trip/40 bg-trip-soft text-trip",
  warn: "border-warn/40 bg-warn/10 text-warn",
  allow: "border-safe/35 bg-safe-soft text-safe",
};

function Checks() {
  return (
    <Frame>
      <FramePanel className="overflow-hidden">
        <PanelBar right={<span className="text-safe">attested · Intel TDX</span>}>
          counterparty <span className="text-fg-faint">/</span> <span className="text-fg">check before paying</span>
        </PanelBar>
        <ul className="divide-y divide-line">
          {RUNS.map((r) => (
            <li key={r.cmd} className="px-4 py-4 font-mono text-[12px]">
              <p className="truncate text-fg">
                <span className="mr-2 text-fg-faint select-none" aria-hidden>
                  $
                </span>
                {r.cmd}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 pl-4">
                <span className={cn("inline-flex w-14 justify-center rounded border py-0.5 text-[10.5px] uppercase", PILL[r.verdict])}>
                  {r.verdict}
                </span>
                <span className="min-w-0 text-fg-muted">{r.reason}</span>
                <span className={cn("ml-auto text-[11px]", r.verdict === "block" ? "text-trip" : "text-fg-muted")}>
                  {r.outcome}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </FramePanel>
    </Frame>
  );
}

export function Blocklist() {
  return (
    <Section id="blocklist" labelledBy="blocklist-title">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div>
          <SectionHead
            id="blocklist-title"
            eyebrow="Shared blocklist"
            title="A blocklist you can verify."
            muted="Proved in a TEE."
          >
            <p>
              Every trip puts the thief's account on a shared blocklist. The entry is produced by a verdict app running
              on OutLayer inside an Intel TDX enclave, so anyone can check the attestation instead of trusting us.
            </p>
          </SectionHead>
          <Reveal delay={0.06}>
            <ol className="mt-8 space-y-4">
              {CHECKS.map((c, i) => (
                <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-fg-muted">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line-strong bg-ink-900 text-fg">
                    <c.icon className="size-3.5" aria-hidden />
                  </span>
                  {c.text}
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
        <Reveal delay={0.1} className="lg:pt-20">
          <Checks />
          <p className="mt-4 text-[13px] leading-relaxed text-fg-muted">
            Other agents run the same check before they pay: <span className="text-safe">allow</span>,{" "}
            <span className="text-warn">warn</span> or <span className="text-trip">block</span>.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
