import { generateInsights, InsightsError } from "@/lib/insights";
import type { InsightsRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
// GPT calls can take a while; give the route room beyond the default.
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: InsightsRequest;
  try {
    body = (await request.json()) as InsightsRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body?.keyword || !Array.isArray(body?.rows)) {
    return Response.json(
      { error: "Body must include `keyword` and `rows`." },
      { status: 400 },
    );
  }

  try {
    const insights = await generateInsights({
      keyword: body.keyword,
      rows: body.rows,
      alerts: body.alerts,
      focusTeam: body.focusTeam,
      usedFallback: body.usedFallback,
    });
    return Response.json(insights);
  } catch (err) {
    if (err instanceof InsightsError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("insights route failed:", err);
    return Response.json({ error: "Failed to generate insights." }, { status: 500 });
  }
}
