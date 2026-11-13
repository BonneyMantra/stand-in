import { INCIDENT, INTEGRATIONS, PROBLEM_STATS } from "./content";
import { Frame, FramePanel } from "./frame";
import { Reveal, Section, SectionHead, SourceLink } from "./primitives";

/** Text marks only: no logos we do not own. */
export function IntegrationsRow() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 sm:px-6 lg:px-10">
      <Reveal>
        <p className="mb-4 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">Works with</p>
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-5">
          {INTEGRATIONS.map((name, i) => (
            <li
              key={name}
              className={`flex h-16 items-center justify-center bg-ink-950 text-[15px] font-medium tracking-tight text-fg-muted transition-colors hover:bg-ink-900 hover:text-fg ${
                i === INTEGRATIONS.length - 1 ? "col-span-2 sm:col-span-1" : ""
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

export function Problem() {
  return (
    <Section id="problem" labelledBy="problem-title">
      <SectionHead
        id="problem-title"
        eyebrow="The problem"
        title="Coding agents read everything."
        muted="Scanners read it faster."
      >
        <p>
          An agent with shell access can open <code className="font-mono text-fg">~/.near-credentials</code>, echo
          your <code className="font-mono text-fg">.env</code> into a log, or follow an instruction hidden in a README.
          Once a key is in a public commit or an attacker's request, the race is already over.
        </p>
      </SectionHead>

      {/* Divided-cell stat strip adapted from ReUI stats-7: one frame, hairline-split cells. */}
      <Reveal delay={0.05} className="mt-12">
        <Frame>
          <FramePanel className="grid grid-cols-1 overflow-hidden p-0 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEM_STATS.map((s, i) => (
              <div
                key={s.label}
                className={`flex flex-col justify-between gap-8 p-6 ${i > 0 ? "border-t border-line sm:border-t-0" : ""} ${
                  i % 2 === 1 ? "sm:border-l" : ""
                } ${i >= 2 ? "sm:border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
              >
                <div>
                  <p className="font-mono text-[34px] leading-none tracking-[-0.03em] text-fg tabular-nums sm:text-[38px]">
                    {s.value}
                    {s.unit ? <span className="ml-0.5 text-[20px] text-fg-muted">{s.unit}</span> : null}
                  </p>
                  <p className="mt-4 text-[14px] leading-snug text-fg">{s.label}</p>
                  <p className="mt-1.5 text-[13px] leading-snug text-fg-muted">{s.detail}</p>
                </div>
                <SourceLink href={s.href}>{s.source}</SourceLink>
              </div>
            ))}
          </FramePanel>
          <FramePanel className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-fg-muted">
              <span className="mr-2 inline-flex items-center gap-1.5 rounded border border-trip/35 bg-trip-soft px-1.5 py-0.5 font-mono text-[11px] text-trip">
                <i className="size-1.5 rounded-full bg-trip" />
                incident
              </span>
              {INCIDENT.text} Reported loss: <span className="text-fg">"{INCIDENT.quote}"</span>,{" "}
              <span className="font-mono text-fg">{INCIDENT.amount}</span>.
            </p>
            <SourceLink href={INCIDENT.href} className="shrink-0">
              {INCIDENT.source}
            </SourceLink>
          </FramePanel>
        </Frame>
      </Reveal>
    </Section>
  );
}
