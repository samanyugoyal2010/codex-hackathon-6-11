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
    """Aggregate per-team win probabilities across an arbitrary set of sources.

    The pool is fully source-agnostic: pass two venues or ten, and each one gets
    its own `p_<source>` and `edge_<source>` columns. The de-vig, log-opinion
    pool, and liquidity weighting all scale to however many sources show up.

    Args:
        sources: list of source row-lists, each row {team, prob, volume, source}.
        method:  "logpool" (default) or "linear" for the naive volume-weighted mean.

    Returns a DataFrame with columns:
        team, p_<src> (one per source), consensus, uncertainty, disagreement,
        volume, edge_<src> (one per source)
    Teams present in only one source still appear (missing sources = NaN).
    """
    per_source = {}      # source -> {team: prob}  (de-vigged)
    per_source_vol = {}  # source -> {team: volume}
    source_order = []    # preserve first-seen order for stable columns
    for rows in sources:
        if not rows:
            continue
        src = rows[0].get("source", "?")
        raw = per_source.setdefault(src, {})
        vol = per_source_vol.setdefault(src, {})
        if src not in source_order:
            source_order.append(src)
        for r in rows:
            team = normalize_team(r["team"])
            v = r.get("volume", 0) or 0
            # Keep the deepest market when a source lists a team more than once.
            if team not in raw or v > vol.get(team, 0):
                raw[team] = r["prob"]
                vol[team] = v
    for src in source_order:  # de-vig each source independently
        per_source[src] = devig(per_source[src])

    teams = sorted({t for d in per_source.values() for t in d})
    cols = (["team"] + ["p_" + s for s in source_order]
            + ["consensus", "uncertainty", "disagreement", "volume"]
            + ["edge_" + s for s in source_order])
    if not teams:
        return pd.DataFrame(columns=cols)

    records = []
    for team in teams:
        present = []        # (prob, weight) for sources that price this team
        total_vol = 0.0
        rec = {"team": _display_name(team)}
        for src in source_order:
            p = per_source[src].get(team)
            v = per_source_vol[src].get(team, 0) or 0
            rec["p_" + src] = p
            if p is not None:
                present.append((p, reliability_weight(v)))
                total_vol += v
        if not present:
            continue

        if method == "linear":
            tw = sum(w for _, w in present)
            cons = (sum(p * w for p, w in present) / tw if tw > 0
                    else sum(p for p, _ in present) / len(present))
        else:
            cons = log_pool(present)

        probs_only = [p for p, _ in present]
        # Cross-source disagreement = epistemic uncertainty (a calibration feature).
        uncertainty = float(np.std(probs_only)) if len(probs_only) > 1 else 0.0

        rec["consensus"] = cons
        rec["uncertainty"] = uncertainty
        rec["disagreement"] = uncertainty
        rec["volume"] = total_vol
        records.append(rec)

    df = pd.DataFrame.from_records(records)
    # Re-normalize the consensus across teams so it reads as a clean distribution.
    cons_sum = df["consensus"].sum()
    if cons_sum > 0:
        df["consensus"] = df["consensus"] / cons_sum

    for src in source_order:
        df["edge_" + src] = df["p_" + src] - df["consensus"]
    df = df.sort_values("consensus", ascending=False).reset_index(drop=True)
    return df[cols]


def edge_alerts(df: pd.DataFrame, threshold: float = EDGE_THRESHOLD,
                labels: Optional[Dict[str, str]] = None) -> List[str]:
    """Human-readable mispricing messages for |edge| above the threshold.

    Scans every `edge_<source>` column, so it covers however many venues are in
    the pool. `labels` maps a source key to its display name (else Title Case).
    """
    labels = labels or {}
    edge_cols = [c for c in df.columns if c.startswith("edge_")]
    msgs = []
    for _, row in df.iterrows():
        for col in edge_cols:
            edge = row[col]
            if pd.isna(edge) or abs(edge) <= threshold:
                continue
            src = col[len("edge_"):]
            name = labels.get(src, src.replace("_", " ").title())
            direction = "underpricing" if edge < 0 else "overpricing"
            msgs.append("{} {} {} by {:.1f}%".format(
                name, direction, row["team"], abs(edge) * 100))
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
    manifold = [
        {"team": "Brazil", "prob": 0.22, "volume": 40_000, "source": "manifold"},
        {"team": "Spain", "prob": 0.16, "volume": 25_000, "source": "manifold"},
    ]
    df = consensus([poly, kalshi, manifold])
    print(df.to_string())
    print("consensus sum:", round(df["consensus"].sum(), 4))
    print("alerts:", edge_alerts(df))
