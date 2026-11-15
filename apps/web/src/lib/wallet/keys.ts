import { ed25519 } from "@noble/curves/ed25519.js";
import { base58Encode } from "./guardianCode";

/**
 * NEAR ed25519 keys as strings, the form near-api-js and the CLI's key files use: the public key is
 * `ed25519:` + base58(32 bytes) and the secret key `ed25519:` + base58(seed ‖ public key), 64 bytes.
 */
export interface KeyPairStrings { public_key: string; secret_key: string }

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error("not base58");
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

const strip = (k: string) => {
  if (!k.startsWith("ed25519:")) throw new Error("only ed25519 keys are supported");
  return base58Decode(k.slice("ed25519:".length));
};

/** The 32-byte seed of a NEAR secret key (64-byte seed ‖ public, or a bare 32-byte seed). */
export function seedOf(secretKey: string): Uint8Array {
  const b = strip(secretKey);
  if (b.length !== 64 && b.length !== 32) throw new Error("an ed25519 secret key is 32 or 64 bytes");
  return b.slice(0, 32);
}

export const publicKeyBytes = (publicKey: string): Uint8Array => {
  const b = strip(publicKey);
  if (b.length !== 32) throw new Error("an ed25519 public key is 32 bytes");
  return b;
};

export function publicKeyOf(secretKey: string): string {
  return `ed25519:${base58Encode(ed25519.getPublicKey(seedOf(secretKey)))}`;
}

/** A fresh key pair from the browser's CSPRNG (crypto.getRandomValues, through noble). */
export function generateKeyPair(): KeyPairStrings {
  const { secretKey, publicKey } = ed25519.keygen();
  const full = new Uint8Array(64);
  full.set(secretKey, 0);
  full.set(publicKey, 32);
  return { public_key: `ed25519:${base58Encode(publicKey)}`, secret_key: `ed25519:${base58Encode(full)}` };
}

export const isPublicKey = (k: string) => {
  try { return publicKeyBytes(k).length === 32; } catch { return false; }
};

/** True when `secretKey` is a well-formed ed25519 secret whose public half is `publicKey` (when given). */
export function keyMatches(secretKey: string, publicKey?: string): boolean {
  try {
    const pk = publicKeyOf(secretKey);
    return publicKey === undefined || pk === publicKey;
  } catch {
    return false;
  }
}

export const signEd25519 = (message: Uint8Array, secretKey: string): Uint8Array => ed25519.sign(message, seedOf(secretKey));
