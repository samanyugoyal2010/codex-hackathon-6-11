"""WinCast consensus engine: de-vig, logarithmic opinion pooling, edges, uncertainty.

The consensus is more than a naive average. We:
  1. De-vig each source (strip the house margin so probs sum to 1).
  2. Aggregate sources with a **logarithmic opinion pool** (weighted mean in
     log-odds space) — the standard, theoretically-grounded way to combine
     probabilistic forecasts. It is externally Bayesian and handles confident
     disagreement far better than a linear average.
  3. Weight each source by **log-liquidity** (a deep market is more trustworthy,
     with diminishing returns) instead of raw volume, so one huge market can't
     completely dominate.
  4. Quantify **uncertainty** from cross-source disagreement.

The trained ML calibration layer that refines this consensus lives in `ml.py`.
"""

from typing import List, Dict, Optional

import numpy as np
import pandas as pd

try:
    from config import EDGE_THRESHOLD, TEAM_ALIASES
except ImportError:
    EDGE_THRESHOLD = 0.03
    TEAM_ALIASES = {}

_EPS = 1e-6


# --------------------------------------------------------------------------- #
# Name matching
# --------------------------------------------------------------------------- #
def normalize_team(name: str) -> str:
    """Lowercase/strip and apply the alias map. Demo-grade, intentionally tiny."""
    key = (name or "").strip().lower()
    if key.startswith("yes "):  # Kalshi prefixes some labels with "yes "
        key = key[4:].strip()
    return TEAM_ALIASES.get(key, key)


def _display_name(name: str) -> str:
    return normalize_team(name).title()


# --------------------------------------------------------------------------- #
# De-vig and pooling primitives
# --------------------------------------------------------------------------- #
def devig(probs: Dict[str, float]) -> Dict[str, float]:
    """Normalize probabilities so they sum to 1 (removes the house margin)."""
    s = sum(v for v in probs.values() if v is not None)
    if s <= 0:
        return dict(probs)
    return {k: (v / s if v is not None else v) for k, v in probs.items()}


def _logit(p: float) -> float:
    p = min(max(p, _EPS), 1 - _EPS)
    return float(np.log(p / (1 - p)))


def _sigmoid(z: float) -> float:
    return float(1.0 / (1.0 + np.exp(-z)))


def log_pool(prob_weight_pairs) -> Optional[float]:
    """Logarithmic opinion pool: weighted mean of log-odds, mapped back to [0,1].

    Equivalent to a normalized weighted geometric mean of the probabilities.
    Returns None if there is nothing to pool.
    """
    pairs = [(p, w) for p, w in prob_weight_pairs if p is not None]
    if not pairs:
        return None
    total_w = sum(w for _, w in pairs)
    if total_w <= 0:  # no liquidity signal -> equal weights
        pairs = [(p, 1.0) for p, _ in pairs]
        total_w = float(len(pairs))
    z = sum(w * _logit(p) for p, w in pairs) / total_w
    return _sigmoid(z)


def reliability_weight(volume: float) -> float:
    """Log-liquidity reliability weight (diminishing returns, never negative)."""
    try:
        return float(np.log1p(max(volume or 0.0, 0.0)))
    except (ValueError, TypeError):
        return 0.0


# --------------------------------------------------------------------------- #
# Consensus blend
# --------------------------------------------------------------------------- #
def consensus(sources: List[List[Dict]], method: str = "logpool") -> pd.DataFrame:
    """Aggregate per-team win probabilities across sources.

    Args:
        sources: list of source row-lists, each row {team, prob, volume, source}.
        method:  "logpool" (default) or "linear" for the naive volume-weighted mean.

    Returns a DataFrame with columns:
        team, p_poly, p_kalshi, consensus, uncertainty, edge_poly, edge_kalshi, volume
    Teams present in only one source still appear (other source = NaN).
    """
    per_source = {}      # source -> {team: prob}  (de-vigged)
    per_source_vol = {}  # source -> {team: volume}
    for rows in sources:
        if not rows:
            continue
        src = rows[0].get("source", "?")
        raw, vol = {}, {}
        for r in rows:
            team = normalize_team(r["team"])
            if team not in raw or (r.get("volume", 0) or 0) > vol.get(team, 0):
                raw[team] = r["prob"]
                vol[team] = r.get("volume", 0) or 0
        per_source[src] = devig(raw)
        per_source_vol[src] = vol

    teams = sorted({t for d in per_source.values() for t in d})
    cols = ["team", "p_poly", "p_kalshi", "consensus", "uncertainty",
            "edge_poly", "edge_kalshi", "volume"]
    if not teams:
        return pd.DataFrame(columns=cols)

    records = []
    for team in teams:
        p_poly = per_source.get("polymarket", {}).get(team)
        p_kalshi = per_source.get("kalshi", {}).get(team)
        v_poly = per_source_vol.get("polymarket", {}).get(team, 0)
        v_kalshi = per_source_vol.get("kalshi", {}).get(team, 0)

        pairs = [(p_poly, reliability_weight(v_poly)),
                 (p_kalshi, reliability_weight(v_kalshi))]
        present = [(p, w) for p, w in pairs if p is not None]
        if not present:
            continue

        if method == "linear":
            tw = sum(w for _, w in present)
            cons = (sum(p * w for p, w in present) / tw if tw > 0
                    else sum(p for p, _ in present) / len(present))
        else:
            cons = log_pool(present)

        probs_only = [p for p, _ in present]
        uncertainty = float(np.std(probs_only)) if len(probs_only) > 1 else 0.0

        records.append({
            "team": _display_name(team),
            "p_poly": p_poly,
            "p_kalshi": p_kalshi,
            "consensus": cons,
            "uncertainty": uncertainty,
            "volume": (v_poly or 0) + (v_kalshi or 0),
        })

    df = pd.DataFrame.from_records(records)
    # Re-normalize the consensus across teams so it reads as a clean distribution.
    cons_sum = df["consensus"].sum()
    if cons_sum > 0:
        df["consensus"] = df["consensus"] / cons_sum

    df["edge_poly"] = df["p_poly"] - df["consensus"]
    df["edge_kalshi"] = df["p_kalshi"] - df["consensus"]
    df = df.sort_values("consensus", ascending=False).reset_index(drop=True)
    return df[cols]


def edge_alerts(df: pd.DataFrame, threshold: float = EDGE_THRESHOLD) -> List[str]:
    """Human-readable mispricing messages for |edge| above the threshold."""
    msgs = []
    for _, row in df.iterrows():
        for src, col in (("Polymarket", "edge_poly"), ("Kalshi", "edge_kalshi")):
            edge = row[col]
            if pd.isna(edge) or abs(edge) <= threshold:
                continue
            direction = "underpricing" if edge < 0 else "overpricing"
            msgs.append("{} {} {} by {:.1f}%".format(
                src, direction, row["team"], abs(edge) * 100))
    return msgs


if __name__ == "__main__":
    poly = [
        {"team": "Brazil", "prob": 0.20, "volume": 1_000_000, "source": "polymarket"},
        {"team": "France", "prob": 0.18, "volume": 800_000, "source": "polymarket"},
        {"team": "Spain", "prob": 0.15, "volume": 500_000, "source": "polymarket"},
    ]
    kalshi = [
        {"team": "BRA", "prob": 0.24, "volume": 600_000, "source": "kalshi"},
        {"team": "France", "prob": 0.17, "volume": 400_000, "source": "kalshi"},
    ]
    df = consensus([poly, kalshi])
    print(df.to_string())
    print("consensus sum:", round(df["consensus"].sum(), 4))
    print("alerts:", edge_alerts(df))
