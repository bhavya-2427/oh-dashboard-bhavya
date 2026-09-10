import React, { useEffect, useMemo, useState } from "react";
import { getCheckDeepDive } from "../api";

const TL_COLOR_PALETTE = ["#4C7EA8", "#B08A2E", "#4C8A63", "#8B5FA3", "#A6403D", "#3F8F8A"];

function BackButton({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600,
        padding: "8px 16px", borderRadius: 7,
        border: `1.5px solid ${hover ? "#C9A227" : "#1F2A44"}`,
        background: hover ? "#1F2A44" : "transparent",
        color: hover ? "#F3C94F" : "#1F2A44",
        cursor: "pointer", transition: "all 0.15s ease",
      }}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>←</span> Back to dashboard
    </button>
  );
}

function colorForTl(tlName, tlNames) {
  if (tlName === "Unassigned") return "#8A7F6B";
  const idx = tlNames.filter((n) => n !== "Unassigned").indexOf(tlName);
  return TL_COLOR_PALETTE[(idx < 0 ? 0 : idx) % TL_COLOR_PALETTE.length];
}

const RANGES = [
  ["1w", "1 Week"], ["2w", "2 Weeks"], ["3w", "3 Weeks"],
  ["4w", "4 Weeks"], ["month", "Monthly"], ["quarter", "Quarterly"],
];

function formatShortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function monthYearLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function quarterYearLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} '${String(d.getFullYear()).slice(2)}`;
}
function periodLabelLines(point, range) {
  const anchor = point.period_start || point.date;
  if (range === "month") return [monthYearLabel(anchor), ""];
  if (range === "quarter") return [quarterYearLabel(anchor), ""];
  if (point.period_start && point.period_end && point.period_start !== point.period_end) {
    return [formatShortDate(point.period_start), `– ${formatShortDate(point.period_end)}`];
  }
  return [formatShortDate(point.date), ""];
}

// Bar-chart version of the small per-metric trend widget. Each period is a
// distinct labeled bar, value printed above the bar, latest period drawn
// solid/bold and older ones dimmed. A point with has_data === false (no
// Excel uploaded anywhere in that period) renders as a faint dashed
// placeholder instead of a real bar, rather than showing a misleading 0.
//
// Label shape and sizing key off `range`, not just point count — Monthly
// always has 12 bars needing short single-line rotated labels, while
// 2/3/4-Week have 2-4 bars that can afford a two-line date range.
function MiniTrendChart({ points, get, color, range, height = 168 }) {
  const dense = points.length > 6; // month (12) — needs tight spacing + short labels
  const barGap = dense ? 10 : points.length <= 2 ? 40 : points.length <= 4 ? 26 : 16;
  const barWidth = dense ? 24 : points.length <= 2 ? 64 : points.length <= 4 ? 46 : 30;
  const width = Math.max(220, points.length * (barWidth + barGap) + barGap);
  const values = points.map((p) => (p.has_data === false ? null : (get(p) || 0)));
  const knownValues = values.filter((v) => v !== null);
  const maxVal = Math.max(1, ...(knownValues.length ? knownValues : [0]));
  const padTop = 34, padBottom = dense ? 28 : 40, padX = barGap;
  const plotH = height - padTop - padBottom;

  const xFor = (i) => padX + i * (barWidth + barGap);
  const hFor = (v) => (v / maxVal) * plotH;

  const latestKnown = [...values].reverse().find((v) => v !== null);
  const latest = latestKnown ?? 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 23, fontWeight: 600, color: "var(--ink)" }}>
          {latest}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", width: "100%", height }}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={width} y1={padTop + f * plotH} y2={padTop + f * plotH} stroke="#EEE9DC" strokeWidth={1} />
        ))}

        {/* Delta badges — skipped entirely in dense (Monthly) mode; with 12
            bars there's no room for 11 delta labels without collision, and
            the numbers printed on each bar already convey the trend. */}
        {!dense && points.map((p, i) => {
          if (i === 0) return null;
          const prevV = values[i - 1];
          const v = values[i];
          if (prevV === null || v === null) return null;
          const delta = v - prevV;
          const deltaLabel = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
          const deltaColor = delta > 0 ? "#A6403D" : delta < 0 ? "#4C8A63" : "#6B6558";
          const gapX = xFor(i - 1) + barWidth + barGap / 2;
          return (
            <text key={`delta-${p.date}`} x={gapX} y={16} textAnchor="middle" fontSize="10.5"
              fontFamily="'IBM Plex Mono',monospace" fontWeight={800} fill={deltaColor}>
              {deltaLabel}
            </text>
          );
        })}

        {points.map((p, i) => {
          const v = values[i];
          const isLast = i === points.length - 1;

          if (v === null) {
            return (
              <g key={p.date}>
                <rect x={xFor(i)} y={padTop + plotH - 4} width={barWidth} height={4} rx={2} fill="#DCD5C4">
                  <title>No upload for this period</title>
                </rect>
                {!dense && (
                  <text x={xFor(i) + barWidth / 2} y={padTop + plotH - 10} textAnchor="middle" fontSize="9.5" fill="#9A937F">—</text>
                )}
              </g>
            );
          }

          const barH = hFor(v);
          return (
            <g key={p.date}>
              <rect x={xFor(i)} y={padTop + plotH - barH} width={barWidth} height={barH} rx={3} fill={color} opacity={isLast ? 1 : 0.55}>
                <title>{v}</title>
              </rect>
              {(!dense || isLast || v > 0) && (
                <text x={xFor(i) + barWidth / 2} y={padTop + plotH - barH - 5} textAnchor="middle"
                  fontSize={dense ? "8.5" : "10.5"} fontWeight={isLast ? 700 : 500} fill={isLast ? color : "#9A937F"}>
                  {v}
                </text>
              )}
            </g>
          );
        })}

        {/* Axis labels. Dense (Monthly) mode: one short single-line label
            per bar, rotated -40deg so 12 of them never touch even at a
            narrow bar width. Sparse mode: up to two stacked lines,
            horizontal, since there's plenty of room per bar. */}
        {points.map((p, i) => {
          const [line1, line2] = periodLabelLines(p, range);
          const cx = xFor(i) + barWidth / 2;
          if (dense) {
            return (
              <text key={`label-${p.date}`} x={cx} y={height - 6} textAnchor="end" fontSize="8.5" fill="#6B6558"
                transform={`rotate(-40 ${cx} ${height - 6})`}>
                {line1}
              </text>
            );
          }
          return (
            <text key={`label-${p.date}`} x={cx} textAnchor="middle" fontSize={points.length <= 4 ? "10" : "8.5"} fill="#6B6558">
              <tspan x={cx} y={height - 22}>{line1}</tspan>
              {line2 && <tspan x={cx} y={height - 9}>{line2}</tspan>}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function MetricCard({ title, color, points, get, range, active, onClick }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        background: "linear-gradient(180deg, #fff 0%, #FCFAF4 100%)",
        border: active ? `1.5px solid ${color}` : "1px solid var(--line, #DCD5C4)",
        borderRadius: 10, padding: "17px 16px 12px", position: "relative", overflow: "visible",
        boxShadow: active ? `0 2px 8px ${color}33` : "0 1px 3px rgba(31,42,68,0.06)",
        cursor: onClick ? "pointer" : undefined, transition: "all 0.15s ease",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--muted, #6B6558)", fontWeight: 700, marginBottom: 6 }}>
        {title}
      </div>
      <MiniTrendChart points={points} get={get} color={color} range={range} />
    </div>
  );
}

/**
 * Generic Deep Dive page — reused by every check. Config comes in as
 * props instead of being hardcoded per-check, so this ONE file covers
 * all 12 checks; each ValidationPage's "Deep Dive" button just triggers
 * a different `checkKey` (via App.jsx), which pulls that check's own
 * `metrics` config from deepDiveConfig.js.
 *
 * metrics: array of up to 4 entries, each:
 *   { key: "flagged_count", label: "DOB missing", color: "#A6403D", byTlKey: "by_tl_missing" }
 * byTlKey is optional — omit it for checks with no TL dimension
 * (Overlapping Tenures, Multi-Party).
 */
export default function DeepDivePage({ checkKey, pageTitle, pageSubtitle, metrics, onBack }) {
  const [range, setRange] = useState("month");
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState(metrics[0]?.key || "total");

  function load() {
    setLoading(true);
    setError(null);
    getCheckDeepDive(checkKey, range)
      .then((res) => setPoints(res.points || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, checkKey]);

  useEffect(() => {
    setView(metrics[0]?.key || "total");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  const activeMetric = metrics.find((m) => m.key === view);

  const tlNames = useMemo(() => {
    if (!activeMetric?.byTlKey) return [];
    const names = new Set();
    points.forEach((p) => Object.keys(p[activeMetric.byTlKey] || {}).forEach((n) => names.add(n)));
    const fixedOrder = ["Deepak", "Rituraj", "Divya", "Gaurav"];
    const rest = Array.from(names).filter((n) => !fixedOrder.includes(n)).sort();
    return [...fixedOrder.filter((n) => names.has(n)), ...rest];
  }, [points, activeMetric]);

  const hasData = points.length > 0;

  const sectionHeadingStyle = {
    fontFamily: "'Source Serif 4',serif", fontSize: 18, fontWeight: 700,
    margin: "34px 0 14px", paddingBottom: 8, borderBottom: "2px solid var(--ink, #1F2A44)", color: "var(--ink, #1F2A44)",
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>{pageTitle}</h2>
          <p>{pageSubtitle}</p>
        </div>
        <BackButton onClick={onBack} />
      </div>

      <div style={{ display: "flex", gap: 4, margin: "16px 0 22px" }}>
        {RANGES.map(([val, label]) => (
          <button
            key={val}
            onClick={() => setRange(val)}
            className="deadline-stop-btn"
            style={{
              fontSize: 11.5, padding: "5px 12px", fontWeight: range === val ? 700 : 500,
              background: range === val ? "#2F3A4A" : undefined,
              color: range === val ? "#fff" : undefined,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div style={{ color: "var(--red, #A6403D)", fontSize: 12.5, margin: "12px 0" }}>{error}</div>}

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--muted, #6B6558)" }}>Loading…</p>
      ) : !hasData ? (
        <div className="empty-note">No snapshots yet for this range — upload an Excel on at least two different days to build a trend.</div>
      ) : (
        <>
          <div style={{ ...sectionHeadingStyle, marginTop: 0 }}>Overview</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(metrics.length, 4)}, 1fr)`, gap: 14, marginBottom: 10 }}>
            {metrics.map((m) => (
              <MetricCard
                key={m.key}
                title={m.label}
                color={m.color}
                points={points}
                get={(p) => p[m.key]}
                range={range}
                active={view === m.key}
                onClick={() => setView(m.key)}
              />
            ))}
          </div>

          {activeMetric?.byTlKey && tlNames.length > 0 && (
            <>
              <div style={sectionHeadingStyle}>{activeMetric.label} — by team lead</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 20 }}>
                {tlNames.map((tl) => (
                  <MetricCard
                    key={`${activeMetric.key}-${tl}`}
                    title={tl}
                    color={colorForTl(tl, tlNames)}
                    points={points}
                    get={(p) => (p[activeMetric.byTlKey] || {})[tl] || 0}
                    range={range}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}