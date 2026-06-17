"""WinCast ML calibration layer.

The pooled market consensus is already good, but prediction/betting markets carry
a well-documented **favorite-longshot bias**: longshots are systematically
overpriced and favorites underpriced. This module learns a calibration map that
corrects that bias and sharpens the consensus.

Model: a logistic regression (Platt-style calibration) over engineered features
  - logit(consensus)        : the market signal in log-odds space
  - logit(consensus)**2     : lets the curve bend (captures favorite-longshot)
  - source_disagreement     : |p_poly - p_kalshi| (epistemic uncertainty)
  - log_volume              : market depth / confidence
Outputs are re-normalized within each event so they form a valid distribution.

Train on real outcomes via a `history.csv`, or on the realistic synthetic market
generator below (see `train.py`). Persisted to / loaded from a joblib artifact.
"""

import os
from typing import Optional

import numpy as np
import pandas as pd

_EPS = 1e-6
# Clip probabilities used for *features* to a saner range than _EPS so a single
# longshot near zero can't produce a |logit|~14 outlier that destabilizes the fit.
_FEAT_FLOOR = 1e-3
DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "wincast_model.joblib")
FEATURE_NAMES = ["logit", "logit_sq", "logit_cube", "disagreement", "log_volume"]


def _logit(p, floor=_EPS):
    p = np.clip(np.asarray(p, dtype=float), floor, 1 - floor)
    return np.log(p / (1 - p))


def build_features(df: pd.DataFrame) -> np.ndarray:
    """Feature matrix from a consensus-style DataFrame.

    Requires a `consensus` column; uses p_poly/p_kalshi/volume if present.
    The favorite-longshot correction is an odd, S-shaped reshaping of the
    log-odds, so we give the model logit plus its square and cube to let it
    bend the calibration curve.
    """
    cons = df["consensus"].to_numpy(dtype=float)
    lg = _logit(cons, floor=_FEAT_FLOOR)
    if "p_poly" in df and "p_kalshi" in df:
        disagree = (df["p_poly"] - df["p_kalshi"]).abs().fillna(0.0).to_numpy()
    elif "disagreement" in df:
        disagree = df["disagreement"].fillna(0.0).to_numpy()
    else:
        disagree = np.zeros_like(cons)
    vol = df["volume"].fillna(0.0).to_numpy() if "volume" in df else np.zeros_like(cons)
    log_vol = np.log1p(np.clip(vol, 0, None))
    return np.column_stack([lg, lg ** 2, lg ** 3, disagree, log_vol])


# --------------------------------------------------------------------------- #
# Synthetic market generator (realistic favorite-longshot bias + a vig)
# --------------------------------------------------------------------------- #
def generate_synthetic_dataset(
    n_events: int = 6000,
    min_teams: int = 4,
    max_teams: int = 16,
    bias_gamma: float = 0.70,
    seed: int = 7,
) -> pd.DataFrame:
    """Simulate market data with known ground truth.

    For each event we draw *true* win probabilities, then simulate two market
    sources whose prices are distorted by a favorite-longshot power transform
    (p_market proportional to p_true**gamma, gamma<1 flattens the distribution),
    plus per-source noise and a house vig. The realized winner is sampled from
    the true probabilities. A model that learns to invert this distortion will
    beat the raw market consensus on held-out data.

    Returns one row per team with columns:
        event_id, p_poly, p_kalshi, consensus, volume, p_true, won
    """
    rng = np.random.default_rng(seed)
    rows = []
    for ev in range(n_events):
        k = int(rng.integers(min_teams, max_teams + 1))
        # Skewed strengths so events have clear favorites and longshots.
        alpha = rng.uniform(0.3, 1.2, size=k)
        p_true = rng.dirichlet(alpha)

        def distort(gamma_jitter, noise, vig):
            g = bias_gamma + gamma_jitter
            p = np.power(p_true, g)
            p = p / p.sum()
            p = p * rng.uniform(1 - noise, 1 + noise, size=k)
            p = np.clip(p, _EPS, None)
            p = p / p.sum()
            return p * vig  # vig>1 => prices sum to >1 (un-de-vigged)

        # Each source: small independent gamma jitter + sizeable independent
        # price noise (so pooling cancels noise) on top of the shared
        # favorite-longshot bias (so the ML layer has a systematic error to fix).
        p_poly_raw = distort(rng.normal(0, 0.04), 0.16, vig=rng.uniform(1.02, 1.06))
        p_kalshi_raw = distort(rng.normal(0, 0.05), 0.24, vig=rng.uniform(1.03, 1.10))

        # De-vig each source (as the real pipeline does).
        p_poly = p_poly_raw / p_poly_raw.sum()
        p_kalshi = p_kalshi_raw / p_kalshi_raw.sum()

        vol_poly = rng.lognormal(mean=12, sigma=1.5, size=k)
        vol_kalshi = rng.lognormal(mean=10, sigma=1.5, size=k)
        w_poly = np.log1p(vol_poly)
        w_kalshi = np.log1p(vol_kalshi)

        # Logarithmic opinion pool consensus (matches model.consensus).
        z = (w_poly * _logit(p_poly) + w_kalshi * _logit(p_kalshi)) / (w_poly + w_kalshi)
        cons = 1.0 / (1.0 + np.exp(-z))
        cons = cons / cons.sum()

        winner = rng.choice(k, p=p_true)
        for i in range(k):
            rows.append({
                "event_id": ev,
                "p_poly": p_poly[i],
                "p_kalshi": p_kalshi[i],
                "consensus": cons[i],
                "volume": vol_poly[i] + vol_kalshi[i],
                "p_true": p_true[i],
                "won": int(i == winner),
            })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# Calibration model
# --------------------------------------------------------------------------- #
class CalibrationModel:
    """Logistic calibration over engineered consensus features."""

    def __init__(self, pipeline=None, metrics=None):
        self.pipeline = pipeline
        self.metrics = metrics or {}

    @property
    def is_trained(self) -> bool:
        return self.pipeline is not None

    def fit(self, df: pd.DataFrame) -> "CalibrationModel":
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        X = build_features(df)
        y = df["won"].astype(int).to_numpy()
        pipe = Pipeline([
            ("scale", StandardScaler()),
            ("lr", LogisticRegression(max_iter=2000, C=1.0)),
        ])
        # np.errstate silences a spurious "divide by zero in matmul" RuntimeWarning
        # emitted by the macOS Accelerate BLAS backend (benign; features are finite).
        with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
            self.pipeline = pipe.fit(X, y)
        return self

    def predict_raw(self, df: pd.DataFrame) -> np.ndarray:
        """Per-team P(win) before per-event normalization."""
        if not self.is_trained:
            return df["consensus"].to_numpy(dtype=float)
        with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
            return self.pipeline.predict_proba(build_features(df))[:, 1]

    def refine(self, df: pd.DataFrame, group_col: Optional[str] = None) -> pd.DataFrame:
        """Add a `refined` column. Passthrough (= consensus) if untrained.

        If `group_col` is given, normalize within each event; otherwise across
        the whole frame (the live dashboard shows one event at a time).
        """
        out = df.copy()
        if not self.is_trained or out.empty:
            out["refined"] = out["consensus"]
            return out
        raw = self.predict_raw(out)
        out["_raw"] = raw
        if group_col and group_col in out:
            out["refined"] = out.groupby(group_col)["_raw"].transform(
                lambda s: s / s.sum() if s.sum() > 0 else s)
        else:
            total = raw.sum()
            out["refined"] = raw / total if total > 0 else out["consensus"]
        return out.drop(columns=["_raw"])

    # ---- persistence -----------------------------------------------------
    def save(self, path: str = DEFAULT_MODEL_PATH):
        import joblib
        joblib.dump({"pipeline": self.pipeline, "metrics": self.metrics}, path)

    @classmethod
    def load(cls, path: str = DEFAULT_MODEL_PATH) -> "CalibrationModel":
        """Load a trained model, or return an untrained passthrough if absent."""
        try:
            import joblib
            blob = joblib.load(path)
            return cls(pipeline=blob.get("pipeline"), metrics=blob.get("metrics", {}))
        except Exception:
            return cls()


if __name__ == "__main__":
    data = generate_synthetic_dataset(n_events=500)
    print(data.head().to_string())
    print("rows:", len(data), "events:", data["event_id"].nunique())
    m = CalibrationModel().fit(data)
    print("refined sample:\n", m.refine(data.head(8), group_col="event_id")[
        ["event_id", "consensus", "refined", "won"]].to_string())
