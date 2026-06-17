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
  /** Title of the single coherent event matched on each venue (for context). */
  events: { polymarket: string | null; kalshi: string | null };
  rows: ConsensusRow[];
  alerts: string[];
  metrics: ModelMetrics;
  updatedAt: string;
}

// ------------------------------------------------------- GPT event analysis
export type InsightImpact = "high" | "medium" | "low";

export interface InsightPoint {
  /** Short, concrete factor (one sentence). */
  point: string;
  /** How strongly it moves the win probability. */
  impact: InsightImpact;
}

export interface EventInsights {
  /** The contender the analysis is focused on. */
  team: string;
  /** One- or two-sentence read of the current picture. */
  summary: string;
  /** Tailwinds — what might go right and raise their chances. */
  upside: InsightPoint[];
  /** Risks — what might go wrong and lower their chances. */
  risks: InsightPoint[];
  /** Specific signals to keep an eye on. */
  watch: string[];
  /** Model that produced the analysis. */
  model: string;
  generatedAt: string;
}

export interface InsightsRequest {
  keyword: string;
  rows: ConsensusRow[];
  alerts?: string[];
  /** Defaults to the projected winner (rows[0]). */
  focusTeam?: string;
  /** Whether the rows came from the cached fallback snapshot. */
  usedFallback?: boolean;
}
