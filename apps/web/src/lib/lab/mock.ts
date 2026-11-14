// DEV-ONLY mock of the hosted lab API. Imported dynamically from api.ts behind `import.meta.env.DEV`
// and only when the local API answers 404, so neither this file nor mock-run.json reaches a production
// bundle. It replays a real stored run from the hosted lab (run 8f27c681, 14 Nov 2026) with its real
// txs and blocks, at its recorded pace. The failed notify's ntfy payload is re-pointed at an unused
// dev topic so that local testing of the browser relay never pushes to the public lab topic.
import recorded from "./mock-run.json";
import type { LabConfig, LabEvent, RunRecord, StepEvent } from "./types";

const RUN = recorded as RunRecord;
const STEPS = RUN.steps as StepEvent[];

export type MockScenario = "ok" | "busy" | "429" | "drop" | "network";

/** `?lab_mock=busy|429|drop|network` exercises the error states locally. */
export function mockScenario(): MockScenario {
  const v = new URLSearchParams(window.location.search).get("lab_mock");
  return v === "busy" || v === "429" || v === "drop" || v === "network" ? v : "ok";
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (window.clearTimeout(t), resolve()), { once: true });
  });

export async function replayMockRun(onEvent: (e: LabEvent) => void, signal: AbortSignal): Promise<"done" | "dropped"> {
  const runId = `mock-${Date.now().toString(36)}`;
  const drop = mockScenario() === "drop";
  const t0 = Date.now();
  const r0 = Date.parse(STEPS[0].at);
  let prev = r0;
  for (const s of STEPS) {
    const at = Date.parse(s.at);
    // Recorded pace, with a floor so instant transitions still read as steps.
    await wait(Math.max(350, at - prev), signal);
    prev = at;
    if (signal.aborted) return "dropped";
    if (drop && s.step === "freeze") return "dropped";
    onEvent({ type: "step", data: { ...s, run_id: runId, at: new Date(t0 + (at - r0)).toISOString() } });
  }
  await wait(400, signal);
  onEvent({ type: "done", data: { run_id: runId, blocks_to_freeze: RUN.blocks_to_freeze } });
  return "done";
}

export function mockRuns(): { runs: RunRecord[] } {
  return { runs: [RUN] };
}

export function mockConfig(): LabConfig {
  return {
    network: "testnet",
    accounts: {
      agent: "lab-agent.si-project-5289.testnet",
      decoy: "lab-decoy.si-project-5289.testnet",
      thief: "lab-thief.si-project-5289.testnet",
    },
    ntfy_topic: "standin-lab-09d9a8",
    explorer: "https://testnet.nearblocks.io",
  };
}
