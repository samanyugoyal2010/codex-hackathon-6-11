import { NextRequest } from "next/server";
import { consensus, edgeAlerts, normalizeTeam } from "@/lib/model";
import { refine, MODEL_METRICS } from "@/lib/calibration";
import {
  fetchPolymarket,
  fetchKalshi,
  FALLBACK_POLY,
  FALLBACK_KALSHI,
} from "@/lib/sources";
import type { MarketsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const keyword = (request.nextUrl.searchParams.get("keyword") || "World Cup").trim();

  const [poly, kalshi] = await Promise.all([
    fetchPolymarket(keyword),
    fetchKalshi(keyword),
  ]);

  let polyRows = poly.rows;
  let kalshiRows = kalshi.rows;
  let events = { polymarket: poly.eventTitle, kalshi: kalshi.eventTitle };

  // Cross-source alignment: only pool both venues when they're the SAME contest
  // (share at least one candidate). Otherwise we'd blend unrelated races (e.g.
  // a US nominee market with a foreign presidential race). Keep the deeper one.
  if (polyRows.length > 0 && kalshiRows.length > 0) {
    const polyTeams = new Set(polyRows.map((r) => normalizeTeam(r.team)));
    const aligned = kalshiRows.some((r) => polyTeams.has(normalizeTeam(r.team)));
    if (!aligned) {
      const polyVol = polyRows.reduce((s, r) => s + r.volume, 0);
      const kalshiVol = kalshiRows.reduce((s, r) => s + r.volume, 0);
      if (polyVol >= kalshiVol) {
        kalshiRows = [];
        events = { ...events, kalshi: null };
      } else {
        polyRows = [];
        events = { ...events, polymarket: null };
      }
    }
  }

  let usedFallback = false;
  if (polyRows.length === 0 && kalshiRows.length === 0) {
    polyRows = FALLBACK_POLY;
    kalshiRows = FALLBACK_KALSHI;
    events = { polymarket: "World Cup Winner (cached)", kalshi: "World Cup Winner (cached)" };
    usedFallback = true;
  }

  const rows = refine(consensus([polyRows, kalshiRows]));
  const alerts = edgeAlerts(rows);

  const body: MarketsResponse = {
    keyword,
    usedFallback,
    counts: { polymarket: polyRows.length, kalshi: kalshiRows.length },
    events,
    rows,
    alerts,
    metrics: MODEL_METRICS,
    updatedAt: new Date().toISOString(),
  };

  return Response.json(body);
}
