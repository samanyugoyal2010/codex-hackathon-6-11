// Consensus engine — TypeScript port of model.py.
// De-vig, logarithmic opinion pooling with log-liquidity weights, edges, uncertainty.

import type { SourceRow, ConsensusRow } from "./types";

const EPS = 1e-6;
export const EDGE_THRESHOLD = 0.03;

// Tiny demo-grade alias map for cross-source team name matching.
const TEAM_ALIASES: Record<string, string> = {
  bra: "brazil",
  arg: "argentina",
  fra: "france",
  eng: "england",
  esp: "spain",
  ger: "germany",
  deu: "germany",
  usa: "united states",
  us: "united states",
  "united states of america": "united states",
  ned: "netherlands",
  holland: "netherlands",
  por: "portugal",
  uru: "uruguay",
  bel: "belgium",
};

export function normalizeTeam(name: string): string {
  let key = (name ?? "").trim().toLowerCase();
  if (key.startsWith("yes ")) key = key.slice(4).trim();
  return TEAM_ALIASES[key] ?? key;
}

export function displayName(name: string): string {
  return normalizeTeam(name)
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const clamp = (p: number, lo = EPS, hi = 1 - EPS) => Math.min(Math.max(p, lo), hi);
export const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const reliabilityWeight = (volume: number) => Math.log1p(Math.max(volume || 0, 0));

function devig(probs: Map<string, number>): Map<string, number> {
  let s = 0;
  for (const v of probs.values()) s += v;
  if (s <= 0) return probs;
  const out = new Map<string, number>();
  for (const [k, v] of probs) out.set(k, v / s);
  return out;
}

/** Logarithmic opinion pool: weighted mean of log-odds mapped back to [0,1]. */
function logPool(pairs: Array<[number, number]>): number | null {
  if (pairs.length === 0) return null;
  let totalW = pairs.reduce((a, [, w]) => a + w, 0);
  let eff = pairs;
  if (totalW <= 0) {
    eff = pairs.map(([p]) => [p, 1] as [number, number]);
    totalW = eff.length;
  }
  const z = eff.reduce((a, [p, w]) => a + w * logit(p), 0) / totalW;
  return sigmoid(z);
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

export function consensus(sources: SourceRow[][]): ConsensusRow[] {
  const perSource = new Map<string, Map<string, number>>();
  const perSourceVol = new Map<string, Map<string, number>>();

  for (const rows of sources) {
    if (!rows || rows.length === 0) continue;
    const src = rows[0].source;
    const raw = new Map<string, number>();
    const vol = new Map<string, number>();
    for (const r of rows) {
      const team = normalizeTeam(r.team);
      const v = r.volume || 0;
      if (!raw.has(team) || v > (vol.get(team) ?? 0)) {
        raw.set(team, r.prob);
        vol.set(team, v);
      }
    }
    perSource.set(src, devig(raw));
    perSourceVol.set(src, vol);
  }

  const teams = new Set<string>();
  for (const d of perSource.values()) for (const t of d.keys()) teams.add(t);

  const records: ConsensusRow[] = [];
  for (const team of teams) {
    const pPoly = perSource.get("polymarket")?.get(team) ?? null;
    const pKalshi = perSource.get("kalshi")?.get(team) ?? null;
    const vPoly = perSourceVol.get("polymarket")?.get(team) ?? 0;
    const vKalshi = perSourceVol.get("kalshi")?.get(team) ?? 0;

    const pairs: Array<[number, number]> = [];
    if (pPoly !== null) pairs.push([pPoly, reliabilityWeight(vPoly)]);
    if (pKalshi !== null) pairs.push([pKalshi, reliabilityWeight(vKalshi)]);
    if (pairs.length === 0) continue;

    const cons = logPool(pairs)!;
    const uncertainty = std(pairs.map(([p]) => p));

    records.push({
      team: displayName(team),
      pPoly,
      pKalshi,
      consensus: cons,
      refined: cons,
      uncertainty,
      edgePoly: null,
      edgeKalshi: null,
      volume: (vPoly || 0) + (vKalshi || 0),
    });
  }

  // Re-normalize consensus across teams so it reads as a clean distribution.
  const consSum = records.reduce((a, r) => a + r.consensus, 0);
  if (consSum > 0) for (const r of records) r.consensus /= consSum;

  for (const r of records) {
    r.refined = r.consensus;
    r.edgePoly = r.pPoly === null ? null : r.pPoly - r.consensus;
    r.edgeKalshi = r.pKalshi === null ? null : r.pKalshi - r.consensus;
  }

  records.sort((a, b) => b.consensus - a.consensus);
  return records;
}

export function edgeAlerts(rows: ConsensusRow[], threshold = EDGE_THRESHOLD): string[] {
  const msgs: string[] = [];
  for (const r of rows) {
    for (const [src, edge] of [
      ["Polymarket", r.edgePoly],
      ["Kalshi", r.edgeKalshi],
    ] as const) {
      if (edge === null || Math.abs(edge) <= threshold) continue;
      const direction = edge < 0 ? "underpricing" : "overpricing";
      msgs.push(`${src} ${direction} ${r.team} by ${(Math.abs(edge) * 100).toFixed(1)}%`);
    }
  }
  return msgs;
}
