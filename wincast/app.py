"""WinCast — live win-probability dashboard (Streamlit entry point).

Run:  streamlit run app.py
"""

import time
from datetime import datetime

import pandas as pd
import streamlit as st

import config
from model import consensus, edge_alerts, normalize_team
from ml import CalibrationModel
from sources import polymarket, kalshi, manifold, predictit, espn

# The source registry — add a venue here and the whole platform (fetch, pool,
# table columns, edge alerts) picks it up automatically. (key, label, fetch_fn)
SOURCES = [
    ("polymarket", "Polymarket", polymarket.fetch_outcomes),
    ("kalshi", "Kalshi", kalshi.fetch_outcomes),
    ("manifold", "Manifold", manifold.fetch_outcomes),
    ("predictit", "PredictIt", predictit.fetch_outcomes),
]
SOURCE_LABELS = {key: label for key, label, _ in SOURCES}

# Known-good fallback so a stage demo always shows something even if every API
# is down or filters return nothing.
FALLBACK = {
    "polymarket": [
        {"team": "Brazil", "prob": 0.21, "volume": 1_200_000, "source": "polymarket"},
        {"team": "France", "prob": 0.18, "volume": 900_000, "source": "polymarket"},
        {"team": "Spain", "prob": 0.15, "volume": 700_000, "source": "polymarket"},
        {"team": "England", "prob": 0.13, "volume": 650_000, "source": "polymarket"},
        {"team": "Argentina", "prob": 0.12, "volume": 800_000, "source": "polymarket"},
    ],
    "kalshi": [
        {"team": "Brazil", "prob": 0.25, "volume": 400_000, "source": "kalshi"},
        {"team": "France", "prob": 0.17, "volume": 300_000, "source": "kalshi"},
        {"team": "Argentina", "prob": 0.14, "volume": 350_000, "source": "kalshi"},
    ],
    "manifold": [
        {"team": "Brazil", "prob": 0.23, "volume": 45_000, "source": "manifold"},
        {"team": "Spain", "prob": 0.17, "volume": 30_000, "source": "manifold"},
        {"team": "France", "prob": 0.16, "volume": 28_000, "source": "manifold"},
    ],
    "predictit": [
        {"team": "Brazil", "prob": 0.27, "volume": 25_000, "source": "predictit"},
        {"team": "England", "prob": 0.16, "volume": 25_000, "source": "predictit"},
    ],
}


@st.cache_resource
def load_model():
    """Load the trained calibration model once (passthrough if not trained yet)."""
    return CalibrationModel.load()


@st.cache_data(ttl=config.REFRESH_SECONDS)
def load_sources(keyword: str):
    """Fetch every registered source, falling back to a snapshot if all are empty."""
    rows_by_source = {key: fetch_fn(keyword) or [] for key, _, fetch_fn in SOURCES}
    stats = espn.fetch_stats(keyword)
    used_fallback = False
    if not any(rows_by_source.values()):
        rows_by_source = {k: list(v) for k, v in FALLBACK.items()}
        used_fallback = True
    return rows_by_source, stats, used_fallback


def pct(x):
    return "—" if pd.isna(x) else "{:.1f}%".format(x * 100)


def main():
    st.set_page_config(page_title="WinCast", page_icon="🏆", layout="wide")
    st.title("🏆 WinCast — live win probabilities")
    st.caption(
        "Blends live prices from {} prediction markets ({}) into a de-vigged, "
        "liquidity-weighted consensus and flags cross-market mispricings.".format(
            len(SOURCES), ", ".join(label for _, label, _ in SOURCES))
    )

    # ----- sidebar controls -----
    st.sidebar.header("Controls")
    auto = st.sidebar.checkbox("Auto-refresh", value=True)
    use_ml = st.sidebar.checkbox("ML calibration layer", value=True)
    show_stats = st.sidebar.checkbox("ESPN key stats (M6)", value=True)
    threshold = st.sidebar.slider(
        "Edge alert threshold", 0.0, 0.10, config.EDGE_THRESHOLD, 0.005
    )

    if auto:
        try:
            from streamlit_autorefresh import st_autorefresh

            st_autorefresh(interval=config.REFRESH_SECONDS * 1000, key="wincast_tick")
        except Exception:
            pass  # fall back to manual sleep+rerun at the end

    keyword = st.text_input("Event keyword", value=config.EVENT_KEYWORD)

    rows_by_source, stats, used_fallback = load_sources(keyword)
    df = consensus([rows_by_source[key] for key, _, _ in SOURCES])

    if df.empty:
        st.warning("No live markets matched '{}'. Try another keyword.".format(keyword))
        return

    # Which sources actually priced this event (drives the table columns).
    active = [(key, label) for key, label, _ in SOURCES if ("p_" + key) in df.columns]

    prob_col = "consensus"
    model = load_model()
    if use_ml:
        df = model.refine(df)
        prob_col = "refined"
        if model.is_trained:
            m = model.metrics or {}
            st.sidebar.success("ML: trained calibration model")
            if m.get("truth_summary"):
                st.sidebar.caption("📊 " + m["truth_summary"])
            if m.get("logloss_improvement_vs_single_pct") is not None:
                st.sidebar.caption(
                    "Held-out log-loss {:+.1f}% vs a single market".format(
                        m["logloss_improvement_vs_single_pct"]))
        else:
            st.sidebar.warning("ML: untrained (run `python3 train.py`) — passthrough")

    # ----- headline pick -----
    top = df.iloc[0]
    c1, c2, c3 = st.columns(3)
    c1.metric("Favorite", top["team"], pct(top[prob_col]))
    blended = " · ".join(
        "{} {}".format(label, len(rows_by_source.get(key, [])))
        for key, label, _ in SOURCES)
    c2.metric("Sources blended", str(len(active)),
              help="Outcomes per source — " + blended)
    c3.metric("Teams tracked", str(len(df)))

    if used_fallback:
        st.info("⚠️ Live fetch empty — showing cached fallback snapshot.")

    # ----- edge alerts -----
    alerts = edge_alerts(df, threshold=threshold, labels=SOURCE_LABELS)
    if alerts:
        for msg in alerts:
            st.warning("📈 " + msg)
    else:
        st.success("Markets are in agreement — no significant edges right now.")

    # ----- table -----
    cols = {"Team": df["team"]}
    for key, label in active:               # one live-price column per source
        cols[label] = df["p_" + key].map(pct)
    cols["Pooled"] = df["consensus"].map(pct)
    if use_ml and "refined" in df:
        cols["ML calibrated"] = df["refined"].map(pct)
    cols["± uncert."] = df["uncertainty"].map(lambda x: pct(x) if not pd.isna(x) else "—")
    for key, label in active:               # one edge column per source
        cols["Edge ({})".format(label)] = df["edge_" + key].map(
            lambda x: pct(x) if not pd.isna(x) else "—")
    table = pd.DataFrame(cols)

    if show_stats and stats:
        table["Form"] = df["team"].map(
            lambda t: (stats.get(normalize_team(t), {}) or {}).get("form", "")
        )

    st.subheader("Win probabilities")
    st.dataframe(table, use_container_width=True, hide_index=True)

    # ----- bar chart -----
    label = "ML-calibrated probability" if prob_col == "refined" else "Consensus probability"
    st.subheader(label)
    chart = df.set_index("team")[[prob_col]].rename(columns={prob_col: "probability"})
    st.bar_chart(chart)

    st.caption(
        "Sources: " + " · ".join(label for _, label, _ in SOURCES)
        + (" · ESPN" if show_stats else "")
        + " — updated " + datetime.now().strftime("%H:%M:%S")
    )

    # Fallback refresh if streamlit-autorefresh isn't installed.
    if auto and "wincast_tick" not in st.session_state:
        time.sleep(config.REFRESH_SECONDS)
        st.rerun()


if __name__ == "__main__":
    main()
