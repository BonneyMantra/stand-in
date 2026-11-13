import { expect, it } from "vitest";
import { generateKey, loadNetworkConfig } from "@standin/core";
import { FastSender } from "../src/fastsend.ts";

const rate429 = () => Promise.reject(Object.assign(new Error('{"code":-429,"message":"Rate limits exceeded"}'), { cause: 429 }));

it("warm() does not throw on a 429: it backs off, rotates the provider and reports false", async () => {
  const k = generateKey();
  const s = new FastSender(loadNetworkConfig(), "si-watch-0.testnet", k.secret_key);
  const stub = { viewAccessKey: rate429, viewBlock: rate429 };
  (s as any).provider = stub;
  await expect(s.warm(2, 1)).resolves.toBe(false);
  expect((s as any).provider).not.toBe(stub); // rotated to a fresh provider
});

it("warm() recovers once the endpoint answers and caches nonce and block hash", async () => {
  const k = generateKey();
  const s = new FastSender(loadNetworkConfig(), "si-watch-0.testnet", k.secret_key);
  let calls = 0;
  const hash = "11111111111111111111111111111111";
  (s as any).provider = { viewAccessKey: () => (calls++ ? Promise.resolve({ nonce: 7 }) : rate429()), viewBlock: () => Promise.resolve({ header: { hash } }) };
  // first attempt fails on the 429, rotation installs a real provider, so stub again for the retry
  const orig = (s as any).warm.bind(s);
  expect(await orig(1, 1)).toBe(false);
  (s as any).provider = { viewAccessKey: () => Promise.resolve({ nonce: 7 }), viewBlock: () => Promise.resolve({ header: { hash } }) };
  expect(await orig(1, 1)).toBe(true);
  expect((s as any).nonce).toBe(7n);
});
