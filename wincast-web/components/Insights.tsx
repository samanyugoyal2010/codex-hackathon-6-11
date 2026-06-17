"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Brain,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type {
  ConsensusRow,
  EventInsights,
  InsightImpact,
  InsightPoint,
} from "@/lib/types";

const IMPACT_DOT: Record<InsightImpact, string> = {
  high: "var(--acid)",
  medium: "var(--ink-dim)",
  low: "var(--ink-faint)",
};

export default function Insights({
  keyword,
  rows,
  alerts,
  usedFallback,
  focusTeam,
}: {
  keyword: string;
  rows: ConsensusRow[];
  alerts: string[];
  usedFallback?: boolean;
  focusTeam?: string;
}) {
  const [insights, setInsights] = useState<EventInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The analysis is tied to a specific event — clear it when the event changes
  // so stale takes never sit under a new keyword.
  useEffect(() => {
    setInsights(null);
    setError(null);
  }, [keyword]);

  const run = useCallback(async () => {
    if (rows.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, rows, alerts, usedFallback, focusTeam }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Analysis failed.");
      setInsights(data as EventInsights);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }, [keyword, rows, alerts, usedFallback, focusTeam]);

  return (
    <section className="panel mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Brain size={16} className="text-[var(--acid)]" />
          <div className="leading-tight">
            <div className="text-sm">GPT event read</div>
            <div className="eyebrow -mt-0.5">what could swing the odds</div>
          </div>
        </div>
        <button
          onClick={run}
          disabled={loading || rows.length === 0}
          className="flex items-center gap-2 rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-xs uppercase tracking-widest text-[var(--ink-dim)] transition hover:border-[var(--acid)] hover:text-[var(--acid)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 size={13} className="animate-spin" /> analyzing
            </>
          ) : insights ? (
            <>
              <Brain size={13} /> re-analyze
            </>
          ) : (
            <>
              <Brain size={13} /> analyze {focusTeam ?? "event"} →
            </>
          )}
        </button>
      </div>

      <div className="px-5 py-4">
        <AnimatePresence mode="wait">
          {error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2 text-xs text-[var(--amber)]"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          ) : insights ? (
            <motion.div
              key={insights.generatedAt}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <p className="text-sm leading-relaxed text-[var(--ink)]/90">
                <span className="text-[var(--acid)]">{insights.team}</span>{" "}
                — {insights.summary}
              </p>

              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                <Column
                  title="What might go right"
                  hint="raises win chances"
                  tone="under"
                  icon={<ArrowUpRight size={14} />}
                  points={insights.upside}
                />
                <Column
                  title="What might go wrong"
                  hint="lowers win chances"
                  tone="over"
                  icon={<ArrowDownRight size={14} />}
                  points={insights.risks}
                />
              </div>

              {insights.watch.length > 0 && (
                <div className="mt-5 border-t border-[var(--line)] pt-4">
                  <div className="mb-2 flex items-center gap-2 eyebrow">
                    <Eye size={13} /> signals to watch
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {insights.watch.map((w) => (
                      <li
                        key={w}
                        className="flex items-start gap-2 text-xs text-[var(--ink-dim)]"
                      >
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--ink-faint)]" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 text-[10.5px] uppercase tracking-widest text-[var(--ink-faint)]">
                {insights.model} · generated{" "}
                {new Date(insights.generatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-[var(--ink-faint)]"
            >
              ◦ Ask GPT to read the current market picture for{" "}
              <span className="text-[var(--ink-dim)]">{focusTeam ?? keyword}</span> —
              it&apos;ll surface the factors that could push the odds up or down.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function Column({
  title,
  hint,
  tone,
  icon,
  points,
}: {
  title: string;
  hint: string;
  tone: "under" | "over";
  icon: React.ReactNode;
  points: InsightPoint[];
}) {
  const color = tone === "under" ? "var(--under)" : "var(--over)";
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{ background: `${color}14`, color }}
        >
          {icon}
        </span>
        <div className="leading-tight">
          <div className="text-xs" style={{ color }}>
            {title}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--ink-faint)]">
            {hint}
          </div>
        </div>
      </div>
      {points.length === 0 ? (
        <div className="text-xs text-[var(--ink-faint)]">— none flagged</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {points.map((p) => (
            <li key={p.point} className="flex items-start gap-2 text-xs leading-relaxed">
              <span
                title={`${p.impact} impact`}
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: IMPACT_DOT[p.impact] }}
              />
              <span className="text-[var(--ink)]/85">{p.point}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
