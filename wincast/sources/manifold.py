"""Manifold Markets API fetcher (public, no auth).

Manifold is a large play-money prediction market with a fully open REST API.
We search its binary markets and read each market's live `probability`.

Because it's play-money, its dollar-equivalent depth is much smaller than the
real-money venues, so the log-liquidity weighting in `model.py` naturally lets
it count for less without us hard-coding any down-weight.

Returns a uniform list of dicts: {"team", "prob", "volume", "source"}.
Always returns [] on failure so a flaky API never crashes the demo.
"""

import re
from typing import List, Dict

import requests

try:
    from config import HTTP_TIMEOUT
except ImportError:  # allow `python sources/manifold.py` style imports too
    HTTP_TIMEOUT = 12

BASE_URL = "https://api.manifold.markets/v0"
MAX_MARKETS = 60  # cap so the live fetch stays snappy

# "Will Brazil win the 2026 World Cup?" -> "Brazil"
_WIN_RE = re.compile(r"\bwill\s+(.+?)\s+win\b", re.IGNORECASE)


def _team_from_question(question: str) -> str:
    """Best-effort contestant name from a binary-market question."""
    q = (question or "").strip()
    m = _WIN_RE.search(q)
    if m:
        return m.group(1).strip().strip("?.")
    return q.rstrip("?").strip()


def fetch_outcomes(keyword: str) -> List[Dict]:
    """Fetch per-contestant win probabilities for markets matching `keyword`."""
    keyword = (keyword or "").strip()
    if not keyword:
        return []

    results: List[Dict] = []
    try:
        resp = requests.get(
            BASE_URL + "/search-markets",
            params={
                "term": keyword,
                "filter": "open",
                "contractType": "BINARY",
                "sort": "liquidity",
                "limit": MAX_MARKETS,
            },
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        for market in resp.json() or []:
            # Only binary markets expose a single scalar `probability`.
            if market.get("outcomeType") not in (None, "BINARY"):
                continue
            prob = market.get("probability")
            if prob is None:
                continue
            try:
                prob = float(prob)
            except (ValueError, TypeError):
                continue
            if prob <= 0.0 or prob >= 1.0:
                continue
            question = market.get("question") or ""
            # Keep it on-topic: the search is fuzzy, so require the keyword.
            if keyword.lower() not in question.lower():
                continue
            try:
                volume = float(market.get("volume") or 0)
            except (ValueError, TypeError):
                volume = 0.0
            results.append(
                {
                    "team": _team_from_question(question),
                    "prob": prob,
                    "volume": volume,
                    "source": "manifold",
                }
            )
    except Exception:
        return []

    return results


if __name__ == "__main__":
    import sys

    kw = sys.argv[1] if len(sys.argv) > 1 else "World Cup"
    out = fetch_outcomes(kw)
    print("count:", len(out))
    for row in out[:8]:
        print(row)
