import { useMemo } from "react";
import { encode } from "uqr";
import { Smartphone } from "lucide-react";
import { SourceLink } from "@/components/landing/primitives";

/** QR code drawn client-side (uqr) as one SVG path: dark modules on a light tile so every scanner reads it. */
function Qr({ value, label }: { value: string; label: string }) {
  const { d, size } = useMemo(() => {
    const { data, size: n } = encode(value, { ecc: "M", border: 2 });
    let path = "";
    data.forEach((row, y) => row.forEach((on, x) => {
      if (on) path += `M${x} ${y}h1v1h-1z`;
    }));
    return { d: path, size: n };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="block size-full">
      <rect width={size} height={size} fill="#ededf0" />
      <path d={d} fill="#08080a" />
    </svg>
  );
}

export function PhoneCard({ topic }: { topic: string }) {
  const url = `https://ntfy.sh/${topic}`;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="mx-auto w-[176px] shrink-0 overflow-hidden rounded-lg border border-line-strong p-1.5">
        <div className="overflow-hidden rounded-[5px]">
          <Qr value={url} label={`QR code for ${url}`} />
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
          <Smartphone aria-hidden className="size-4 text-fg-muted" />
          Scan to get the push on your phone when you run it
        </p>
        <p className="text-[13px] leading-relaxed text-fg-muted">
          Opens the lab's public ntfy topic. Subscribe in the ntfy app or keep the page open; the notify step posts there.
        </p>
        <SourceLink href={url} className="[overflow-wrap:anywhere]">
          ntfy.sh/{topic}
        </SourceLink>
      </div>
    </div>
  );
}
