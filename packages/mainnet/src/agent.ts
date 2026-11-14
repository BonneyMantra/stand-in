import fs from "node:fs";
import { PublicKey } from "near-api-js";
import { type NetworkConfig } from "@standin/core";
import {
  NEAR, Signer, accountKeyPath, actions, agentFcKeyPath, intentsKeyPath, loadKeyFile, newKeyPair, saveKey, tgas, view, type SentTx,
} from "./chain.ts";

/**
 * The agent's legitimate scoped key: a function-call key on wrap.near limited to the read-only `ft_balance_of`.
 * A function-call key cannot attach a deposit, so it cannot wrap NEAR or move funds; the worst a thief holding it
 * can do is burn the (small) gas allowance. wrap.near is an immutable-style, widely deployed contract, so the
 * receiver is harmless and always present on mainnet.
 */
export const FC_RECEIVER = "wrap.near";
export const FC_METHODS = ["ft_balance_of"];
export const FC_ALLOWANCE = NEAR / 100n; // 0.01 NEAR gas allowance (a cap, not a transfer)

export const ownerSigner = (cfg: NetworkConfig) =>
  Signer.fromFile(cfg, cfg.accounts.agent, accountKeyPath(cfg.accounts.agent));

/** Add (or re-add) the agent's function-call key; reuses the saved key file so the secret stays the same. */
export async function provisionFcKey(cfg: NetworkConfig): Promise<{ public_key: string; tx: SentTx }> {
  const f = agentFcKeyPath();
  const k = fs.existsSync(f) ? loadKeyFile(f) : { account_id: cfg.accounts.agent, ...newKeyPair() };
  saveKey(f, k);
  const tx = await ownerSigner(cfg).send({
    purpose: "gas", receiverId: cfg.accounts.agent, gas: tgas(2), what: "add agent fc key",
    acts: [actions.addFunctionCallAccessKey(PublicKey.from(k.public_key), FC_RECEIVER, FC_METHODS, FC_ALLOWANCE)],
  });
  return { public_key: k.public_key, tx };
}

/** Register the agent's intents key on the real intents.near (add_public_key, 1 yocto, called as the agent account). */
export async function registerIntentsKey(cfg: NetworkConfig): Promise<{ public_key: string; tx: SentTx }> {
  const f = intentsKeyPath();
  const k = fs.existsSync(f) ? loadKeyFile(f) : { account_id: cfg.accounts.agent, ...newKeyPair() };
  saveKey(f, k);
  const tx = await ownerSigner(cfg).functionCall({
    purpose: "intents", receiverId: cfg.accounts.intents, method: "add_public_key", args: { public_key: k.public_key },
    gas: tgas(12), deposit: 1n, what: "intents add_public_key",
  });
  return { public_key: k.public_key, tx };
}

export const intentsHas = async (cfg: NetworkConfig, publicKey: string): Promise<boolean> =>
  Boolean(await view(cfg, cfg.accounts.intents, "has_public_key", { account_id: cfg.accounts.agent, public_key: publicKey }));
export const intentsKeys = async (cfg: NetworkConfig): Promise<string[]> =>
  (await view(cfg, cfg.accounts.intents, "public_keys_of", { account_id: cfg.accounts.agent })) as string[];
