import { expect, it } from "vitest";
import { generateKey, loadNetworkConfig } from "@standin/core";
import { FastSender } from "../src/fastsend.ts";

const rate429 = () => Promise.reject(Object.assign(new Error('{"code":-429,"message":"Rate limits exceeded"}'), { cause: 429 }));
const hash = "11111111111111111111111111111111";
const limited = () => ({ viewAccessKey: rate429, viewBlock: rate429 });
const healthy = () => ({ viewAccessKey: () => Promise.resolve({ nonce: 7 }), viewBlock: () => Promise.resolve({ header: { hash } }) });

/** A sender whose provider rotation hands out the given stubs in order: no attempt reaches the network. */
function sender(...providers: (() => object)[]) {
  let i = 0;
  const made: object[] = [];
  const next = () => { const p = providers[Math.min(i++, providers.length - 1)](); made.push(p); return p as any; };
  const s = new FastSender(loadNetworkConfig(), "si-watch-0.testnet", generateKey().secret_key, next);
  return { s, made };
}

it("warm() does not throw on a 429: it backs off, rotates the provider and reports false", async () => {
  const { s, made } = sender(limited, limited, limited);
  await expect(s.warm(2, 1)).resolves.toBe(false);
  expect(made).toHaveLength(3); // the initial provider plus one rotation per failed attempt
  expect((s as any).provider).toBe(made[2]);
});

it("warm() recovers once a rotated endpoint answers and caches nonce and block hash", async () => {
  const { s } = sender(limited, healthy);
  expect(await s.warm(2, 1)).toBe(true);
  expect((s as any).nonce).toBe(7n);
  expect((s as any).blockHash).not.toBeNull();
});
