// NEAR MPC (Chain Signatures) helpers: root key view, derived key, signature response parsing.
// Request/response shapes follow near/mpc crates/contract README + src/api/keys.rs (read 2026-11-14).
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { makeProvider, type NetworkConfig } from "@standin/core";

export const MPC_SIGNER_TESTNET = "v1.signer-prod.testnet";
export const DOMAIN_SECP256K1 = 0;
const EPSILON_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error(`bad base58 char ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16);
  const body = n === 0n ? [] : [...hexToBytes(hex.length % 2 ? "0" + hex : hex)];
  const zeros = s.length - s.replace(/^1+/, "").length;
  return Uint8Array.from([...new Array(zeros).fill(0), ...body]);
}

/** "secp256k1:<base58 of 64-byte x||y>" (the MPC contract's key string) -> uncompressed 65-byte point. */
export function parseMpcPublicKey(s: string): Uint8Array {
  const [curve, b58] = s.split(":");
  if (curve !== "secp256k1" || !b58) throw new Error(`unexpected MPC public key format: ${s.slice(0, 20)}`);
  const raw = base58Decode(b58);
  if (raw.length !== 64) throw new Error(`MPC secp256k1 key must be 64 bytes, got ${raw.length}`);
  return Uint8Array.from([4, ...raw]);
}

/** tweak = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:<predecessor>,<path>") */
export function deriveTweak(predecessor: string, path: string): bigint {
  const h = sha3_256(new TextEncoder().encode(`${EPSILON_PREFIX}${predecessor},${path}`));
  return BigInt("0x" + bytesToHex(h));
}

/** derived = root + tweak*G, computed locally from the root public key. Returns 65-byte uncompressed. */
export function deriveKeyLocal(rootUncompressed: Uint8Array, predecessor: string, path: string): Uint8Array {
  const root = secp256k1.Point.fromBytes(rootUncompressed);
  const tweak = deriveTweak(predecessor, path);
  return root.add(secp256k1.Point.BASE.multiply(tweak)).toBytes(false);
}

export async function fetchRootKey(cfg: NetworkConfig, signer = MPC_SIGNER_TESTNET): Promise<{ raw: string; point: Uint8Array }> {
  const raw = (await makeProvider(cfg).callFunction({ contractId: signer, method: "public_key", args: { domain_id: DOMAIN_SECP256K1 } } as any)) as string;
  return { raw, point: parseMpcPublicKey(raw) };
}

/** The contract's own view of the derived key, used only to cross-check the local derivation. */
export async function fetchDerivedKey(cfg: NetworkConfig, predecessor: string, path: string, signer = MPC_SIGNER_TESTNET): Promise<Uint8Array> {
  const raw = (await makeProvider(cfg).callFunction({ contractId: signer, method: "derived_public_key", args: { path, predecessor, domain_id: DOMAIN_SECP256K1 } } as any)) as string;
  return parseMpcPublicKey(raw);
}

export interface MpcSignature { bigR: Uint8Array; r: bigint; s: bigint; recoveryId: number }

/** Parse the MPC response `{scheme:"Secp256k1", big_r:{affine_point}, s:{scalar}, recovery_id}`. */
export function parseSignature(v: any): MpcSignature {
  const resp = v?.Secp256k1 ?? v;
  const aff = resp?.big_r?.affine_point ?? resp?.big_r;
  const sc = resp?.s?.scalar ?? resp?.s;
  if (typeof aff !== "string" || typeof sc !== "string" || typeof resp?.recovery_id !== "number") {
    throw new Error(`unexpected MPC signature shape: ${JSON.stringify(v).slice(0, 200)}`);
  }
  const bigR = hexToBytes(aff);
  return { bigR, r: BigInt("0x" + bytesToHex(bigR.slice(1, 33))), s: BigInt("0x" + sc), recoveryId: resp.recovery_id };
}

/** Recover the signer's uncompressed public key (65 bytes) for a 32-byte message hash. */
export function recoverKey(sig: MpcSignature, hash: Uint8Array): Uint8Array {
  return new secp256k1.Signature(sig.r, sig.s, sig.recoveryId).recoverPublicKey(hash).toBytes(false);
}
