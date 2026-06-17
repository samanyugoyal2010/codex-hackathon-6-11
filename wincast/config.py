"""WinCast configuration. Tweak EVENT_KEYWORD live during the demo."""

# What event are we predicting? Just a keyword we filter market titles by.
EVENT_KEYWORD = "World Cup"

# How often the dashboard auto-refreshes (seconds).
REFRESH_SECONDS = 15

# Flag a source as mispriced when it differs from consensus by more than this.
EDGE_THRESHOLD = 0.03  # 3 percentage points

# Network timeout for every API call (seconds).
HTTP_TIMEOUT = 12

# Tiny demo-grade alias map for cross-source team name matching.
# Keys and values are compared lowercased/stripped. Extend as needed.
TEAM_ALIASES = {
    "bra": "brazil",
    "arg": "argentina",
    "fra": "france",
    "eng": "england",
    "esp": "spain",
    "spain": "spain",
    "ger": "germany",
    "deu": "germany",
    "usa": "united states",
    "us": "united states",
    "united states of america": "united states",
    "ned": "netherlands",
    "holland": "netherlands",
    "por": "portugal",
    "uru": "uruguay",
    "bel": "belgium",
}
