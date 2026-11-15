import { Link, NavLink, useLocation } from "react-router";
import { Activity, Ban, FlaskConical, Gauge, History, KeyRound, Play, ShieldCheck, Snowflake, TerminalSquare, Wallet, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { useStandin } from "@/data/useStandin";
import { useMyAccount } from "@/data/useMyAccount";
import { yoctoToNear } from "@/data/derive";
import { Logo } from "./Logo";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

/** The signed-in owner's own account, read from chain. */
const MINE: NavItem[] = [
  { to: "/app", label: "My account", icon: Gauge, end: true },
  { to: "/app/trips", label: "Trips and freezes", icon: Zap },
  { to: "/app/decoys", label: "Decoys", icon: KeyRound },
  { to: "/app/owner", label: "Owner console", icon: Wallet },
];

/** The recorded testnet run on the project's accounts: an example, not the visitor's data. */
const EXAMPLE: NavItem[] = [
  { to: "/app/example", label: "Overview", icon: History, end: true },
  { to: "/app/example/trips", label: "Trips", icon: Zap },
  { to: "/app/example/decoys", label: "Decoys", icon: KeyRound },
  { to: "/app/example/sessions", label: "Sessions", icon: TerminalSquare },
  { to: "/app/example/blocklist", label: "Blocklist", icon: Ban },
];

/** The project's own measurements and the public pages that run against testnet right now. */
const PROJECT: NavItem[] = [
  { to: "/app/bench", label: "Benchmark", icon: FlaskConical },
  { to: "/lab", label: "Leak a decoy (lab)", icon: Play },
  { to: "/verify", label: "Verify claims on chain", icon: ShieldCheck },
];

export function AppSidebar() {
  const { data } = useStandin();
  const { snapshot, home } = useMyAccount();
  const { pathname } = useLocation();
  const example = pathname.startsWith("/app/example");
  const mine: Record<string, number | undefined> = snapshot
    ? { "/app/trips": snapshot.guardians.reduce((n, g) => n + g.state.freeze_log.length, 0), "/app/decoys": snapshot.bait.keys.filter((k) => k.public_key !== home?.bait.public_key).length }
    : {};
  const recorded: Record<string, number | undefined> = data
    ? { "/app/example/trips": data.trips.length, "/app/example/decoys": data.decoy.keys.length, "/app/example/sessions": data.sessions.length, "/app/example/blocklist": data.blocklist.length }
    : {};

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-line">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <Link
          to="/"
          aria-label="Stand-in home"
          className="flex items-center gap-2.5 rounded-lg px-1 py-1 outline-none hover:bg-ink-850 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold text-fg">Stand-in</p>
            <p className="truncate text-[11px] text-fg-faint">decoy keys for coding agents</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1">
        <NavGroup label="Your account" items={MINE} pathname={pathname} counts={mine} hotKey="/app/trips" />
        <NavGroup label="Example · recorded run" items={EXAMPLE} pathname={pathname} counts={recorded} hotKey="/app/example/trips" muted={!example} />
        <NavGroup label="Project" items={PROJECT} pathname={pathname} counts={{}} />
      </SidebarContent>

      <SidebarFooter className="gap-2 p-3">
        <div className="flex items-center justify-between px-1 text-[11px] text-fg-faint">
          <span className="inline-flex items-center gap-1.5"><Activity className="size-3" aria-hidden />network</span>
          <span className="rounded border border-decoy/30 bg-decoy/10 px-1.5 py-0.5 font-mono text-decoy">testnet</span>
        </div>
        {example ? <AgentCard recorded /> : <OwnCard />}
      </SidebarFooter>
    </Sidebar>
  );
}

function NavGroup({ label, items, pathname, counts, hotKey, muted }: {
  label: string; items: NavItem[]; pathname: string; counts: Record<string, number | undefined>; hotKey?: string; muted?: boolean;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[11px] text-fg-faint">{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((n) => {
            const internal = n.to.startsWith("/app");
            const active = internal && (n.end ? pathname === n.to || pathname === `${n.to}/` : pathname.startsWith(n.to));
            const c = counts[n.to];
            const hot = n.to === hotKey && (c ?? 0) > 0;
            return (
              <SidebarMenuItem key={n.to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  className={cn(
                    "h-8 text-[13px] hover:bg-ink-850 hover:text-fg",
                    muted ? "text-fg-faint" : "text-fg-muted",
                    "data-[active=true]:border data-[active=true]:border-line-strong data-[active=true]:bg-ink-850 data-[active=true]:text-fg",
                  )}
                >
                  <NavLink to={n.to} end={n.end} onClick={() => setOpenMobile(false)}>
                    <n.icon className={cn("size-4", active ? "opacity-100" : "opacity-60")} aria-hidden />
                    <span>{n.label}</span>
                  </NavLink>
                </SidebarMenuButton>
                {c !== undefined && (
                  <SidebarMenuBadge className={cn("font-mono text-[11px]", hot ? "text-trip" : "text-fg-faint")}>
                    {hot && <span className="mr-1.5 size-1.5 rounded-full bg-trip" aria-hidden />}
                    {c}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** The connected owner's guardians at a glance, or the invitation to connect. */
function OwnCard() {
  const { read, owner, snapshot, home } = useMyAccount();
  if (read.status === "restoring") return <div className="h-[92px] animate-pulse rounded-lg border border-line bg-ink-900" aria-hidden />;
  if (!owner) {
    return (
      <Link to="/app" className="block rounded-lg border border-line bg-ink-900 p-3 outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-[11px] text-fg-faint">your account</span>
        <p className="mt-1 text-xs text-fg">No wallet connected</p>
        <p className="mt-1 text-[11px] text-fg-muted">Connect to see your guardians, keys and decoys.</p>
      </Link>
    );
  }
  const gs = snapshot?.guardians ?? [];
  const frozen = gs.filter((g) => g.state.frozen).length;
  const decoys = snapshot ? snapshot.bait.keys.filter((k) => k.public_key !== home?.bait.public_key).length : 0;
  return (
    <div className={cn("rounded-lg border p-3", frozen ? "border-trip/40 bg-trip-soft" : "border-line bg-ink-900")} data-testid="own-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-faint">your account</span>
        {snapshot && (
          <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px]", frozen ? "text-trip" : gs.length ? "text-safe" : "text-fg-faint")}>
            {frozen ? <Snowflake className="size-3" aria-hidden /> : gs.length ? <span className="size-1.5 rounded-full bg-safe" aria-hidden /> : null}
            {frozen ? "frozen" : gs.length ? "guarded" : "not guarded"}
          </span>
        )}
      </div>
      <p className="mt-1 truncate font-mono text-xs text-fg" title={owner}>{owner}</p>
      <p className="mt-2 text-[11px] text-fg-muted">
        {snapshot ? `${gs.length} guardian${gs.length === 1 ? "" : "s"} · ${decoys} decoy${decoys === 1 ? "" : "s"}` : "reading testnet…"}
      </p>
    </div>
  );
}

function AgentCard({ recorded }: { recorded: boolean }) {
  const { data } = useStandin();
  if (!data) return <div className="h-[92px] animate-pulse rounded-lg border border-line bg-ink-900" aria-hidden />;
  const frozen = data.agent.frozen;
  const live = data.agent.agent_keys.length + data.agent.intents_keys.length;
  return (
    <div className={cn("rounded-lg border p-3", frozen ? "border-trip/40 bg-trip-soft" : "border-line bg-ink-900")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-faint">{recorded ? "recorded run · agent" : "agent account"}</span>
        <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px]", frozen ? "text-trip" : "text-safe")}>
          {frozen ? <Snowflake className="size-3" aria-hidden /> : <span className="size-1.5 animate-pulse rounded-full bg-safe" aria-hidden />}
          {frozen ? "frozen" : "active"}
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-fg">{data.agent.account_id}</p>
      <p className="mt-2 text-[11px] text-fg-muted">
        {live} live key{live === 1 ? "" : "s"} · decoy bait {yoctoToNear(data.decoy.balance_yocto)} NEAR
      </p>
    </div>
  );
}
