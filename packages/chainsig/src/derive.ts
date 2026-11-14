import type { NetworkConfig } from "@standin/core";
import { addressOf } from "./evm.ts";
import { deriveKeyLocal, fetchDerivedKey, fetchRootKey } from "./mpc.ts";

export const PATH = "standin-evm-1";

/** Derive locally from the MPC root key, then require it to equal the contract's own derived_public_key view. */
export async function deriveAddress(cfg: NetworkConfig, predecessor: string, path = PATH) {
  const root = await fetchRootKey(cfg);
  const local = deriveKeyLocal(root.point, predecessor, path);
  const viewKey = await fetchDerivedKey(cfg, predecessor, path);
  const matchesView = Buffer.from(local).equals(Buffer.from(viewKey));
  if (!matchesView) throw new Error("local derivation does not match the MPC contract's derived_public_key view; refusing to continue");
  return { rootRaw: root.raw, publicKey: local, address: addressOf(local), matchesView };
}
