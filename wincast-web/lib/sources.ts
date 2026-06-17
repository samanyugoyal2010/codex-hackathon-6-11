// Live market fetchers (run server-side in the API route to avoid CORS).
// Ports of wincast/sources/polymarket.py and kalshi.py.

import type { SourceRow } from "./types";

const HTTP_TIMEOUT = 12_000;
const POLY_BASE = "https://gamma-api.polymarket.com";
const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";

async function getJSON(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function parseStringified(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return [];
}

function toNum(v: unknown, d = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : d;
}

// ---------------------------------------------------------------- Polymarket
export async function fetchPolymarket(keyword: string): Promise<SourceRow[]> {
  const kw = (keyword ?? "").trim().toLowerCase();
  if (!kw) return [];
  try {
    const events: any[] = [];
    for (const offset of [0, 100]) {
      const page = (await getJSON(
        `${POLY_BASE}/events?closed=false&limit=100&offset=${offset}`,
      )) as any[];
      if (!page || page.length === 0) break;
      events.push(...page);
    }

    const out: SourceRow[] = [];
    for (const event of events) {
      const title = String(event?.title ?? "").toLowerCase();
      if (!title.includes(kw)) continue;
      for (const market of event?.markets ?? []) {
        if (market?.closed) continue;
        const outcomes = parseStringified(market?.outcomes);
        const prices = parseStringified(market?.outcomePrices);
        let prob: number | null = null;
        for (let i = 0; i < outcomes.length; i++) {
          if (String(outcomes[i]).trim().toLowerCase() === "yes") {
            prob = toNum(prices[i], NaN);
            break;
          }
        }
        if (prob === null && prices.length) prob = toNum(prices[0], NaN);
        if (prob === null || !Number.isFinite(prob) || prob <= 0 || prob >= 1) continue;
        const team = market?.groupItemTitle || market?.question || "?";
        out.push({
          team: String(team).trim(),
          prob,
          volume: toNum(market?.volumeNum, 0),
          source: "polymarket",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// -------------------------------------------------------------------- Kalshi
const KALSHI_MAX_PAGES = 5;
const KALSHI_MAX_EVENTS = 14; // cap markets calls to avoid rate limits

async function findKalshiEvents(kw: string): Promise<any[]> {
  const matched: any[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < KALSHI_MAX_PAGES; i++) {
    try {
      const url =
        `${KALSHI_BASE}/events?status=open&limit=200` +
        (cursor ? `&cursor=${cursor}` : "");
      const data = (await getJSON(url)) as any;
      for (const ev of data?.events ?? []) {
        if (String(ev?.title ?? "").toLowerCase().includes(kw)) matched.push(ev);
      }
      cursor = data?.cursor;
      if (!cursor) break;
    } catch {
      break; // keep whatever we matched so far
    }
  }
  // Prefer the deepest / most-liquid events; cap to keep request count sane.
  return matched.slice(0, KALSHI_MAX_EVENTS);
}

function isParlay(m: any): boolean {
  const ticker = String(m?.ticker ?? "");
  const sub = String(m?.yes_sub_title ?? "");
  return ticker.startsWith("KXMVE") || sub.includes(",");
}

function kalshiProb(m: any): number | null {
  const last = toNum(m?.last_price_dollars, 0);
  if (last > 0) return last;
  const bid = toNum(m?.yes_bid_dollars, 0);
  const ask = toNum(m?.yes_ask_dollars, 0);
  if (bid > 0 || ask > 0) return (bid + ask) / 2;
  return null;
}

export async function fetchKalshi(keyword: string): Promise<SourceRow[]> {
  const kw = (keyword ?? "").trim().toLowerCase();
  if (!kw) return [];
  try {
    const events = await findKalshiEvents(kw);
    // Fetch each event's markets independently — one failure must not drop the rest.
    const perEvent = await Promise.all(
      events.map(async (event) => {
        const ticker = event?.event_ticker;
        if (!ticker) return [] as SourceRow[];
        try {
          const data = (await getJSON(
            `${KALSHI_BASE}/markets?event_ticker=${encodeURIComponent(ticker)}&limit=200`,
          )) as any;
          const rows: SourceRow[] = [];
          for (const m of data?.markets ?? []) {
            if (isParlay(m)) continue;
            const prob = kalshiProb(m);
            if (prob === null || prob <= 0 || prob >= 1) continue;
            rows.push({
              team: String(m?.yes_sub_title || m?.title || "?").trim(),
              prob,
              volume: toNum(m?.volume_fp, 0),
              source: "kalshi",
            });
          }
          return rows;
        } catch {
          return [] as SourceRow[];
        }
      }),
    );
    return perEvent.flat();
  } catch {
    return [];
  }
}

// Known-good fallback so the demo always shows something.
export const FALLBACK_POLY: SourceRow[] = [
  { team: "Brazil", prob: 0.21, volume: 1_200_000, source: "polymarket" },
  { team: "France", prob: 0.18, volume: 900_000, source: "polymarket" },
  { team: "Spain", prob: 0.15, volume: 700_000, source: "polymarket" },
  { team: "England", prob: 0.13, volume: 650_000, source: "polymarket" },
  { team: "Argentina", prob: 0.12, volume: 800_000, source: "polymarket" },
];
export const FALLBACK_KALSHI: SourceRow[] = [
  { team: "Brazil", prob: 0.25, volume: 400_000, source: "kalshi" },
  { team: "France", prob: 0.17, volume: 300_000, source: "kalshi" },
  { team: "Argentina", prob: 0.14, volume: 350_000, source: "kalshi" },
];
