# 🏆 WinCast — Real-Time Event Win-Probability Predictor

A live dashboard that predicts **which team/country wins an event** (World Cup, election, etc.)
by blending real-time prediction-market odds from **Polymarket** and **Kalshi** into a
de-vigged, liquidity-weighted **consensus probability** — and flags **mispricings ("edges")**
where one market disagrees with the consensus.

> The "model" isn't a from-scratch predictor. Prediction markets are already excellent
> forecasters, so WinCast strips each market's house margin (de-vig), blends sources by
> liquidity, and surfaces the gaps between them as a tradable signal — then a trained
> calibration model corrects the markets' systematic favorite–longshot bias.

## The model — three layers

WinCast pools multiple markets into a *better* probability than any single platform:

1. **De-vig** — strip each market's house margin so its prices sum to 1.
2. **Logarithmic opinion pool** — combine sources as a weighted mean in **log-odds
   space** (the standard, externally-Bayesian way to aggregate forecasts), weighted by
   **log-liquidity** so a deep market counts more without one venue dominating. We also
   report an **uncertainty band** from cross-source disagreement.
3. **ML calibration** (`ml.py`, trained by `train.py`) — a logistic calibration model over
   engineered features (`logit(consensus)` + higher-order terms, source disagreement,
   log-volume) that corrects the documented **favorite–longshot bias** (longshots
   overpriced, favorites underpriced) and sharpens the consensus.

### Measured lift (held-out evaluation)

Trained/evaluated on a realistic simulated market dataset with known ground-truth
outcomes (favorite–longshot bias + per-source noise + a house vig):

| Stage | Distance to true win prob (MAE) | vs single market |
|-------|-------------------------------|------------------|
| Single market | 0.0208 | — |
| Pooled consensus | 0.0198 | **+4.6%** |
| **WinCast ML (calibrated)** | **0.0105** | **+49%** |

On held-out *outcomes*, the calibrated model also improves **Brier +0.8%** and
**log-loss +1.2%** over a single market — small in absolute terms because markets are
already near-optimal, but consistent. Swap in your own results via a `history.csv` to
retrain on real data.

## Prerequisites

- **Python 3.9+** (tested on 3.9.6)
- All data sources are **public — no API keys, no auth, no wallet.**

## Setup

```bash
cd codex-hackathon/wincast
pip3 install -r requirements.txt
```

## Train the calibration model (optional but recommended)

A pre-trained model ships as `wincast_model.joblib`. To regenerate it (and print the
held-out metrics above):

```bash
cd codex-hackathon/wincast
python3 train.py                 # synthetic market data with ground-truth outcomes
python3 train.py history.csv     # OR your own data (needs `consensus` + `won` columns)
```

If no trained model is present, the dashboard's ML layer simply passes the pooled
consensus through unchanged — it never breaks.

## Run

The `streamlit` launcher may not be on your `PATH`, so use the module form:

```bash
cd codex-hackathon/wincast
python3 -m streamlit run app.py
```

Then open the **Local URL** it prints (usually <http://localhost:8501>).

## Using the dashboard

- **Event keyword** (text box at top) — what event to track. Defaults to `World Cup`.
  Retype it live (e.g. `President`) and the dashboard reloads instantly.
- **Sidebar controls** — toggle auto-refresh, the ML refinement layer (M5), the ESPN
  stats panel (M6), and adjust the edge-alert threshold.
- **What you see:** headline favorite, a sortable table (Polymarket % | Kalshi % |
  **Consensus %** | Edge), a consensus bar chart, and edge alerts.

### 💡 Demo tip — where the cross-source edges show up

- `World Cup` is currently **Polymarket-only** on Kalshi, so it shows a single-source
  table (still works — Kalshi columns show `—`).
- For the **cross-market edge "wow" moment**, use a keyword both markets carry, e.g.
  **`President`** — that's where the mispricing alerts actually fire.

## Project structure

```
wincast/
├── app.py                  # Streamlit UI (entry point)
├── config.py               # event keyword, refresh interval, edge threshold, team aliases
├── model.py                # de-vig, log-opinion pool consensus, edges, uncertainty
├── ml.py                   # trained calibration model + synthetic data generator
├── train.py                # train the calibration model & report held-out metrics
├── wincast_model.joblib    # pre-trained calibration model (regenerate with train.py)
├── requirements.txt
└── sources/
    ├── polymarket.py       # Polymarket Gamma API fetcher
    ├── kalshi.py           # Kalshi Trade API v2 fetcher
    └── espn.py             # ESPN public stats (key-stats panel)
```

## Quick sanity checks

Run any source or the model standalone to confirm live data:

```bash
cd codex-hackathon/wincast
python3 sources/polymarket.py "World Cup"   # -> list of (team, prob, volume)
python3 sources/kalshi.py "President"        # -> same shape from Kalshi
python3 model.py                              # -> consensus + edge demo (sums to 1.0)
```

## Data sources

| Source | Endpoint | Notes |
|--------|----------|-------|
| Polymarket | `gamma-api.polymarket.com` | Gamma API, public, no auth |
| Kalshi | `external-api.kalshi.com/trade-api/v2` | Trade API v2, public; prices in **dollars** (0–1) |
| ESPN | `site.api.espn.com/apis/site/v2/sports/...` | Unofficial public stats, no auth |

---

*Stack: Python · Streamlit · scikit-learn · Polymarket Gamma API · Kalshi Trade API v2 · ESPN.*
