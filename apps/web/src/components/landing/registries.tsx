import { PROOF_TX, txUrl } from "./content";
import { Frame, FramePanel, PanelBar } from "./frame";
import { Reveal, Section, SectionHead, SourceLink } from "./primitives";

type Line = { op: string; arg: string; result: string; tone: "ok" | "keep" | "fail" };

const PANELS: {
  title: string;
  path: string;
  lines: Line[];
  body: string;
  tx: string;
  txLabel: string;
}[] = [
  {
    title: "NEAR account keys",
    path: "si-agent.testnet / access keys",
    lines: [
      { op: "freeze", arg: "called by the watcher key", result: "sent", tone: "keep" },
      { op: "DeleteKey", arg: "agent function-call key", result: "deleted", tone: "ok" },
      { op: "DeleteKey", arg: "session function-call key", result: "deleted", tone: "ok" },
      { op: "owner key", arg: "held outside the agent", result: "kept", tone: "keep" },
    ],
    body: "One DeleteKey receipt per agent key, so one failure cannot block the rest. The full-access owner key was never in the agent's reach and survives the freeze.",
    tx: PROOF_TX.freeze,
    txLabel: "Freeze signed by the watcher key",
  },
  {
    title: "NEAR Intents registry",
    path: "intents / public keys",
    lines: [
      { op: "remove_public_key", arg: "agent intents key", result: "removed", tone: "ok" },
      { op: "execute_signed", arg: "intent signed before the freeze", result: "PublicKeyNotExist", tone: "fail" },
    ],
    body: "An intent signed before the freeze still carries a valid signature. The registry checks that the key is registered now, so the queued intent fails.",
    tx: PROOF_TX.intentRejected,
    txLabel: "Signed intent rejected after the freeze",
  },
];

const TONE = { ok: "text-safe", keep: "text-fg-muted", fail: "text-trip" } as const;

export function Registries() {
  return (
    <Section id="registries" labelledBy="registries-title">
      <SectionHead
        id="registries-title"
        eyebrow="The freeze"
        title="Both key registries."
        muted="Queued intents die with the keys."
      >
        <p>
          Deleting account keys is not enough when an agent also trades through NEAR Intents: a signed intent can sit in
          a queue and settle later. The freeze removes the agent's keys from both places in the same call.
        </p>
      </SectionHead>

      <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PANELS.map((p, i) => (
          <Reveal key={p.title} delay={0.05 + i * 0.07}>
            <Frame className="h-full">
              <FramePanel className="flex h-full flex-col overflow-hidden">
                <PanelBar>{p.path}</PanelBar>
                <div className="px-5 pt-5">
                  <h3 className="text-[17px] font-medium tracking-tight">{p.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{p.body}</p>
                </div>
                <ul className="mx-5 mt-5 divide-y divide-line rounded-md border border-line bg-ink-950 font-mono text-[11.5px]">
                  {p.lines.map((l, j) => (
                    <li key={j} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0 sm:truncate">
                        <span className="text-fg">{l.op}</span>{" "}
                        <span className="text-fg-muted">{l.arg}</span>
                      </span>
                      <span className={`shrink-0 ${TONE[l.tone]}`}>{l.result}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-5">
                  <span className="text-[13px] text-fg">{p.txLabel}</span>
                  <SourceLink href={txUrl(p.tx)}>
                    {p.tx.slice(0, 6)}…{p.tx.slice(-4)} on nearblocks
                  </SourceLink>
                </div>
              </FramePanel>
            </Frame>
          </Reveal>
        ))}
      </div>
      <p className="mt-5 max-w-3xl text-[13px] leading-relaxed text-fg-muted">
        On testnet the Intents side runs against a replica of the near/intents account-key registry that keeps the
        upstream check order: signature first, then "is this key registered for the signer now".
      </p>
    </Section>
  );
}
