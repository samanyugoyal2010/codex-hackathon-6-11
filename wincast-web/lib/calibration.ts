// ML calibration layer — TypeScript port of the trained sklearn model (ml.py).
// The model is a StandardScaler + LogisticRegression, so the forward pass is just
// standardize -> dot(coef) + intercept -> sigmoid -> renormalize. Weights were
// exported from wincast_model.joblib (see wincast/train.py).

import type { ConsensusRow, ModelMetrics } from "./types";
import { logit, sigmoid } from "./model";

const FEAT_FLOOR = 1e-3;

const WEIGHTS = {
  scalerMean: [
    -2.7732311413536364, 9.628828411425076, -39.757227244981614,
    0.012761762573229722, 12.374777548396418,
  ],
  scalerScale: [
    1.3921269511261132, 9.806564926078769, 63.90958189425873,
    0.015114937771951744, 1.2605514238895388,
  ],
  coef: [
    1.4958539401920972, -0.5448846003636515, 0.08363368834023115,
    0.008108448281989072, -0.0015040901115676779,
  ],
  intercept: -3.2193317082949644,
};

export const MODEL_METRICS: ModelMetrics = {
  brier_improvement_vs_single_pct: 0.8,
  brier_improvement_vs_pool_pct: 0.78,
  logloss_improvement_vs_single_pct: 1.23,
  truth_summary: "ML estimates are 49% closer to true win rates than a single market.",
};

function features(row: ConsensusRow): number[] {
  const lg = logit(Math.min(Math.max(row.consensus, FEAT_FLOOR), 1 - FEAT_FLOOR));
  const disagreement =
    row.pPoly !== null && row.pKalshi !== null ? Math.abs(row.pPoly - row.pKalshi) : 0;
  const logVol = Math.log1p(Math.max(row.volume || 0, 0));
  return [lg, lg * lg, lg * lg * lg, disagreement, logVol];
}

function rawProb(row: ConsensusRow): number {
  const x = features(row);
  let z = WEIGHTS.intercept;
  for (let i = 0; i < x.length; i++) {
    const scaled = (x[i] - WEIGHTS.scalerMean[i]) / WEIGHTS.scalerScale[i];
    z += WEIGHTS.coef[i] * scaled;
  }
  return sigmoid(z);
}

/** Add the calibrated `refined` probability (renormalized to sum to 1). */
export function refine(rows: ConsensusRow[]): ConsensusRow[] {
  if (rows.length === 0) return rows;
  const raws = rows.map(rawProb);
  const total = raws.reduce((a, b) => a + b, 0);
  return rows.map((r, i) => ({
    ...r,
    refined: total > 0 ? raws[i] / total : r.consensus,
  }));
}
