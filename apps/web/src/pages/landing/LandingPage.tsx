import { useEffect } from "react";
import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { Problem } from "@/components/landing/problem";
import { LogoRow } from "@/components/landing/logos";
import { Statement } from "@/components/landing/statement";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Attribution } from "@/components/landing/attribution";
import { Registries } from "@/components/landing/registries";
import { ChainSignatures } from "@/components/landing/chain-signatures";
import { Blocklist } from "@/components/landing/blocklist";
import { Benchmark } from "@/components/landing/benchmark";
import { Agents } from "@/components/landing/agents";
import { Footer } from "@/components/landing/footer";

export default function LandingPage() {
  useEffect(() => {
    document.title = "Stand-in · Decoy NEAR keys for AI coding agents";
  }, []);

  return (
    <div className="min-h-svh overflow-x-clip bg-ink-950 text-fg">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-fg px-3 py-2 text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <LogoRow />
        <Problem />
        <Statement />
        <HowItWorks />
        <Attribution />
        <Registries />
        <ChainSignatures />
        <Blocklist />
        <Benchmark />
        <Agents />
      </main>
      <Footer />
    </div>
  );
}
