import { NavLink, useLocation } from "react-router";
import { Activity, Ban, FlaskConical, Gauge, KeyRound, Snowflake, TerminalSquare, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { useStandin } from "@/data/useStandin";
import { yoctoToNear } from "@/data/derive";
import { Logo } from "./Logo";

const NAV = [
  { to: "/app", label: "Overview", icon: Gauge, end: true },
  { to: "/app/trips", label: "Trips", icon: Zap },
  { to: "/app/decoys", label: "Decoys", icon: KeyRound },
  { to: "/app/sessions", label: "Sessions", icon: TerminalSquare },
  { to: "/app/blocklist", label: "Blocklist", icon: Ban },
  { to: "/app/bench", label: "Benchmark", icon: FlaskConical },
] as const;

export function AppSidebar() {
  const { data } = useStandin();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const counts: Record<string, number | undefined> = data
    ? { "/app/trips": data.trips.length, "/app/decoys": data.decoy.keys.length, "/app/sessions": data.sessions.length, "/app/blocklist": data.blocklist.length }
    : {};

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-line">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <div className="flex items-center gap-2.5 rounded-lg px-1 py-1">
          <Logo />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-semibold text-fg">Stand-in</p>
            <p className="truncate text-[11px] text-fg-faint">decoy keys for coding agents</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] text-fg-faint">Guard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => {
                const active = "end" in n ? pathname === n.to || pathname === `${n.to}/` : pathname.startsWith(n.to);
                const c = counts[n.to];
                const hot = n.to === "/app/trips" && (c ?? 0) > 0;
                return (
                  <SidebarMenuItem key={n.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      className={cn(
                        "h-8 text-[13px] text-fg-muted hover:bg-ink-850 hover:text-fg",
                        "data-[active=true]:border data-[active=true]:border-line-strong data-[active=true]:bg-ink-850 data-[active=true]:text-fg",
                      )}
                    >
                      <NavLink to={n.to} end={"end" in n} onClick={() => setOpenMobile(false)}>
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

        {data && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] text-fg-faint">Accounts</SidebarGroupLabel>
            <SidebarGroupContent className="space-y-1 px-2 font-mono text-[11px] text-fg-muted">
              <p className="flex items-center gap-2 truncate"><span className="size-1.5 rounded-full bg-fg-muted" aria-hidden />{data.agent.account_id}</p>
              <p className="flex items-center gap-2 truncate"><span className="size-1.5 rounded-full bg-decoy" aria-hidden />{data.decoy.account_id}</p>
              {data.trips[0] && (
                <p className="flex items-center gap-2 truncate"><span className="size-1.5 rounded-full bg-trip" aria-hidden />{data.trips[0].attacker_account}</p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-2 p-3">
        <div className="flex items-center justify-between px-1 text-[11px] text-fg-faint">
          <span className="inline-flex items-center gap-1.5"><Activity className="size-3" aria-hidden />network</span>
          <span className="rounded border border-decoy/30 bg-decoy/10 px-1.5 py-0.5 font-mono text-decoy">{data?.network ?? "testnet"}</span>
        </div>
        <AgentCard />
      </SidebarFooter>
    </Sidebar>
  );
}

function AgentCard() {
  const { data } = useStandin();
  if (!data) return <div className="h-[92px] animate-pulse rounded-lg border border-line bg-ink-900" aria-hidden />;
  const frozen = data.agent.frozen;
  const live = data.agent.agent_keys.length + data.agent.intents_keys.length;
  return (
    <div className={cn("rounded-lg border p-3", frozen ? "border-trip/40 bg-trip-soft" : "border-line bg-ink-900")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-faint">agent account</span>
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
