"""PredictIt API fetcher (public market data, no auth).

PredictIt is a real-money political prediction market. Its public feed dumps
every open market in one call: each market holds one contract per candidate /
outcome, each with a `lastTradePrice` in dollars (0-1) that we read as P(win).
A multi-contract market is already a full field of outcomes, so de-vigging it in
`model.py` strips the small overround the same way it does for the other venues.

PredictIt caps positions at $850 and doesn't expose per-contract volume in this
feed, so we assign a modest *nominal* liquidity (well below the real-money venues)
purely to seat it in the log-liquidity weighting. Tune NOMINAL_LIQUIDITY to taste.

Returns a uniform list of dicts: {"team", "prob", "volume", "source"}.
Always returns [] on failure.
"""

from typing import List, Dict

import requests

try:
    from config import HTTP_TIMEOUT
except ImportError:
    HTTP_TIMEOUT = 12

ALL_MARKETS_URL = "https://www.predictit.org/api/marketdata/all/"

# PredictIt is thin vs. Polymarket/Kalshi; this nominal depth keeps it in the
# pool but lets the deeper real-money venues outweigh it.
NOMINAL_LIQUIDITY = 25_000.0


def _to_float(value, default=None):
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def fetch_outcomes(keyword: str) -> List[Dict]:
    """Fetch per-candidate win probabilities for markets matching `keyword`."""
    keyword = (keyword or "").strip().lower()
    if not keyword:
        return []

    results: List[Dict] = []
    try:
        resp = requests.get(ALL_MARKETS_URL, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        payload = resp.json() or {}
        for market in payload.get("markets", []) or []:
            name = (market.get("name") or "").lower()
            short = (market.get("shortName") or "").lower()
            if keyword not in name and keyword not in short:
                continue
            for contract in market.get("contracts", []) or []:
                prob = _to_float(contract.get("lastTradePrice"))
                if prob is None:
                    # Fall back to the buy-yes cost if no trade has printed.
                    prob = _to_float(contract.get("bestBuyYesCost"))
                if prob is None or prob <= 0.0 or prob >= 1.0:
                    continue
                team = contract.get("name") or contract.get("shortName") or "?"
                results.append(
                    {
                        "team": str(team).strip(),
                        "prob": prob,
                        "volume": NOMINAL_LIQUIDITY,
                        "source": "predictit",
                    }
                )
    except Exception:
        return []

    return results


if __name__ == "__main__":
    import sys

    kw = sys.argv[1] if len(sys.argv) > 1 else "President"
    out = fetch_outcomes(kw)
    print("count:", len(out))
    for row in out[:8]:
        print(row)
