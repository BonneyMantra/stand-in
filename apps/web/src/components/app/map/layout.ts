import type { StandinState } from "@/data/types";
import { sessionLabel, statusMap, type DecoyStatus } from "@/data/derive";

export const W = 1000;
export const H = 440;
export const AGENT = { x: 812, y: 250 };
export const ATTACKER = { x: 948, y: 92 };

export interface MapNode {
  pk: string;
  x: number;
  y: number;
  kind: string;
  status: DecoyStatus;
  path: string;
  agent: string;
  group: string;
}

export interface MapCluster {
  id: string;
  label: string;
  agent: string;
  x: number;
  y: number;
  status: DecoyStatus;
  nodes: MapNode[];
}

/** Deterministic 0..1 hash so the map is stable between renders and reloads. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const KIND_ANGLE: Record<string, number> = { "near-credentials": -90, dotenv: 30, "session-env": 150, "shell-history": 210 };
const RANK: Record<DecoyStatus, number> = { dormant: 0, exposed: 1, tripped: 2 };

/** Groups decoys by session (or by adopt location) into clusters laid out on a jittered grid. */
export function layoutClusters(s: StandinState): MapCluster[] {
  const status = statusMap(s);
  const groups = new Map<string, typeof s.decoy.keys>();
  for (const k of s.decoy.keys) {
    const g = k.planted.session_id || `adopt:${k.planted.cwd}`;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  const ids = [...groups.keys()];
  const n = ids.length;
  if (!n) return [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 2.2)));
  const rows = Math.ceil(n / cols);
  const x0 = 70, x1 = 690, y0 = 70, y1 = 380;
  const cw = cols > 1 ? (x1 - x0) / (cols - 1) : 0;
  const rh = rows > 1 ? (y1 - y0) / (rows - 1) : 0;

  return ids.map((id, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const jx = (hash01(id) - 0.5) * cw * 0.45;
    const jy = (hash01(id + "y") - 0.5) * rh * 0.5;
    const x = (cols > 1 ? x0 + c * cw : (x0 + x1) / 2) + jx + (r % 2 ? cw * 0.25 : 0);
    const y = (rows > 1 ? y0 + r * rh : (y0 + y1) / 2) + jy;
    const keys = groups.get(id) ?? [];
    const used = new Map<number, number>();
    const nodes: MapNode[] = keys.map((k, j) => {
      let a = KIND_ANGLE[k.planted.kind] ?? j * 90;
      const dup = used.get(a) ?? 0;
      used.set(a, dup + 1);
      a += dup * 24;
      const rad = (a * Math.PI) / 180;
      return {
        pk: k.public_key, kind: k.planted.kind, path: k.planted.path, agent: k.planted.agent, group: id,
        x: x + Math.cos(rad) * 17, y: y + Math.sin(rad) * 17,
        status: status.get(k.public_key) ?? "dormant",
      };
    });
    const worst = nodes.reduce<DecoyStatus>((w, nd) => (RANK[nd.status] > RANK[w] ? nd.status : w), "dormant");
    const isAdopt = id.startsWith("adopt:");
    return {
      id, x, y, nodes, status: worst,
      agent: keys[0]?.planted.agent ?? "manual",
      label: isAdopt ? "standin adopt" : sessionLabel(s, id),
    };
  });
}

/** Dotted terrain (the Edge dashboard's halftone map, minus fake geography): value noise
 *  thresholded into two density bands, returned as two compact SVG paths. */
export function dotField(step = 9): { dense: string; sparse: string } {
  const g = 7;
  const grid: number[] = [];
  for (let i = 0; i < (g + 1) * (g + 1); i++) grid.push(hash01(`n${i}`));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
  const noise = (u: number, v: number) => {
    const x = u * g, y = v * g;
    const xi = Math.min(g - 1, Math.floor(x)), yi = Math.min(g - 1, Math.floor(y));
    const tx = x - xi, ty = y - yi;
    const at = (a: number, b: number) => grid[b * (g + 1) + a];
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), tx), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), tx), ty);
  };
  let dense = "", sparse = "";
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      const v = noise(x / W, y / H) * 0.75 + hash01(`${x},${y}`) * 0.25;
      const d = `M${x.toFixed(1)} ${y.toFixed(1)}h1.6v1.6h-1.6z`;
      if (v > 0.6) dense += d;
      else if (v > 0.42) sparse += d;
    }
  }
  return { dense, sparse };
}

/** Curved arc between two points, bowing upward like a flight path. */
export function arc(a: { x: number; y: number }, b: { x: number; y: number }, bow = 0.22): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const cx = mx + (dy / (len || 1)) * len * bow * -1;
  const cy = my - Math.abs(dx / (len || 1)) * len * bow;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
