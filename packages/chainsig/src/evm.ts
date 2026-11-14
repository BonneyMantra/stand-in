// Minimal EIP-1559 (type 2) transaction building for Ethereum Sepolia / Base Sepolia. Testnets only.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export const CHAINS = {
  sepolia: { name: "Ethereum Sepolia", chainId: 11155111, rpc: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"] },
  "base-sepolia": { name: "Base Sepolia", chainId: 84532, rpc: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"] },
} as const;
export type ChainKey = keyof typeof CHAINS;

const cat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]));
export const hex = (b: Uint8Array) => "0x" + bytesToHex(b);
export function fromHex(h: string): Uint8Array {
  let s = h.replace(/^0x/, "");
  if (s.length % 2) s = "0" + s;
  return hexToBytes(s);
}

/** Ethereum address = last 20 bytes of keccak256(x||y) of the uncompressed key. */
export function addressOf(uncompressed: Uint8Array): string {
  return hex(keccak_256(uncompressed.slice(1)).slice(12));
}

function lenPrefix(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const l = fromHex(len.toString(16));
  return cat(Uint8Array.of(offset + 55 + l.length), l);
}
export type Rlp = Uint8Array | Rlp[];
export function rlp(x: Rlp): Uint8Array {
  if (x instanceof Uint8Array) return x.length === 1 && x[0] < 0x80 ? x : cat(lenPrefix(x.length, 0x80), x);
  const body = cat(...x.map(rlp));
  return cat(lenPrefix(body.length, 0xc0), body);
}
const num = (n: bigint | number): Uint8Array => (BigInt(n) === 0n ? new Uint8Array() : fromHex(BigInt(n).toString(16)));

export interface Tx1559 {
  chainId: number; nonce: number; maxPriorityFeePerGas: bigint; maxFeePerGas: bigint;
  gasLimit: number; to: string; value: bigint; data: string;
}
const fields = (t: Tx1559): Rlp[] => [
  num(t.chainId), num(t.nonce), num(t.maxPriorityFeePerGas), num(t.maxFeePerGas), num(t.gasLimit),
  fromHex(t.to), num(t.value), fromHex(t.data), [],
];

/** keccak256(0x02 || rlp(fields)): the 32-byte payload the MPC signs. */
export function signingHash(t: Tx1559): Uint8Array {
  return keccak_256(cat(Uint8Array.of(2), rlp(fields(t))));
}
/** Raw signed tx hex: 0x02 || rlp(fields, yParity, r, s). */
export function serializeSigned(t: Tx1559, yParity: number, r: bigint, s: bigint): string {
  return hex(cat(Uint8Array.of(2), rlp([...fields(t), num(yParity), num(r), num(s)])));
}
export const txHashOf = (rawHex: string) => hex(keccak_256(fromHex(rawHex)));

export async function rpc(chain: ChainKey, method: string, params: unknown[] = []): Promise<any> {
  let last: unknown;
  for (const url of CHAINS[chain].rpc) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      const j: any = await r.json();
      if (j.error) throw new Error(`${method}: ${j.error.message}`);
      return j.result;
    } catch (e) { last = e; }
  }
  throw new Error(`all ${chain} RPCs failed for ${method}: ${String(last)}`);
}

export async function buildTx(chain: ChainKey, from: string, to: string, valueWei: bigint): Promise<Tx1559> {
  const [nonce, block, tip] = await Promise.all([rpc(chain, "eth_getTransactionCount", [from, "pending"]), rpc(chain, "eth_getBlockByNumber", ["latest", false]), rpc(chain, "eth_maxPriorityFeePerGas")]);
  const base = BigInt(block.baseFeePerGas ?? "0x0");
  const priority = BigInt(tip);
  return { chainId: CHAINS[chain].chainId, nonce: Number(nonce), maxPriorityFeePerGas: priority, maxFeePerGas: base * 2n + priority, gasLimit: 21000, to, value: valueWei, data: "0x" };
}
