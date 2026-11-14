import { describe, expect, it } from "vitest";
import { requireFingerprint } from "../src/index.ts";

describe("requireFingerprint", () => {
  it("passes only on exit 0 when biometrics are available", async () => {
    const mk = (code: number) => requireFingerprint("Unfreeze x", { availability: () => "available", run: async () => code });
    expect(await mk(0)).toBe(true);
    expect(await mk(1)).toBe(false);
    expect(await mk(2)).toBe(false);
  });
  it("falls back to an explicit typed word, never a silent pass", async () => {
    const un = (typed: string) => requireFingerprint("Unfreeze x", { availability: () => "unavailable", confirm: async () => typed });
    expect(await un("approve")).toBe(true);
    expect(await un("")).toBe(false);
    expect(await un("yes")).toBe(false);
  });
  it("times out", async () => {
    expect(await requireFingerprint("x", { availability: () => "unavailable", confirm: () => new Promise(() => {}), timeoutMs: 30 })).toBe(false);
  });
});
