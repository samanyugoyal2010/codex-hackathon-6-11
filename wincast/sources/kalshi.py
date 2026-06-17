"""Kalshi Trade API v2 fetcher (public market data, no auth).

IMPORTANT — current API (verified June 2026) differs from older docs:
  * Prices are STRINGS in DOLLARS (0-1), not integer cents:
    last_price_dollars, yes_bid_dollars, yes_ask_dollars.
    => prob = float(last_price_dollars), NOT last_price / 100.
  * Weights: volume_fp, open_interest_fp, liquidity_dollars (also strings).
  * /events?status=open is cursor-paginated; one page won't find a niche event.
  * Market lists contain multi-leg parlay junk (KXMVE... tickers, comma-joined
    yes_sub_title, price 0.0000) -> skip those.

Returns a uniform list of dicts: {"team", "prob", "volume", "source"}.
Always returns [] on failure.
"""

from typing import List, Dict

import requests

try:
    from config import HTTP_TIMEOUT
except ImportError:
    HTTP_TIMEOUT = 12

BASE_URL = "https://external-api.kalshi.com/trade-api/v2"
MAX_EVENT_PAGES = 5  # cap pagination so the demo stays snappy


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _find_events(keyword: str) -> List[Dict]:
    """Cursor-paginate open events and keep those whose title matches keyword."""
    matched: List[Dict] = []
    cursor = None
    for _ in range(MAX_EVENT_PAGES):
        params = {"status": "open", "limit": 200}
        if cursor:
            params["cursor"] = cursor
        resp = requests.get(BASE_URL + "/events", params=params, timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        for event in data.get("events", []) or []:
            title = (event.get("title") or "").lower()
            if keyword in title:
                matched.append(event)
        cursor = data.get("cursor")
        if not cursor:
            break
    return matched


def _is_parlay(market: Dict) -> bool:
    ticker = market.get("ticker") or ""
    sub = market.get("yes_sub_title") or ""
    return ticker.startswith("KXMVE") or "," in sub


def _market_prob(market: Dict):
    """P(win) from last trade, falling back to the bid/ask midpoint."""
    last = _to_float(market.get("last_price_dollars"), 0.0)
    if last > 0.0:
        return last
    bid = _to_float(market.get("yes_bid_dollars"), 0.0)
    ask = _to_float(market.get("yes_ask_dollars"), 0.0)
    if bid > 0.0 or ask > 0.0:
        return (bid + ask) / 2.0
    return None


def fetch_outcomes(keyword: str) -> List[Dict]:
    """Fetch per-team win probabilities for events matching `keyword`."""
    keyword = (keyword or "").strip().lower()
    if not keyword:
        return []

    results: List[Dict] = []
    try:
        for event in _find_events(keyword):
            event_ticker = event.get("event_ticker")
            if not event_ticker:
                continue
            resp = requests.get(
                BASE_URL + "/markets",
                params={"event_ticker": event_ticker, "limit": 200},
                timeout=HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            for market in resp.json().get("markets", []) or []:
                if _is_parlay(market):
                    continue
                prob = _market_prob(market)
                if prob is None or prob <= 0.0 or prob >= 1.0:
                    continue
                team = market.get("yes_sub_title") or market.get("title") or "?"
                volume = _to_float(market.get("volume_fp"), 0.0)
                results.append(
                    {
                        "team": str(team).strip(),
                        "prob": prob,
                        "volume": volume,
                        "source": "kalshi",
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
