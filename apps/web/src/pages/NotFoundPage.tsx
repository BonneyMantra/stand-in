import { Link, useLocation } from "react-router";
import { FileQuestion } from "lucide-react";
import { PageHead, PublicShell } from "@/components/public/PublicShell";
import { AccentLink, lineBtn } from "@/components/landing/cta";
import { EmptyState } from "@/components/app/common";

const PLACES = [
  { to: "/lab", label: "Leak a decoy in the lab" },
  { to: "/verify", label: "Check every claim on chain" },
  { to: "/app", label: "Open the dashboard" },
];

/** Any path outside the routes: the public shell, the path that missed, and the three places worth going. */
export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <PublicShell title="Page not found · Stand-in">
      <PageHead eyebrow="404 · no such page" title="Nothing lives here." muted="The decoys are elsewhere." dot="decoy">
        <p>
          <span className="font-mono text-[13px] text-fg [overflow-wrap:anywhere]">{pathname}</span> is not a page on this site.
        </p>
      </PageHead>
      <div className="mt-8 flex flex-wrap gap-3">
        <AccentLink to="/">Back to the start</AccentLink>
        {PLACES.map((p) => (
          <Link key={p.to} to={p.to} className={lineBtn}>
            {p.label}
          </Link>
        ))}
      </div>
    </PublicShell>
  );
}

/** Unknown /app/* paths: a not-found state inside the dashboard shell instead of a silent redirect. */
export function AppNotFound() {
  const { pathname } = useLocation();
  return (
    <div className="mt-10 rounded-[10px] border border-line bg-ink-900">
      <EmptyState icon={FileQuestion} title="No such dashboard page">
        <p>
          <span className="font-mono text-fg [overflow-wrap:anywhere]">{pathname}</span> is not part of the dashboard.
        </p>
        <Link to="/app" className="mt-3 inline-block text-fg underline underline-offset-4">
          Back to the overview
        </Link>
      </EmptyState>
    </div>
  );
}
