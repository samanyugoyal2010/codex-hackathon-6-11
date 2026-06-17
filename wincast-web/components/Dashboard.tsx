"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  Radio,
  TrendingUp,
  TrendingDown,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import type { MarketsResponse, ConsensusRow } from "@/lib/types";
import { pct, signedPct, compactVolume } from "@/lib/format";
import Insights from "@/components/Insights";

const REFRESH_MS = 15_000;
const SUGGESTIONS = ["World Cup", "Election", "President", "Nobel"];

export default function Dashboard() {
  const [keyword, setKeyword] = useState("World Cup");
  const [draft, setDraft] = useState("World Cup");
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [useMl, setUseMl] = useState(true);
  const [auto, setAuto] = useState(true);
  const [threshold, setThreshold] = useState(0.03);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (kw: string) => {
    try {
      setError(false);
      const res = await fetch(`/api/markets?keyword=${encodeURIComponent(kw)}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(keyword);
  }, [keyword, load]);

  useEffect(() => {
    if (!auto) return;
    timer.current = setInterval(() => load(keyword), REFRESH_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, keyword, load]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (v) setKeyword(v);
  };

  const rows = data?.rows ?? [];
  const probKey: "consensus" | "refined" = useMl ? "refined" : "consensus";
  const visibleAlerts = (data?.alerts ?? []).filter((a) => {
    const m = a.match(/by ([\d.]+)%/);
    return m ? parseFloat(m[1]) / 100 > threshold : true;
  });
  const top = rows[0];
  const max = rows.reduce((m, r) => Math.max(m, r[probKey]), 0) || 1;

  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 pb-24 pt-8 sm:px-8">
      <Header updatedAt={data?.updatedAt} live={auto && !error} loading={loading} />

      {/* event keyword — large editable display */}
      <form onSubmit={submit} className="mt-10">
        <span className="eyebrow">Forecasting the winner of</span>
        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-2">
          <input
            className="kw min-w-[6ch] flex-1 text-[clamp(2.4rem,7vw,4.6rem)] leading-[0.95] italic"
            style={{ width: `${Math.max(draft.length, 4)}ch` }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            aria-label="Event keyword"
          />
          <button
            type="submit"
            className="mb-2 rounded-full border border-[var(--line-strong)] px-4 py-1.5 text-xs uppercase tracking-widest text-[var(--ink-dim)] transition hover:border-[var(--acid)] hover:text-[var(--acid)]"
          >
            cast →
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setDraft(s);
                setKeyword(s);
              }}
              className={`rounded-full border px-3 py-1 text-[11px] tracking-wide transition ${
                keyword.toLowerCase() === s.toLowerCase()
                  ? "border-[var(--acid)] text-[var(--acid)]"
                  : "border-[var(--line)] text-[var(--ink-faint)] hover:text-[var(--ink-dim)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      {data && (data.events.polymarket || data.events.kalshi) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-[var(--ink-faint)]">
          <span className="eyebrow">matched market</span>
          {data.events.polymarket && (
            <span>
              <span className="text-[var(--ink-dim)]">Polymarket</span> ·{" "}
              {data.events.polymarket}
            </span>
          )}
          {data.events.kalshi && (
            <span>
              <span className="text-[var(--ink-dim)]">Kalshi</span> ·{" "}
              {data.events.kalshi}
            </span>
          )}
        </div>
      )}

      <Controls
        useMl={useMl}
        setUseMl={setUseMl}
        auto={auto}
        setAuto={setAuto}
        threshold={threshold}
        setThreshold={setThreshold}
      />

      {/* hero + stats */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
        <HeadlinePick top={top} probKey={probKey} loading={loading} />
        <StatStack data={data} useMl={useMl} rowCount={rows.length} />
      </section>

      {/* edge alerts */}
      <EdgeStrip alerts={visibleAlerts} fallback={data?.usedFallback} />

      {/* GPT event analysis */}
      <Insights
        keyword={data?.keyword ?? keyword}
        rows={rows}
        alerts={data?.alerts ?? []}
        usedFallback={data?.usedFallback}
        focusTeam={top?.team}
      />

      {/* probability table */}
      <ProbTable rows={rows} probKey={probKey} max={max} useMl={useMl} loading={loading} />

      <Footer data={data} useMl={useMl} error={error} />
    </main>
  );
}

/* ----------------------------------------------------------------- Header */
function Header({
  updatedAt,
  live,
  loading,
}: {
  updatedAt?: string;
  live: boolean;
  loading: boolean;
}) {
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line-strong)] bg-[var(--acid-soft)]">
          <Activity size={18} className="text-[var(--acid)]" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-2xl italic">WinCast</div>
          <div className="eyebrow -mt-0.5">win-probability terminal</div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--ink-dim)]">
        <span className="relative flex h-2 w-2">
          {live && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--under)] opacity-70" />
          )}
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ background: live ? "var(--under)" : "var(--ink-faint)" }}
          />
        </span>
        <Radio size={13} className={loading ? "animate-pulse" : ""} />
        <span className="tnum">{time}</span>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- Controls */
function Controls(props: {
  useMl: boolean;
  setUseMl: (v: boolean) => void;
  auto: boolean;
  setAuto: (v: boolean) => void;
  threshold: number;
  setThreshold: (v: number) => void;
}) {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-3">
      <Toggle
        on={props.useMl}
        onClick={() => props.setUseMl(!props.useMl)}
        icon={<Sparkles size={13} />}
        label="ML calibration"
      />
      <Toggle
        on={props.auto}
        onClick={() => props.setAuto(!props.auto)}
        icon={<RefreshCw size={13} />}
        label="Auto-refresh"
      />
      <div className="flex items-center gap-3 rounded-full border border-[var(--line)] px-4 py-1.5">
        <span className="text-[11px] uppercase tracking-widest text-[var(--ink-faint)]">
          edge ≥
        </span>
        <input
          type="range"
          min={0}
          max={0.1}
          step={0.005}
          value={props.threshold}
          onChange={(e) => props.setThreshold(parseFloat(e.target.value))}
          className="accent-[var(--acid)]"
        />
        <span className="tnum w-9 text-xs text-[var(--ink-dim)]">
          {(props.threshold * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs tracking-wide transition ${
        on
          ? "border-[var(--acid)] bg-[var(--acid-soft)] text-[var(--acid)]"
          : "border-[var(--line)] text-[var(--ink-faint)] hover:text-[var(--ink-dim)]"
      }`}
    >
      {icon}
      {label}
      <span className="tnum">{on ? "ON" : "OFF"}</span>
    </button>
  );
}

/* ----------------------------------------------------------- Headline pick */
function HeadlinePick({
  top,
  probKey,
  loading,
}: {
  top?: ConsensusRow;
  probKey: "consensus" | "refined";
  loading: boolean;
}) {
  return (
    <div className="panel relative overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--acid), transparent 70%)" }}
      />
      <span className="eyebrow">Projected winner</span>
      {top ? (
        <motion.div
          key={top.team}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="font-display mt-1 text-[clamp(2rem,5vw,3.2rem)] leading-none">
            {top.team}
          </div>
          <div className="mt-5 flex items-end gap-4">
            <div
              className="font-display text-[clamp(4rem,13vw,8rem)] leading-[0.8] text-[var(--acid)]"
              style={{ textShadow: "0 0 60px rgba(200,242,58,0.25)" }}
            >
              {pct(top[probKey], 1)}
            </div>
            <div className="mb-3 text-xs leading-relaxed text-[var(--ink-dim)]">
              <div>{probKey === "refined" ? "ML-calibrated" : "pooled"} win prob.</div>
              <div className="text-[var(--ink-faint)]">
                ± {pct(top.uncertainty, 1)} cross-market
              </div>
            </div>
          </div>
          <div className="track mt-6 h-1.5 w-full">
            <motion.div
              className="fill"
              initial={{ width: 0 }}
              animate={{ width: `${top[probKey] * 100}%` }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: "linear-gradient(90deg, rgba(200,242,58,0.4), var(--acid))",
                boxShadow: "0 0 20px rgba(200,242,58,0.45)",
              }}
            />
          </div>
        </motion.div>
      ) : (
        <div className="font-display mt-6 text-5xl text-[var(--ink-faint)]">
          {loading ? "reading markets…" : "no market"}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Stat stack */
function StatStack({
  data,
  useMl,
  rowCount,
}: {
  data: MarketsResponse | null;
  useMl: boolean;
  rowCount: number;
}) {
  const m = data?.metrics;
  return (
    <div className="grid grid-cols-2 gap-4">
      <Stat
        label="Markets blended"
        value={`${data?.counts.polymarket ?? 0}·${data?.counts.kalshi ?? 0}`}
        sub="polymarket · kalshi"
      />
      <Stat label="Outcomes" value={String(rowCount)} sub="teams tracked" />
      <Stat
        label="Sources"
        value={data?.counts.kalshi ? "2" : "1"}
        sub={data?.counts.kalshi ? "dual-venue pool" : "single venue"}
        accent={!!data?.counts.kalshi}
      />
      <Stat
        label={useMl ? "ML lift" : "Calibration"}
        value={useMl ? `+${m?.logloss_improvement_vs_single_pct ?? "—"}%` : "off"}
        sub={useMl ? "log-loss vs 1 market" : "pooled only"}
        accent={useMl}
      />
      {useMl && m?.truth_summary && (
        <div className="panel col-span-2 flex items-center gap-3 px-4 py-3 text-xs text-[var(--ink-dim)]">
          <Sparkles size={14} className="shrink-0 text-[var(--acid)]" />
          {m.truth_summary}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="panel px-4 py-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`font-display mt-1 text-3xl tnum ${accent ? "text-[var(--acid)]" : ""}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[var(--ink-faint)]">{sub}</div>
    </div>
  );
}

/* -------------------------------------------------------------- Edge strip */
function EdgeStrip({
  alerts,
  fallback,
}: {
  alerts: string[];
  fallback?: boolean;
}) {
  return (
    <div className="mt-4">
      {fallback && (
        <div className="mb-3 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/5 px-4 py-2 text-xs text-[var(--amber)]">
          ⚠ Live feed empty — showing cached snapshot.
        </div>
      )}
      <AnimatePresence mode="popLayout">
        {alerts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => {
              const under = a.includes("underpricing");
              return (
                <motion.div
                  key={a}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
                  style={{
                    borderColor: under ? "rgba(79,224,155,0.4)" : "rgba(255,106,90,0.4)",
                    color: under ? "var(--under)" : "var(--over)",
                    background: under ? "rgba(79,224,155,0.06)" : "rgba(255,106,90,0.06)",
                  }}
                >
                  {under ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                  {a}
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-[var(--ink-faint)]">
            ◦ Markets in agreement — no edges above threshold.
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------- Prob table */
function ProbTable({
  rows,
  probKey,
  max,
  useMl,
  loading,
}: {
  rows: ConsensusRow[];
  probKey: "consensus" | "refined";
  max: number;
  useMl: boolean;
  loading: boolean;
}) {
  return (
    <div className="panel mt-5 overflow-hidden">
      <div className="grid grid-cols-[1.4fr_repeat(3,minmax(0,0.7fr))_1.6fr] items-center gap-3 border-b border-[var(--line)] px-5 py-3 text-[10.5px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
        <div>Team</div>
        <div className="text-right">Poly</div>
        <div className="text-right">Kalshi</div>
        <div className="text-right">{useMl ? "ML" : "Pool"}</div>
        <div className="pl-2">Probability · edge</div>
      </div>

      {loading && rows.length === 0 && (
        <div className="px-5 py-10 text-center text-sm text-[var(--ink-faint)]">
          reading order books…
        </div>
      )}

      {rows.map((r, i) => {
        const p = r[probKey];
        const w = `${(p / max) * 100}%`;
        const lead = i === 0;
        // bars stay acid-tinted across the field, brightest at the top
        const intensity = Math.max(0.22, 1 - i * 0.07);
        const edge = r.edgeKalshi ?? r.edgePoly;
        const under = edge !== null && edge < 0;
        const rankColor =
          i === 0 ? "var(--acid)" : i < 3 ? "var(--ink-dim)" : "var(--ink-faint)";
        return (
          <motion.div
            key={r.team}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: Math.min(i * 0.025, 0.4) }}
            className="group relative grid grid-cols-[1.4fr_repeat(3,minmax(0,0.7fr))_1.6fr] items-center gap-3 border-b border-[var(--line)] px-5 py-3 transition-colors last:border-0 hover:bg-[var(--panel-strong)]"
            style={lead ? { background: "rgba(200,242,58,0.035)" } : undefined}
          >
            {lead && (
              <span className="absolute left-0 top-0 h-full w-[2px] bg-[var(--acid)]" />
            )}
            <div className="flex items-center gap-2.5 truncate">
              <span className="tnum w-5 text-[13px]" style={{ color: rankColor }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={`truncate ${lead ? "text-[var(--ink)]" : "text-[var(--ink)]/85"}`}>
                {r.team}
              </span>
            </div>
            <div className="tnum text-right text-[var(--ink-dim)]">{pct(r.pPoly)}</div>
            <div className="tnum text-right text-[var(--ink-dim)]">{pct(r.pKalshi)}</div>
            <div
              className={`tnum text-right ${lead ? "text-[var(--acid)]" : "text-[var(--ink)]"}`}
            >
              {pct(p)}
            </div>
            <div className="flex items-center gap-3 pl-2">
              <div className="track h-2.5 flex-1">
                <motion.div
                  className="fill"
                  initial={{ width: 0 }}
                  animate={{ width: w }}
                  style={{
                    background: `linear-gradient(90deg, rgba(200,242,58,${intensity * 0.45}), rgba(200,242,58,${intensity}))`,
                    boxShadow: lead ? "0 0 18px rgba(200,242,58,0.4)" : "none",
                  }}
                />
              </div>
              <span
                className="tnum w-14 text-right text-[11px]"
                style={{
                  color:
                    edge === null
                      ? "var(--ink-faint)"
                      : under
                        ? "var(--under)"
                        : "var(--over)",
                }}
              >
                {signedPct(edge)}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Footer */
function Footer({
  data,
  useMl,
  error,
}: {
  data: MarketsResponse | null;
  useMl: boolean;
  error: boolean;
}) {
  return (
    <footer className="mt-8 flex flex-col gap-1 text-[11px] text-[var(--ink-faint)]">
      <div>
        pipeline · de-vig → logarithmic opinion pool (log-liquidity weighted)
        {useMl ? " → ML calibration (favorite–longshot correction)" : ""}
      </div>
      <div>
        sources · Polymarket Gamma API · Kalshi Trade API v2
        {error ? " · ⚠ connection error" : ""} · vol{" "}
        {compactVolume(
          (data?.rows ?? []).reduce((a, r) => a + (r.volume || 0), 0),
        )}
      </div>
    </footer>
  );
}
