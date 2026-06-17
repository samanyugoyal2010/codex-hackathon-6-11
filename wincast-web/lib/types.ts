export type SourceName = "polymarket" | "kalshi";

export interface SourceRow {
  team: string;
  prob: number;
  volume: number;
  source: SourceName;
}

export interface ConsensusRow {
  team: string;
  pPoly: number | null;
  pKalshi: number | null;
  consensus: number;
  refined: number;
  uncertainty: number;
  edgePoly: number | null;
  edgeKalshi: number | null;
  volume: number;
}

export interface ModelMetrics {
  brier_improvement_vs_single_pct?: number | null;
  brier_improvement_vs_pool_pct?: number | null;
  logloss_improvement_vs_single_pct?: number | null;
  truth_summary?: string | null;
}

export interface MarketsResponse {
  keyword: string;
  usedFallback: boolean;
  counts: { polymarket: number; kalshi: number };
  rows: ConsensusRow[];
  alerts: string[];
  metrics: ModelMetrics;
  updatedAt: string;
}
