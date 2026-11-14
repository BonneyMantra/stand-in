import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Recovers the Ethereum address that produced an EIP-191 `personal_sign` signature over `text`.
 * hash = keccak256("\x19Ethereum Signed Message:\n" + len + text); the 65-byte signature is r || s || v.
 */
export function recoverPersonalSigner(text: string, signatureHex: string): string {
  const msg = utf8ToBytes(text);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`);
  const data = new Uint8Array(prefix.length + msg.length);
  data.set(prefix);
  data.set(msg, prefix.length);
  const hash = keccak_256(data);
  const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
  if (sig.length !== 65) throw new Error(`signature is ${sig.length} bytes, expected 65`);
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  const pub = secp256k1.Signature.fromBytes(sig.slice(0, 64), "compact").addRecoveryBit(v).recoverPublicKey(hash).toBytes(false);
  return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
}
