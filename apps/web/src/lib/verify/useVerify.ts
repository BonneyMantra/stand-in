import { useCallback, useEffect, useRef, useState } from "react";
import { CLAIMS, checkClaim, type ClaimCheck } from "./check";
import { recoverPersonalSigner } from "./sig";

export interface SigCheck {
  trip: string;
  at: string;
  model: string;
  claimed: string;
  /** The model's signing address inside the attestation the watcher fetched (null if absent). */
  attested: string | null;
  signedText: string;
  recovered: string | null;
  state: "verified" | "mismatch" | "unreadable";
  why?: string;
}

type SigsState = { status: "loading" } | { status: "ok"; items: SigCheck[] } | { status: "error"; message: string };

type ReportLike = { trip_tx_hash?: string; at?: string; model?: string; proof?: { signed_text?: string; signature?: string; signing_address?: string; attestation?: { model?: { signing_address?: string } } };
};

function checkSig(r: ReportLike): SigCheck {
  const p = r.proof ?? {};
  const base = { trip: r.trip_tx_hash ?? "", at: r.at ?? "", model: r.model ?? "", claimed: p.signing_address ?? "", attested: p.attestation?.model?.signing_address ?? null, signedText: p.signed_text ?? "" };
  if (!p.signed_text || !p.signature || !p.signing_address) return { ...base, recovered: null, state: "unreadable", why: "Report has no signed text, signature or signing address." };
  try {
    const recovered = recoverPersonalSigner(p.signed_text, p.signature);
    const claimed = p.signing_address.toLowerCase();
    if (recovered !== claimed) return { ...base, recovered, state: "mismatch", why: "Recovered address differs from the signing address." };
    if (base.attested && base.attested.toLowerCase() !== claimed) return { ...base, recovered, state: "mismatch", why: "Signing address differs from the attested model address." };
    return { ...base, recovered, state: "verified" };
  } catch (e) {
    return { ...base, recovered: null, state: "unreadable", why: e instanceof Error ? e.message : "Signature could not be parsed." };
  }
}

const CONCURRENCY = 2;

export function useVerify() {
  const [checks, setChecks] = useState<(ClaimCheck | null)[]>(() => CLAIMS.map(() => null));
  const [finishedAt, setFinishedAt] = useState<Date | null>(null);
  const [sigs, setSigs] = useState<SigsState>({ status: "loading" });
  const generation = useRef(0);

  const runAll = useCallback(async () => {
    const gen = ++generation.current;
    setFinishedAt(null);
    setChecks(CLAIMS.map(() => null));
    let next = 0;
    const worker = async () => {
      while (next < CLAIMS.length) {
        const i = next++;
        await checkClaim(CLAIMS[i], (r) => {
          if (generation.current === gen) setChecks((prev) => prev.map((p, j) => (j === i ? r : p)));
        });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (generation.current === gen) setFinishedAt(new Date());
  }, []);

  const runSigs = useCallback(async () => {
    setSigs({ status: "loading" });
    try {
      const res = await fetch("/demo-state.json", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`demo-state.json answered HTTP ${res.status}`);
      const body = (await res.json()) as { incident_reports?: ReportLike[] };
      setSigs({ status: "ok", items: (body.incident_reports ?? []).map(checkSig) });
    } catch (e) {
      setSigs({ status: "error", message: e instanceof Error ? e.message : "Could not load the incident reports." });
    }
  }, []);

  useEffect(() => {
    void runAll();
    void runSigs();
    const g = generation;
    return () => {
      g.current++;
    };
  }, [runAll, runSigs]);

  const rerun = useCallback(() => {
    void runAll();
    void runSigs();
  }, [runAll, runSigs]);

  return { claims: CLAIMS, checks, finishedAt, sigs, rerun };
}
