"""Train the WinCast calibration model and report its lift over raw consensus.

Usage:
    python3 train.py                 # synthetic data (default)
    python3 train.py history.csv     # your own data with a `won` column

Real-data CSV must contain at least: consensus, won
(optionally p_poly, p_kalshi, volume, event_id for richer features).

Saves the trained model to wincast_model.joblib and prints a metrics comparison.
"""

import sys

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

from ml import CalibrationModel, generate_synthetic_dataset, DEFAULT_MODEL_PATH


def _metrics(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {
        "brier": brier_score_loss(y, p),
        "log_loss": log_loss(y, p, labels=[0, 1]),
        "auc": roc_auc_score(y, p) if len(np.unique(y)) > 1 else float("nan"),
    }


def _split_by_event(df, frac=0.75, seed=11):
    rng = np.random.default_rng(seed)
    if "event_id" in df:
        events = df["event_id"].unique()
        rng.shuffle(events)
        cut = int(len(events) * frac)
        train_ev = set(events[:cut])
        mask = df["event_id"].isin(train_ev)
        return df[mask].copy(), df[~mask].copy()
    idx = rng.permutation(len(df))
    cut = int(len(df) * frac)
    return df.iloc[idx[:cut]].copy(), df.iloc[idx[cut:]].copy()


def main():
    if len(sys.argv) > 1:
        path = sys.argv[1]
        print("Loading training data from {} ...".format(path))
        data = pd.read_csv(path)
        if "consensus" not in data or "won" not in data:
            raise SystemExit("CSV must contain `consensus` and `won` columns.")
    else:
        print("Generating synthetic market dataset (favorite-longshot bias) ...")
        data = generate_synthetic_dataset()

    print("  rows: {:,}   events: {:,}".format(
        len(data), data["event_id"].nunique() if "event_id" in data else len(data)))

    train_df, test_df = _split_by_event(data)
    print("  train rows: {:,}   test rows: {:,}".format(len(train_df), len(test_df)))

    model = CalibrationModel().fit(train_df)

    y = test_df["won"].astype(int).to_numpy()
    refined_df = model.refine(test_df, group_col="event_id" if "event_id" in test_df else None)

    # Full stack of baselines: a single raw market -> pooled consensus -> ML.
    stages = []
    if "p_poly" in test_df:
        stages.append(("single market (Polymarket)", _metrics(y, test_df["p_poly"].fillna(test_df["consensus"]).to_numpy())))
    if "p_kalshi" in test_df:
        stages.append(("single market (Kalshi)", _metrics(y, test_df["p_kalshi"].fillna(test_df["consensus"]).to_numpy())))
    consensus_m = _metrics(y, test_df["consensus"].to_numpy())
    stages.append(("pooled consensus", consensus_m))
    refined_m = _metrics(y, refined_df["refined"].to_numpy())
    stages.append(("WinCast ML (calibrated)", refined_m))

    def pct_better(a, b):  # lower brier/log-loss is better
        return (a - b) / a * 100 if a else 0.0

    print("\n=== Held-out test metrics (lower brier / log-loss = better) ===")
    print("{:<28}{:>10}{:>10}{:>8}".format("stage", "brier", "log_loss", "auc"))
    for name, m in stages:
        print("{:<28}{:>10.4f}{:>10.4f}{:>8.3f}".format(name, m["brier"], m["log_loss"], m["auc"]))

    def pct_better_g(a, b):  # generic: lower is better
        return (a - b) / a * 100 if a else 0.0

    # When ground truth is available (synthetic), measure how close each estimate
    # is to the TRUE win probabilities — far more sensitive than Brier, which is
    # dominated by one-winner-per-event outcome noise.
    truth_line = ""
    if "p_true" in test_df:
        t = test_df["p_true"].to_numpy()
        # Single-market error = the typical error of using just ONE market
        # (average of each source's own error), so pooling can show its lift.
        if "p_poly" in test_df and "p_kalshi" in test_df:
            mae_single = np.mean([
                np.abs(test_df["p_poly"].to_numpy() - t).mean(),
                np.abs(test_df["p_kalshi"].to_numpy() - t).mean(),
            ])
        else:
            mae_single = np.abs(test_df["consensus"].to_numpy() - t).mean()
        mae_pool = np.abs(test_df["consensus"].to_numpy() - t).mean()
        mae_ml = np.abs(refined_df["refined"].to_numpy() - t).mean()
        print("\n=== Distance to TRUE win probabilities (mean abs error, lower=better) ===")
        print("  single market : {:.4f}".format(mae_single))
        print("  pooled        : {:.4f}   ({:+.1f}% vs single)".format(mae_pool, pct_better_g(mae_single, mae_pool)))
        print("  WinCast ML    : {:.4f}   ({:+.1f}% vs single, {:+.1f}% vs pooled)".format(
            mae_ml, pct_better_g(mae_single, mae_ml), pct_better_g(mae_pool, mae_ml)))
        truth_line = "ML estimates are {:.0f}% closer to true win rates than a single market.".format(
            pct_better_g(mae_single, mae_ml))

    # Headline improvements: ML vs best single market, and ML vs pooled consensus.
    single_briers = [m["brier"] for n, m in stages if n.startswith("single market")]
    best_single = min(single_briers) if single_briers else consensus_m["brier"]
    imp_vs_single = pct_better(best_single, refined_m["brier"])
    imp_vs_pool = pct_better(consensus_m["brier"], refined_m["brier"])
    ll_vs_single = pct_better(min(m["log_loss"] for n, m in stages if n.startswith("single market")) if single_briers else consensus_m["log_loss"], refined_m["log_loss"])

    model.metrics = {
        "stages": {n: m for n, m in stages},
        "n_train": int(len(train_df)),
        "n_test": int(len(test_df)),
        "brier_improvement_vs_single_pct": round(imp_vs_single, 2),
        "brier_improvement_vs_pool_pct": round(imp_vs_pool, 2),
        "logloss_improvement_vs_single_pct": round(ll_vs_single, 2),
    }
    if truth_line:
        model.metrics["truth_summary"] = truth_line
    model.save(DEFAULT_MODEL_PATH)
    print("\nSaved trained model -> {}".format(DEFAULT_MODEL_PATH))
    if truth_line:
        print(truth_line)
    print("Brier vs best single market:  {:+.1f}%   (pool + calibration)".format(imp_vs_single))
    print("Brier vs pooled consensus:    {:+.1f}%   (calibration only)".format(imp_vs_pool))
    print("Log-loss vs best single market: {:+.1f}%".format(ll_vs_single))


if __name__ == "__main__":
    main()
