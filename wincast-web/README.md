# 🏆 WinCast — web (Next.js)

A polished, real-time **win-probability terminal**. The Next.js front end for WinCast:
it pulls live Polymarket + Kalshi odds, de-vigs them, blends them with a **logarithmic
opinion pool**, applies the trained **ML calibration** model, and renders it all in a dark
"signal terminal" UI.

This is a TypeScript port of the Python app in `../wincast` — same model, no Python runtime
needed (the trained logistic-calibration weights are baked into `lib/calibration.ts`).

## Run

```bash
cd codex-hackathon/wincast-web
npm install
npm run dev
```

Open <http://localhost:3000>. Type any event keyword (World Cup, President, Champions…) or
click a suggestion; the dashboard auto-refreshes every 15s.

## How it works

- **`app/api/markets/route.ts`** — server route. Fetches both venues server-side (avoids CORS),
  runs the consensus + calibration pipeline, returns JSON.
- **`lib/sources.ts`** — Polymarket Gamma + Kalshi Trade v2 fetchers (current API: dollar
  prices, cursor pagination, parlay-skip, per-call resilience + cached fallback).
- **`lib/model.ts`** — de-vig → logarithmic opinion pool (log-liquidity weighted) → edges + uncertainty.
- **`lib/calibration.ts`** — the trained model's forward pass (StandardScaler + logistic),
  weights exported from `../wincast/wincast_model.joblib`. Corrects favorite–longshot bias.
- **`components/Dashboard.tsx`** — the UI: editable headline event, live favorite card,
  stat stack, edge alerts, and an animated probability table.

## Design

Dark warm-charcoal "signal terminal" aesthetic — **Instrument Serif** display paired with
**IBM Plex Mono** for data, a single acid-lime accent, diverging coral/green for over/under
pricing, grain + grid texture, and spring-animated probability bars.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · Motion · lucide-react.
