import { NextRequest } from "next/server";
import { consensus, edgeAlerts } from "@/lib/model";
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

  let [poly, kalshi] = await Promise.all([
    fetchPolymarket(keyword),
    fetchKalshi(keyword),
  ]);

  let usedFallback = false;
  if (poly.length === 0 && kalshi.length === 0) {
    poly = FALLBACK_POLY;
    kalshi = FALLBACK_KALSHI;
    usedFallback = true;
  }

  const rows = refine(consensus([poly, kalshi]));
  const alerts = edgeAlerts(rows);

  const body: MarketsResponse = {
    keyword,
    usedFallback,
    counts: { polymarket: poly.length, kalshi: kalshi.length },
    rows,
    alerts,
    metrics: MODEL_METRICS,
    updatedAt: new Date().toISOString(),
  };

  return Response.json(body);
}
