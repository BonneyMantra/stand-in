import { useId, useRef, useState, type FormEvent } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { CornerDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { Frame, FramePanel } from "./frame";
import { EASE_OUT, FOCUS, Reveal } from "./primitives";
import { BLOCKLIST as B } from "./proof-data";
import { Receipt, judge, type Verdict } from "./blocklist-receipt";

const TRY = [
  { account: B.thief, note: "recorded thief" },
  { account: "si-project-5289.testnet", note: "Stand-in demo contract" },
];

const LADDER = [
  { level: "block", rule: "on the Stand-in blocklist, with a TEE-signed verdict", tone: "trip" },
  { level: "warn", rule: "younger than 7 days, missing, or its code changed in 72 h", tone: "warn" },
  { level: "allow", rule: "none of the above", tone: "safe" },
] as const;

const DOT = { trip: "bg-trip", warn: "bg-warn", safe: "bg-safe" } as const;
const TXT = { trip: "text-trip", warn: "text-warn", safe: "text-safe" } as const;

function Ladder({ v }: { v: Verdict }) {
  const lit = (level: string) => (v.kind === "block" ? level === "block" : v.kind === "clear" ? level !== "block" : false);
  return (
    <ol className="mt-6 space-y-2" aria-label="Verdict rules">
      {LADDER.map((l) => (
        <li key={l.level} className={cn("flex items-baseline gap-3 text-[13px] transition-opacity duration-300", lit(l.level) ? "opacity-100" : "opacity-40")}>
          <span className={cn("relative top-[-1px] size-1.5 shrink-0 rounded-full", DOT[l.tone])} aria-hidden />
          <span className={cn("w-11 shrink-0 font-mono text-[11.5px]", TXT[l.tone])}>{l.level}</span>
          <span className="text-fg-muted">{l.rule}</span>
        </li>
      ))}
    </ol>
  );
}

export function Blocklist() {
  const reduce = useReducedMotion();
  const inputId = useId();
  const [value, setValue] = useState<string>(B.thief);
  const [verdict, setVerdict] = useState<Verdict>({ kind: "block" });
  const [run, setRun] = useState(0);
  const slot = useRef<HTMLDivElement>(null);
  const printed = useInView(slot, { once: true, amount: 0.2 });

  const check = (account: string) => {
    setVerdict(judge(account));
    setRun((n) => n + 1);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    check(value);
  };

  return (
    <section id="blocklist" aria-labelledby="blocklist-title" className="relative scroll-mt-20 border-t border-line/70">
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-20 lg:px-10">
        <Reveal className="min-w-0">
          <p className="mb-4 font-mono text-[11px] tracking-[0.14em] text-fg-muted uppercase">Shared blocklist</p>
          <h2 id="blocklist-title" className="text-[30px] leading-[1.08] font-medium tracking-[-0.025em] text-balance sm:text-[40px]">
            Ask before you pay.
            <span className="block text-fg-muted">The thief is already on the list.</span>
          </h2>
          <p className="mt-5 max-w-[54ch] text-[15px] leading-relaxed text-pretty text-fg-muted">
            Every trip reports the thief to a shared blocklist. The verdict is computed inside an Intel TDX enclave on
            OutLayer, so any agent can check the attestation instead of trusting Stand-in.
          </p>

          <form onSubmit={submit} className="mt-8">
            <label htmlFor={inputId} className="mb-2 block font-mono text-[11px] text-fg-muted">
              Try it: who is your agent about to pay?
            </label>
            <InputGroup className="h-auto rounded-lg border-line-strong bg-ink-900 py-1.5 pr-1.5 font-mono text-[13px] shadow-none has-[>[data-align=inline-start]]:[&>input]:pl-3.5 sm:text-[14px] sm:has-[>[data-align=inline-start]]:[&>input]:pl-2">
              <InputGroupAddon aria-hidden className="hidden py-0 pl-3.5 font-normal text-[length:inherit] text-fg-faint sm:flex">standin pay</InputGroupAddon>
              <InputGroupInput
                id={inputId}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                maxLength={64}
                placeholder="account.testnet"
                className="h-9 text-[13px] text-fg placeholder:text-fg-faint sm:text-[14px] md:text-[14px]"
              />
              <InputGroupAddon align="inline-end" className="gap-3 py-0 pr-0 font-normal text-[length:inherit] has-[>button]:mr-0">
                <span aria-hidden className="hidden text-fg-faint sm:inline">0.5</span>
                <InputGroupButton
                  type="submit"
                  variant="invert"
                  size="sm"
                  className={cn("h-9 gap-2 px-3 text-[12.5px] font-medium active:scale-[0.97]", FOCUS)}
                >
                  Check
                  <Kbd aria-hidden className="h-4 min-w-4 bg-ink-950/10 px-0.5 text-ink-950/70">
                    <CornerDownLeft />
                  </Kbd>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <div className="mt-3 flex flex-wrap gap-2">
              {TRY.map((t) => (
                <Button
                  key={t.account}
                  variant="quiet"
                  size="bare"
                  onClick={() => (setValue(t.account), check(t.account))}
                  className={cn(
                    "max-w-full gap-2 rounded-md border border-line px-2.5 py-1 font-mono text-[11px] hover:border-line-strong hover:bg-transparent",
                    FOCUS,
                  )}
                >
                  <span className="truncate">{t.account}</span>
                  <span className="shrink-0 text-fg-faint">{t.note}</span>
                </Button>
              ))}
            </div>
          </form>

          <Ladder v={verdict} />
        </Reveal>

        <Reveal delay={0.08} className="min-w-0">
          <Frame>
            <FramePanel className="flex items-center justify-between gap-3 px-4 py-3 font-mono text-[10.5px] text-fg-muted">
              <span className="truncate">verdict · {B.contract}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-safe">
                <i aria-hidden className="size-1.5 rounded-full bg-safe" />
                attested
              </span>
            </FramePanel>
            <div aria-hidden className="mx-3 h-[3px] rounded-full bg-ink-950 shadow-[inset_0_1px_2px_rgba(0,0,0,0.9)]" />
          </Frame>
          <div ref={slot} className="relative -mt-[6px] overflow-hidden px-3 pt-[6px] lg:min-h-[640px]" aria-live="polite">
            <motion.div
              key={run}
              initial={{ y: reduce ? 0 : "-104%", opacity: reduce ? 0 : 1 }}
              animate={printed || run > 0 ? { y: 0, opacity: 1 } : undefined}
              transition={{ duration: reduce ? 0.2 : 0.85, ease: EASE_OUT }}
            >
              <Receipt v={verdict} />
            </motion.div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
