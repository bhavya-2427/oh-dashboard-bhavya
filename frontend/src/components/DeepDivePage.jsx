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

// "Sep 26" style — short month name + 2-digit year, no apostrophe, no
// punctuation — matches what was asked for directly.
function monthYearLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const year = String(d.getFullYear()).slice(2);
  return `${month} ${year}`;
}

function quarterYearLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${String(d.getFullYear()).slice(2)}`;
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
// placeholder instead of a real bar.
//
// IMPORTANT: preserveAspectRatio is "xMidYMid meet", NOT "none". "none"
// stretches the SVG's internal coordinate system non-uniformly to match
// the rendered box, which warps every glyph in every <text> element into
// illegible diagonal smears — this was the actual cause of the garbled
// month labels, not a missing/wrong label. "meet" scales uniformly, so
// text always renders crisp and correctly proportioned, at the cost of
// some empty space around the chart when there are very few bars — a far
// better trade-off than unreadable labels.
function MiniTrendChart({ points, get, color, range, height = 168 }) {
  const dense = points.length > 6; // month (12) — needs tight spacing + short labels
  const barGap = dense ? 12 : points.length <= 2 ? 40 : points.length <= 4 ? 26 : 16;
  const barWidth = dense ? 26 : points.length <= 2 ? 64 : points.length <= 4 ? 46 : 30;
  const width = Math.max(220, points.length * (barWidth + barGap) + barGap);
  const values = points.map((p) => (p.has_data === false ? null : (get(p) || 0)));
  const knownValues = values.filter((v) => v !== null);
  const maxVal = Math.max(1, ...(knownValues.length ? knownValues : [0]));
  const padTop = 34, padBottom = dense ? 34 : 40, padX = barGap;
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
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height }}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={width} y1={padTop + f * plotH} y2={padTop + f * plotH} stroke="#EEE9DC" strokeWidth={1} />
        ))}

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
                  fontSize={dense ? "9" : "10.5"} fontWeight={isLast ? 700 : 500} fill={isLast ? color : "#9A937F"}>
                  {v}
                </text>
              )}
            </g>
          );
        })}

        {/* Axis labels. Dense (Monthly/Quarterly) mode: one short
            horizontal label per bar (no rotation needed now that text
            isn't being distorted — "Sep 26" fits fine at this spacing).
            Sparse mode: up to two stacked lines, since there's plenty of
            room per bar. */}
        {points.map((p, i) => {
          const [line1, line2] = periodLabelLines(p, range);
          const cx = xFor(i) + barWidth / 2;
          if (dense) {
            return (
              <text key={`label-${p.date}`} x={cx} y={height - 10} textAnchor="middle" fontSize="9.5" fontWeight={600} fill="#4A4437">
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

function CombinedTlChart({ points, tlNames, colorFor, valueGetter, defaultRangeLabel, range }) {
  const dense = points.length > 6;
  const height = dense ? 320 : 300;
  const groupGap = dense ? 20 : 34;
  const barGap = 5;
  const barWidth = dense ? 12 : (points.length <= 4 ? 26 : 18);
  const groupWidth = tlNames.length * (barWidth + barGap) + groupGap;
  const width = Math.max(560, points.length * groupWidth + groupGap);
  const padTop = 30, padBottom = dense ? 46 : 46, padLeft = 8, padRight = 8;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(1, ...tlNames.flatMap((tl) => points.map((p) => (p.has_data === false ? 0 : (valueGetter(p, tl) || 0)))));
  const groupXFor = (i) => padLeft + groupGap / 2 + i * groupWidth;
  const barXFor = (gi, ti) => groupXFor(gi) + ti * (barWidth + barGap);
  const hFor = (v) => (v / maxVal) * plotH;

  const [hoveredTl, setHoveredTl] = useState(null);

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #fff 0%, #FCFAF4 100%)",
        border: "1px solid var(--line, #DCD5C4)",
        borderRadius: 14,
        padding: "22px 26px 20px",
        boxShadow: "0 2px 10px rgba(31,42,68,0.07)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {tlNames.map((tl) => {
          const c = colorFor(tl);
          const isDim = hoveredTl && hoveredTl !== tl;
          const isActive = hoveredTl === tl;
          const lastPoint = points[points.length - 1];
          const latest = lastPoint && lastPoint.has_data !== false ? (valueGetter(lastPoint, tl) || 0) : 0;
          return (
            <span
              key={tl}
              onMouseEnter={() => setHoveredTl(tl)}
              onMouseLeave={() => setHoveredTl(null)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600,
                cursor: "default", opacity: isDim ? 0.4 : 1, transition: "all 150ms ease",
                padding: "5px 12px 5px 9px", borderRadius: 999,
                background: isActive ? `${c}18` : "#F6F3E9",
                border: `1px solid ${isActive ? c : "#E5DFCC"}`,
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} />
              {tl}
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: c, fontSize: 12 }}>{latest}</span>
            </span>
          );
        })}
      </div>

      <div style={{ overflowX: "auto" }}>
        <svg
          width="100%"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", minWidth: width, height }}
          role="img"
          aria-label="Combined team lead bar chart"
        >
          <defs>
            {tlNames.map((tl) => {
              const c = colorFor(tl);
              return (
                <linearGradient key={tl} id={`bargrad-${tl.replace(/\s+/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity="1" />
                  <stop offset="100%" stopColor={c} stopOpacity="0.72" />
                </linearGradient>
              );
            })}
            <filter id="barShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#1F2A44" floodOpacity="0.18" />
            </filter>
          </defs>

          {/* alternating soft background bands per date group */}
          {points.map((p, gi) => (
            gi % 2 === 1 && (
              <rect
                key={`band-${p.date}`}
                x={groupXFor(gi) - groupGap / 2}
                y={padTop - 6}
                width={groupWidth}
                height={plotH + 6}
                fill="#F6F3E9"
                opacity={0.55}
              />
            )
          ))}

          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={padLeft} x2={width - padRight} y1={padTop + plotH - f * plotH} y2={padTop + plotH - f * plotH} stroke="#EEE9DC" strokeWidth={1} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={padLeft} y={padTop + plotH - f * plotH - 5} fontSize="9.5" fill="#9A937F" fontFamily="'IBM Plex Mono',monospace">
              {Math.round(f * maxVal)}
            </text>
          ))}
          {/* bold baseline */}
          <line x1={padLeft} x2={width - padRight} y1={padTop + plotH} y2={padTop + plotH} stroke="#C9C2AC" strokeWidth={1.5} />

          {points.map((p, gi) => {
            const hasData = p.has_data !== false;
            return (
              <g key={p.date}>
                {!hasData && (
                  <text
                    x={groupXFor(gi) + (tlNames.length * (barWidth + barGap)) / 2 - barGap / 2}
                    y={padTop + plotH - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#9A937F"
                  >
                    no upload
                  </text>
                )}
                {hasData && tlNames.map((tl, ti) => {
                  const c = colorFor(tl);
                  const isDim = hoveredTl && hoveredTl !== tl;
                  const v = valueGetter(p, tl) || 0;
                  const barH = Math.max(hFor(v), v > 0 ? 2 : 0);
                  const isLastGroup = gi === points.length - 1;
                  return (
                    <g
                      key={tl}
                      opacity={isDim ? 0.25 : 1}
                      style={{ transition: "opacity 150ms ease", cursor: "pointer" }}
                      onMouseEnter={() => setHoveredTl(tl)}
                      onMouseLeave={() => setHoveredTl(null)}
                    >
                      <rect
                        x={barXFor(gi, ti)}
                        y={padTop + plotH - barH}
                        width={barWidth}
                        height={barH}
                        rx={4}
                        fill={`url(#bargrad-${tl.replace(/\s+/g, "")})`}
                        filter={isLastGroup ? "url(#barShadow)" : undefined}
                        opacity={isLastGroup ? 1 : 0.55}
                      >
                        <title>{`${tl}: ${v}`}</title>
                      </rect>
                      {!dense && (
                        <text
                          x={barXFor(gi, ti) + barWidth / 2}
                          y={padTop + plotH - barH - 6}
                          textAnchor="middle"
                          fontSize="10"
                          fontFamily="'IBM Plex Mono',monospace"
                          fontWeight={isLastGroup ? 700 : 500}
                          fill={isLastGroup ? c : "#9A937F"}
                        >
                          {v}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {points.map((p, i) => {
            const [line1, line2] = periodLabelLines(p, range);
            const cx = groupXFor(i) + (tlNames.length * (barWidth + barGap)) / 2 - barGap / 2;
            if (dense) {
              return (
                <text key={p.date} x={cx} y={height - 14} textAnchor="middle" fontSize="10" fontWeight={600} fill="#4A4437">
                  {line1}
                </text>
              );
            }
            return (
              <text key={p.date} x={cx} textAnchor="middle" fontSize="10" fontWeight={600} fill="#4A4437">
                <tspan x={cx} y={height - 28}>{line1}</tspan>
                {line2 && <tspan x={cx} y={height - 14}>{line2}</tspan>}
              </text>
            );
          })}
        </svg>
      </div>
      {points.length === 1 && (
        <div style={{ fontSize: 11.5, color: "var(--muted, #6B6558)", marginTop: 6 }}>
          Only one snapshot so far ({defaultRangeLabel}) — more bars will appear once the next day's upload lands.
        </div>
      )}
    </div>
  );
}

/**
 * Generic Deep Dive page — reused by every check. Config comes in as
 * props instead of being hardcoded per-check, so this ONE file covers
 * all 12 checks; each ValidationPage's "Deep Dive" button just triggers
 * a different `checkKey` (via App.jsx), which pulls that check's own
 * `metrics` config from deepDiveConfig.js.
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