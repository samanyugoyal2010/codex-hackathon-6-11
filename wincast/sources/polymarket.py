"""Polymarket Gamma API fetcher (public, no auth).

Returns a uniform list of dicts: {"team", "prob", "volume", "source"}.
Always returns [] on failure so a flaky API never crashes the demo.
"""

import json
from typing import List, Dict

import requests

try:
    from config import HTTP_TIMEOUT
except ImportError:  # allow `python sources/polymarket.py` style imports too
    HTTP_TIMEOUT = 12

BASE_URL = "https://gamma-api.polymarket.com"


def _parse_stringified(value):
    """Polymarket returns outcomes/outcomePrices as stringified JSON arrays."""
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return []
    return []


def _yes_prob(outcomes, prices):
    """Pick the price corresponding to the 'Yes' outcome (P(win))."""
    for name, price in zip(outcomes, prices):
        if str(name).strip().lower() == "yes":
            try:
                return float(price)
            except (ValueError, TypeError):
                return None
    # Fallback: first price if labels are unexpected.
    if prices:
        try:
            return float(prices[0])
        except (ValueError, TypeError):
            return None
    return None


def fetch_outcomes(keyword: str) -> List[Dict]:
    """Fetch per-team win probabilities for events matching `keyword`."""
    keyword = (keyword or "").strip().lower()
    if not keyword:
        return []

    results: List[Dict] = []
    try:
        events = []
        # Two pages of 100 for a bit more coverage; API caps page size at 100.
        for offset in (0, 100):
            resp = requests.get(
                BASE_URL + "/events",
                params={"closed": "false", "limit": 100, "offset": offset},
                timeout=HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            page = resp.json()
            if not page:
                break
            events.extend(page)

        for event in events:
            title = (event.get("title") or "").lower()
            if keyword not in title:
                continue
            for market in event.get("markets", []) or []:
                if market.get("closed"):
                    continue
                outcomes = _parse_stringified(market.get("outcomes"))
                prices = _parse_stringified(market.get("outcomePrices"))
                prob = _yes_prob(outcomes, prices)
                if prob is None:
                    continue
                # Skip resolved / dead markets at the extremes.
                if prob <= 0.0 or prob >= 1.0:
                    continue
                team = market.get("groupItemTitle") or market.get("question") or "?"
                try:
                    volume = float(market.get("volumeNum") or 0)
                except (ValueError, TypeError):
                    volume = 0.0
                results.append(
                    {
                        "team": str(team).strip(),
                        "prob": prob,
                        "volume": volume,
                        "source": "polymarket",
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
