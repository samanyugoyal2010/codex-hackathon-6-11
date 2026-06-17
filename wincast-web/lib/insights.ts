// GPT-powered event analysis.
//
// Given the pooled market picture for an event, ask OpenAI to surface the key
// things to notice: what might go RIGHT (raise the contender's win chances) and
// what might go WRONG (lower them), plus concrete signals to watch.
//
// Talks to the OpenAI Chat Completions API directly via fetch so there's no SDK
// dependency. The model is configurable through OPENAI_MODEL (default gpt-5.5).

import type {
  ConsensusRow,
  EventInsights,
  InsightPoint,
  InsightImpact,
} from "./types";
import { pct, signedPct } from "./format";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.5";
const REQUEST_TIMEOUT = 30_000;

export class InsightsError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "InsightsError";
  }
}

const IMPACTS: InsightImpact[] = ["high", "medium", "low"];
const asImpact = (v: unknown): InsightImpact =>
  IMPACTS.includes(v as InsightImpact) ? (v as InsightImpact) : "medium";

function asPoints(value: unknown): InsightPoint[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): InsightPoint | null => {
      if (typeof item === "string") return { point: item, impact: "medium" };
      if (item && typeof item === "object") {
        const point = String((item as any).point ?? "").trim();
        if (!point) return null;
        return { point, impact: asImpact((item as any).impact) };
      }
      return null;
    })
    .filter((p): p is InsightPoint => p !== null)
    .slice(0, 5);
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

/** Compact, readable table of the current market picture for the prompt. */
function renderRows(rows: ConsensusRow[]): string {
  return rows
    .slice(0, 12)
    .map((r, i) => {
      const edge = r.edgeKalshi ?? r.edgePoly;
      return (
        `${i + 1}. ${r.team}: consensus ${pct(r.consensus)}, ` +
        `ML-calibrated ${pct(r.refined)}, ` +
        `Polymarket ${pct(r.pPoly)}, Kalshi ${pct(r.pKalshi)}, ` +
        `cross-market spread ${pct(r.uncertainty)}, edge ${signedPct(edge)}`
      );
    })
    .join("\n");
}

function buildPrompt(
  keyword: string,
  focus: ConsensusRow,
  rows: ConsensusRow[],
  alerts: string[],
  usedFallback: boolean,
): string {
  const lines = [
    `Event: "${keyword}" — forecasting the winner.`,
    `Focus contender: ${focus.team}.`,
    "",
    "Current market picture (probabilities are win chances):",
    renderRows(rows),
  ];
  if (alerts.length) {
    lines.push("", "Detected pricing edges between venues:", ...alerts.map((a) => `- ${a}`));
  }
  if (usedFallback) {
    lines.push(
      "",
      "NOTE: live feeds were empty, so this is a cached snapshot — flag that the read may be stale.",
    );
  }
  lines.push(
    "",
    `Analyze ${focus.team}'s position. Identify the key things to notice:`,
    "- upside: factors that might go RIGHT and raise their win probability",
    "- risks: factors that might go WRONG and lower their win probability",
    "- watch: concrete signals to monitor next",
    "Ground every point in the numbers above (the spread between venues, the edges,",
    "how far ahead/behind they are, ML vs market disagreement). Be specific and concise.",
  );
  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You are WinCast's market analyst. You read pooled prediction-market data for an " +
  "event and explain, in plain language, what could push a contender's win probability " +
  "up or down. Be concrete, quantitative, and honest about uncertainty. Never invent " +
  "facts not supported by the supplied numbers. Respond ONLY with JSON matching this " +
  "shape: {\"summary\": string, \"upside\": [{\"point\": string, \"impact\": \"high\"|\"medium\"|\"low\"}], " +
  "\"risks\": [{\"point\": string, \"impact\": \"high\"|\"medium\"|\"low\"}], \"watch\": [string]}. " +
  "Provide 2-4 items each for upside and risks, and 2-3 for watch.";

export async function generateInsights(opts: {
  keyword: string;
  rows: ConsensusRow[];
  alerts?: string[];
  focusTeam?: string;
  usedFallback?: boolean;
}): Promise<EventInsights> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new InsightsError(
      "OPENAI_API_KEY is not set. Add it to wincast-web/.env.local and restart the dev server.",
      503,
    );
  }

  const rows = opts.rows ?? [];
  if (rows.length === 0) {
    throw new InsightsError("No market rows to analyze.", 400);
  }

  const focus =
    rows.find((r) => r.team.toLowerCase() === opts.focusTeam?.trim().toLowerCase()) ??
    rows[0];

  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const userPrompt = buildPrompt(
    opts.keyword,
    focus,
    rows,
    opts.alerts ?? [],
    !!opts.usedFallback,
  );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new InsightsError("OpenAI request timed out.", 504);
    }
    throw new InsightsError("Could not reach OpenAI.", 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const snippet = detail.slice(0, 300);
    throw new InsightsError(
      `OpenAI API error (${res.status})${snippet ? `: ${snippet}` : ""}`,
      res.status === 401 ? 401 : 502,
    );
  }

  const payload = (await res.json()) as any;
  const content: string = payload?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new InsightsError("OpenAI returned an empty response.", 502);

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new InsightsError("OpenAI returned malformed JSON.", 502);
  }

  return {
    team: focus.team,
    summary: String(parsed?.summary ?? "").trim() || "No summary returned.",
    upside: asPoints(parsed?.upside),
    risks: asPoints(parsed?.risks),
    watch: asStrings(parsed?.watch),
    model,
    generatedAt: new Date().toISOString(),
  };
}
