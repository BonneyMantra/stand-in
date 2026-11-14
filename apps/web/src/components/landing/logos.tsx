import { Reveal } from "./primitives";

/*
 * What Stand-in runs on and hooks into. Marks are simple-icons SVGs (public/logos, CC0), drawn
 * through a CSS mask so they take the text colour. NEAR Intents, Chain Signatures and NEAR AI Cloud
 * have no mark of their own, so they carry NEAR's with their name. OutLayer publishes no SVG mark,
 * so its tile is the name alone: no invented logos.
 */
const TILES: { name: string; logo?: string }[] = [
  { name: "NEAR Protocol", logo: "near" },
  { name: "NEAR Intents", logo: "near" },
  { name: "Chain Signatures", logo: "near" },
  { name: "NEAR AI Cloud", logo: "near" },
  { name: "Claude Code", logo: "claude" },
  { name: "Codex", logo: "openai" },
  { name: "OutLayer TEE" },
  { name: "ntfy", logo: "ntfy" },
];

function Mark({ logo }: { logo: string }) {
  const url = `url(/logos/${logo}.svg)`;
  return (
    <span
      aria-hidden
      className="size-[18px] shrink-0 bg-current"
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" }}
    />
  );
}

export function LogoRow() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 md:py-24 lg:px-10">
      <Reveal className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)] lg:gap-16">
        <p className="max-w-[420px] text-[22px] leading-[1.3] font-medium tracking-[-0.01em] text-balance text-fg sm:text-[26px]">
          Hooks in Claude Code and Codex. Freezes on NEAR. Verdicts from an OutLayer TEE.
        </p>
        <ul aria-label="Works with" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {TILES.map((t) => (
            <li
              key={t.name}
              className="flex h-[72px] items-center justify-center gap-2.5 rounded-[6px] bg-ink-900 px-3 text-[13px] font-medium tracking-tight text-fg-muted transition-colors duration-200 hover:bg-ink-850 hover:text-fg"
            >
              {t.logo ? <Mark logo={t.logo} /> : null}
              <span className="truncate">{t.name}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
