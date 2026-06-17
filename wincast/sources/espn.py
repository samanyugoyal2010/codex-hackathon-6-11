"""ESPN unofficial public stats API (no auth) — stretch "key stats" panel.

fetch_stats(keyword) -> {normalized_team: {"form": str, "detail": str}}
Never blocks the core: returns {} on any failure.
"""

from typing import Dict

import requests

try:
    from config import HTTP_TIMEOUT
    from model import normalize_team
except ImportError:
    HTTP_TIMEOUT = 12

    def normalize_team(name):
        return (name or "").strip().lower()


SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports"

# Map a tracked-event keyword to an ESPN scoreboard path.
KEYWORD_TO_PATH = {
    "world cup": "soccer/fifa.world",
    "champions league": "soccer/uefa.champions",
    "premier league": "soccer/eng.1",
    "euro": "soccer/uefa.euro",
    "nba": "basketball/nba",
    "nfl": "football/nfl",
}


def _path_for(keyword: str) -> str:
    keyword = (keyword or "").strip().lower()
    for needle, path in KEYWORD_TO_PATH.items():
        if needle in keyword:
            return path
    return "soccer/fifa.world"  # sensible default for the demo


def fetch_stats(keyword: str) -> Dict[str, Dict]:
    """Recent-form snapshot keyed by normalized team name."""
    stats: Dict[str, Dict] = {}
    try:
        path = _path_for(keyword)
        resp = requests.get(
            "{}/{}/scoreboard".format(SITE_BASE, path), timeout=HTTP_TIMEOUT
        )
        resp.raise_for_status()
        for event in resp.json().get("events", []) or []:
            comp = (event.get("competitions") or [{}])[0]
            for c in comp.get("competitors", []) or []:
                team = c.get("team", {}) or {}
                name = team.get("displayName") or team.get("name")
                if not name:
                    continue
                rec = ""
                records = c.get("records") or []
                if records:
                    rec = records[0].get("summary", "")
                stats[normalize_team(name)] = {
                    "form": c.get("form", "") or rec,
                    "detail": "{} {}".format(c.get("score", ""), event.get("shortName", "")).strip(),
                }
    except Exception:
        return {}
    return stats


if __name__ == "__main__":
    import sys

    kw = sys.argv[1] if len(sys.argv) > 1 else "World Cup"
    s = fetch_stats(kw)
    print("teams:", len(s))
    for k, v in list(s.items())[:8]:
        print(k, "->", v)
