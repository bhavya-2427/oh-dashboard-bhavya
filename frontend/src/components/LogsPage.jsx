import React, { useEffect, useMemo, useState } from "react";
import { getActivityLog, getActivityLogSummary, getActivityLogOverview, getTeamLeads } from "../api";
import { NAV_GROUPS } from "../navConfig";

const CHECK_LABELS = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.key, i.label])
);

const ACTION_LABELS = {
  reviewed: "Reviewed",
  fixed: "Fixed",
  escalated: "Flagged for Manager",
  reopened: "Reopened",
};

const ACTION_COLORS = {
  reviewed: "#4C7EA8",
  fixed: "#4C8A63",
  escalated: "#A6403D",
  reopened: "#B08A2E",
};

const TL_PALETTE = ["#4C7EA8", "#B08A2E", "#4C8A63", "#8B5FA3", "#A6403D", "#3F8F8A"];

// A distinct color per attribute/check (cycled if there are ever more checks than colors).
const ATTR_PALETTE = [
  "#4C7EA8", "#B08A2E", "#4C8A63", "#8B5FA3", "#A6403D", "#3F8F8A",
  "#C2703D", "#5B6B8C", "#7A8A3F", "#9C5B7A", "#3F6B5A", "#8A6B3F",
];

function isoWeekLabel(d) {
  // Monday-start ISO week, labeled by the week's Monday date (YYYY-MM-DD)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7; // 0 = Monday
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function monthLabel(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function yearLabel(d) {
  return String(d.getFullYear());
}

function bucketLabelFor(d, granularity) {
  if (granularity === "yearly") return yearLabel(d);
  if (granularity === "monthly") return monthLabel(d);
  if (granularity === "weekly") return isoWeekLabel(d);
  return d.toISOString().slice(0, 10);
}

function tickLabelFor(label, granularity) {
  if (granularity === "yearly") return label;
  if (granularity === "monthly") return label.slice(2); // "26-06"
  if (granularity === "weekly") return `wk ${label.slice(5)}`;
  return label.slice(5); // "MM-DD"
}

function buildTrend(entries, granularity, groupField) {
  const buckets = new Map(); // bucketLabel -> { [groupKey]: count }
  const groupKeys = new Set();
  for (const r of entries) {
    const d = new Date(r.created_at);
    const bucket = bucketLabelFor(d, granularity);
    const groupKey =
      groupField === "action" ? (r.action || "unknown") :
      groupField === "check" ? (r.check_key || "unknown") :
      (r.tl_name || "unknown");
    groupKeys.add(groupKey);
    if (!buckets.has(bucket)) buckets.set(bucket, {});
    const b = buckets.get(bucket);
    b[groupKey] = (b[groupKey] || 0) + 1;
  }
  const sortedBuckets = Array.from(buckets.keys()).sort();
  // Keep only the most recent 21 buckets so the chart stays readable
  const trimmed = sortedBuckets.slice(-21);
  return {
    buckets: trimmed.map((b) => ({ label: b, counts: buckets.get(b) })),
    groups: Array.from(groupKeys),
  };
}

function TrendChart({ entries }) {
  const [granularity, setGranularity] = useState("daily");
  const [groupField, setGroupField] = useState("tl"); // "tl" | "action"

  const { buckets, groups } = useMemo(
    () => buildTrend(entries, granularity, groupField),
    [entries, granularity, groupField]
  );

  const colorFor = (key, i) =>
    groupField === "action" ? (ACTION_COLORS[key] || "#999") : TL_PALETTE[i % TL_PALETTE.length];

  const maxTotal = Math.max(1, ...buckets.map((b) => Object.values(b.counts).reduce((a, c) => a + c, 0)));
  const chartH = 180;
  const barW = buckets.length ? Math.max(10, Math.min(34, 640 / buckets.length - 6)) : 20;
  const gap = 6;
  const chartW = buckets.length * (barW + gap) + gap;

  return (
    <div style={{
      border: "1px solid var(--line, #DCD5C4)", borderRadius: 8, padding: "16px 18px", marginBottom: 26, background: "#fff",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <strong style={{ fontSize: 13.5 }}>QC activity trend</strong>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]].map(([g, label]) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className="deadline-stop-btn"
                style={{
                  fontSize: 11, padding: "4px 10px",
                  background: granularity === g ? "#2F3A4A" : undefined,
                  color: granularity === g ? "#fff" : undefined,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[["tl", "By TL"], ["action", "By action"]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setGroupField(val)}
                className="deadline-stop-btn"
                style={{
                  fontSize: 11, padding: "4px 10px",
                  background: groupField === val ? "#2F3A4A" : undefined,
                  color: groupField === val ? "#fff" : undefined,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {buckets.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted, #6B6558)", margin: 0 }}>No QC activity in the current filter to chart.</p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <svg width={Math.max(chartW, 300)} height={chartH + 44} role="img" aria-label="QC activity trend chart">
              {/* gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line
                  key={f} x1={0} x2={Math.max(chartW, 300)}
                  y1={chartH - f * chartH} y2={chartH - f * chartH}
                  stroke="#EEE9DC" strokeWidth={1}
                />
              ))}
              {buckets.map((b, i) => {
                const total = Object.values(b.counts).reduce((a, c) => a + c, 0);
                let yOffset = chartH;
                const x = gap + i * (barW + gap);
                return (
                  <g key={b.label}>
                    {groups.map((g, gi) => {
                      const c = b.counts[g] || 0;
                      if (!c) return null;
                      const h = (c / maxTotal) * chartH;
                      yOffset -= h;
                      return (
                        <rect
                          key={g} x={x} y={yOffset} width={barW} height={h}
                          fill={colorFor(g, gi)} rx={1.5}
                        >
                          <title>{`${g}: ${c} on ${b.label}`}</title>
                        </rect>
                      );
                    })}
                    {total > 0 && (
                      <text x={x + barW / 2} y={chartH - Object.values(b.counts).reduce((a, c) => a + c, 0) * (chartH / maxTotal) - 4}
                        textAnchor="middle" fontSize="9.5" fill="#6B6558">{total}</text>
                    )}
                    <text
                      x={x + barW / 2} y={chartH + 16} textAnchor="middle" fontSize="9.5" fill="#6B6558"
                      transform={buckets.length > 10 ? `rotate(45 ${x + barW / 2} ${chartH + 16})` : undefined}
                      style={buckets.length > 10 ? { textAnchor: "start" } : undefined}
                    >
                      {tickLabelFor(b.label, granularity)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
            {groups.map((g, gi) => (
              <span key={g} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: colorFor(g, gi), display: "inline-block" }} />
                {groupField === "action" ? (ACTION_LABELS[g] || g) : g}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AttributeFixedTrendChart({ entries }) {
  const [granularity, setGranularity] = useState("daily");
  const [hovered, setHovered] = useState(null); // check_key currently highlighted, or null

  const fixedEntries = useMemo(() => entries.filter((r) => r.action === "fixed"), [entries]);
  const { buckets, groups: rawGroups } = useMemo(
    () => buildTrend(fixedEntries, granularity, "check"),
    [fixedEntries, granularity]
  );

  // Total fixed per attribute across the whole chart — also used to rank the legend, biggest first.
  const totalsByGroup = useMemo(() => {
    const t = {};
    for (const r of fixedEntries) {
      const k = r.check_key || "unknown";
      t[k] = (t[k] || 0) + 1;
    }
    return t;
  }, [fixedEntries]);

  const groups = useMemo(
    () => [...rawGroups].sort((a, b) => (totalsByGroup[b] || 0) - (totalsByGroup[a] || 0)),
    [rawGroups, totalsByGroup]
  );

  const colorFor = (key) => {
    const idx = groups.indexOf(key);
    return ATTR_PALETTE[(idx < 0 ? 0 : idx) % ATTR_PALETTE.length];
  };
  const labelFor = (key) => CHECK_LABELS[key] || key;

  const maxTotal = Math.max(1, ...buckets.map((b) => Object.values(b.counts).reduce((a, c) => a + c, 0)));
  const chartH = 190;
  const barW = buckets.length ? Math.max(14, Math.min(40, 680 / buckets.length - 8)) : 24;
  const gap = 10;
  const chartW = buckets.length * (barW + gap) + gap;
  const gradId = "attrFixedGrad";

  return (
    <div
      style={{
        border: "1px solid var(--line, #DCD5C4)", borderRadius: 12, padding: "20px 22px", marginBottom: 26,
        background: "linear-gradient(180deg, #FFFFFF 0%, #FCFAF4 100%)",
        boxShadow: "0 1px 3px rgba(47,58,74,0.06), 0 1px 2px rgba(47,58,74,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div>
          <strong style={{ fontSize: 14.5, letterSpacing: 0.1 }}>Attribute fixed trend</strong>
          <p style={{ fontSize: 11.5, color: "var(--muted, #6B6558)", margin: "3px 0 0" }}>
            Records marked "Fixed" per attribute over time — hover a color to see totals.
          </p>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["daily", "weekly"].map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className="deadline-stop-btn"
              style={{
                fontSize: 11, padding: "4px 10px",
                background: granularity === g ? "#2F3A4A" : undefined,
                color: granularity === g ? "#fff" : undefined,
              }}
            >
              {g === "daily" ? "Daily" : "Weekly"}
            </button>
          ))}
        </div>
      </div>

      {buckets.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted, #6B6558)", margin: "12px 0 0" }}>No "Fixed" actions yet to chart.</p>
      ) : (
        <>
          {/* Attribute chips — sorted by total fixed, each a hoverable legend entry */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 18px" }}>
            {groups.map((g) => {
              const isHovered = hovered === g;
              const isDimmed = hovered && !isHovered;
              const c = colorFor(g);
              return (
                <span
                  key={g}
                  onMouseEnter={() => setHovered(g)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${labelFor(g)}: ${totalsByGroup[g] || 0} fixed in total`}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: 11.5,
                    padding: "5px 10px 5px 8px", borderRadius: 20, cursor: "default",
                    background: isHovered ? `${c}22` : "#FAF8F2",
                    border: `1px solid ${isHovered ? c : "var(--line, #DCD5C4)"}`,
                    opacity: isDimmed ? 0.45 : 1,
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{
                    width: 11, height: 11, borderRadius: "50%", background: c, display: "inline-block",
                    boxShadow: isHovered ? `0 0 0 3px ${c}33` : "none", transition: "box-shadow 0.15s ease",
                  }} />
                  <span style={{ fontWeight: isHovered ? 600 : 500 }}>{labelFor(g)}</span>
                  <span style={{
                    fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: "var(--muted, #6B6558)",
                    background: "#fff", borderRadius: 10, padding: "1px 6px",
                  }}>
                    {totalsByGroup[g] || 0}
                  </span>
                </span>
              );
            })}
          </div>

          <div style={{ overflowX: "auto" }}>
            <svg width={Math.max(chartW, 300)} height={chartH + 44} role="img" aria-label="Attribute fixed trend chart">
              <defs>
                {groups.map((g) => (
                  <linearGradient key={g} id={`${gradId}-${g}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colorFor(g)} stopOpacity="1" />
                    <stop offset="100%" stopColor={colorFor(g)} stopOpacity="0.72" />
                  </linearGradient>
                ))}
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line
                  key={f} x1={0} x2={Math.max(chartW, 300)}
                  y1={chartH - f * chartH} y2={chartH - f * chartH}
                  stroke="#EEE9DC" strokeWidth={1}
                />
              ))}
              {buckets.map((b, i) => {
                const total = Object.values(b.counts).reduce((a, c) => a + c, 0);
                let yOffset = chartH;
                const x = gap + i * (barW + gap);
                return (
                  <g key={b.label}>
                    {groups.map((g) => {
                      const c = b.counts[g] || 0;
                      if (!c) return null;
                      const h = (c / maxTotal) * chartH;
                      yOffset -= h;
                      const isDimmed = hovered && hovered !== g;
                      return (
                        <rect
                          key={g} x={x} y={yOffset} width={barW} height={h}
                          fill={`url(#${gradId}-${g})`} rx={3}
                          opacity={isDimmed ? 0.25 : 1}
                          style={{ cursor: "default", transition: "opacity 0.15s ease" }}
                          onMouseEnter={() => setHovered(g)}
                          onMouseLeave={() => setHovered(null)}
                        >
                          <title>{`${labelFor(g)}: ${c} fixed on ${b.label}`}</title>
                        </rect>
                      );
                    })}
                    {total > 0 && (
                      <text x={x + barW / 2} y={chartH - total * (chartH / maxTotal) - 5}
                        textAnchor="middle" fontSize="10" fontWeight="600" fill="#3A3630">{total}</text>
                    )}
                    <text
                      x={x + barW / 2} y={chartH + 17} textAnchor="middle" fontSize="9.5" fill="#6B6558"
                      transform={buckets.length > 10 ? `rotate(45 ${x + barW / 2} ${chartH + 17})` : undefined}
                      style={buckets.length > 10 ? { textAnchor: "start" } : undefined}
                    >
                      {granularity === "weekly" ? `wk ${b.label.slice(5)}` : b.label.slice(5)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

function downloadCsv(rows) {
  if (!rows.length) return;
  const headers = ["When", "TL", "Check", "State", "Action", "Note", "Record ID"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const vals = [
      new Date(r.created_at).toLocaleString(),
      r.tl_name || "",
      CHECK_LABELS[r.check_key] || r.check_key || "",
      r.state || "",
      ACTION_LABELS[r.action] || r.action || "",
      (r.note || "").replace(/[\r\n,]/g, " "),
      r.record_id || "",
    ];
    lines.push(vals.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qc-activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function threeMonthsAgoISO() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

export default function LogsPage({ onBack }) {
  const [tls, setTls] = useState([]);
  const [summary, setSummary] = useState([]);
  const [overview, setOverview] = useState({ total_flagged: 0, total_fixed: 0, total_pending: 0, total_not_impacted: 0, by_check: [] });
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterTl, setFilterTl] = useState("");
  const [filterCheck, setFilterCheck] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterState, setFilterState] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      // History & Logs only needs to reach back 3 months — cap the query even if an
      // older "From" date was picked, so we never load or render stale data here.
      const cutoff = threeMonthsAgoISO();
      const effectiveDateFrom = dateFrom && dateFrom > cutoff ? dateFrom : cutoff;
      const [tlList, summaryList, overviewData, log] = await Promise.all([
        getTeamLeads(),
        getActivityLogSummary(),
        getActivityLogOverview(),
        getActivityLog({
          tlId: filterTl || undefined,
          checkKey: filterCheck || undefined,
          action: filterAction || undefined,
          state: filterState || undefined,
          dateFrom: effectiveDateFrom,
          dateTo: dateTo || undefined,
          limit: 1000,
        }),
      ]);
      setTls(tlList.filter((t) => t.role !== "manager"));
      setSummary(summaryList);
      setOverview(overviewData);
      setEntries(log);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterTl, filterCheck, filterAction, filterState, dateFrom, dateTo]);

  const visibleEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    return entries.filter((r) =>
      (r.tl_name || "").toLowerCase().includes(q) ||
      (r.state || "").toLowerCase().includes(q) ||
      (r.record_id || "").toLowerCase().includes(q) ||
      (r.note || "").toLowerCase().includes(q) ||
      (CHECK_LABELS[r.check_key] || r.check_key || "").toLowerCase().includes(q)
    );
  }, [entries, search]);

  function clearFilters() {
    setFilterTl(""); setFilterCheck(""); setFilterAction(""); setFilterState("");
    setDateFrom(""); setDateTo(""); setSearch("");
  }

  const anyFilterActive = filterTl || filterCheck || filterAction || filterState || dateFrom || dateTo || search;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>History &amp; Logs</h2>
          <p>Manager-only. Every QC action taken by every TL, across every check and state, lives here — this page and its data are never shown on a TL account.</p>
        </div>
      </div>

      {error && <div style={{ color: "var(--red, #A6403D)", fontSize: 12.5, margin: "16px 0" }}>{error}</div>}

      {/* Grand totals — errors flagged in the current upload, pending, fixed, and not impacted */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 20 }}>
        <div style={{
          flex: "1 1 220px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 8,
          padding: "16px 20px", background: "#fff",
        }}>
          <div style={{ fontSize: 12, color: "var(--muted, #6B6558)", marginBottom: 4 }}>Total errors flagged</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 34, fontWeight: 700, color: "#A6403D" }}>
            {overview.total_flagged.toLocaleString()}
          </div>
        </div>
        <div style={{
          flex: "1 1 220px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 8,
          padding: "16px 20px", background: "#fff",
        }}>
          <div style={{ fontSize: 12, color: "var(--muted, #6B6558)", marginBottom: 4 }}>Pending</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 34, fontWeight: 700, color: "#B08A2E" }}>
            {overview.total_pending.toLocaleString()}
          </div>
        </div>
        <div style={{
          flex: "1 1 220px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 8,
          padding: "16px 20px", background: "#fff",
        }}>
          <div style={{ fontSize: 12, color: "var(--muted, #6B6558)", marginBottom: 4 }}>Total fixed</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 34, fontWeight: 700, color: "#4C8A63" }}>
            {overview.total_fixed.toLocaleString()}
          </div>
        </div>
        <div style={{
          flex: "1 1 220px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 8,
          padding: "16px 20px", background: "#fff",
        }}>
          <div style={{ fontSize: 12, color: "var(--muted, #6B6558)", marginBottom: 4 }}>Not Impacted</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 34, fontWeight: 700, color: "#8A7F6B" }}>
            {overview.total_not_impacted.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Per-TL summary cards */}
      <div className="tl-summary-grid" style={{ marginTop: 22 }}>
        {tls.map((tl) => {
          const s = summary.find((x) => x.tl_id === tl.id) || {
            total: 0, by_action: { reviewed: 0, fixed: 0, escalated: 0, reopened: 0 },
            checks_touched: 0, states_touched: 0, last_active: null,
          };
          return (
            <div
              key={tl.id}
              onClick={() => setFilterTl(filterTl === tl.id ? "" : tl.id)}
              className={`tl-summary-card${filterTl === tl.id ? " active" : ""}`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 14 }}>{tl.name}</strong>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 22, fontWeight: 500 }}>{s.total}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted, #6B6558)", marginBottom: 8 }}>
                {(tl.states || []).length ? `${tl.states.length} state${tl.states.length > 1 ? "s" : ""}` : "no states assigned"}
                {(tl.constituencies || []).length ? ` · ${tl.constituencies.length} constituencies` : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {Object.entries(s.by_action).filter(([, c]) => c > 0).map(([act, c]) => (
                  <span key={act} style={{
                    fontSize: 10.5, padding: "2px 7px", borderRadius: 10, color: "#fff",
                    background: ACTION_COLORS[act] || "#999",
                  }}>
                    {ACTION_LABELS[act] || act}: {c}
                  </span>
                ))}
                {s.total === 0 && <span style={{ fontSize: 10.5, color: "var(--muted, #6B6558)" }}>No QC actions yet</span>}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--muted, #6B6558)", marginTop: 8 }}>
                Last active: {s.last_active ? new Date(s.last_active).toLocaleString() : "—"}
              </div>
            </div>
          );
        })}
        {tls.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--muted, #6B6558)" }}>
            No TL accounts yet — create them from Manage TLs &amp; Rights.
          </div>
        )}
      </div>

      {/* Attribute-level "fixed" trend — which checks are getting cleaned up over time */}
      <AttributeFixedTrendChart entries={entries} />

      {/* Trend chart — respects the current filters below */}
      <TrendChart entries={entries} />

      {/* Filter bar */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
        marginBottom: 14, padding: "12px 14px", background: "#FAF8F2",
        border: "1px solid var(--line, #DCD5C4)", borderRadius: 8,
      }}>
        <select value={filterTl} onChange={(e) => setFilterTl(e.target.value)} style={selectStyle}>
          <option value="">All TLs</option>
          {tls.map((tl) => <option key={tl.id} value={tl.id}>{tl.name}</option>)}
        </select>
        <select value={filterCheck} onChange={(e) => setFilterCheck(e.target.value)} style={selectStyle}>
          <option value="">All checks</option>
          {Object.entries(CHECK_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} style={selectStyle}>
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input
          value={filterState} onChange={(e) => setFilterState(e.target.value)}
          placeholder="State" style={{ ...selectStyle, width: 130 }}
        />
        <input type="date" value={dateFrom} min={threeMonthsAgoISO()} onChange={(e) => setDateFrom(e.target.value)} style={selectStyle} title="History & Logs only keeps the last 3 months" />
        <span style={{ fontSize: 12, color: "var(--muted, #6B6558)" }}>to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={selectStyle} />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, note, record ID…" style={{ ...selectStyle, width: 210 }}
        />
        {anyFilterActive && (
          <button className="deadline-stop-btn" onClick={clearFilters} style={{ fontSize: 11.5 }}>Clear filters</button>
        )}
        <button
          className="upload-btn" style={{ marginLeft: "auto", fontSize: 11.5 }}
          onClick={() => downloadCsv(visibleEntries)}
          disabled={!visibleEntries.length}
        >
          ⬇ Download CSV
        </button>
      </div>

      {/* Log table */}
      {loading ? (
        <p style={{ fontSize: 13, color: "var(--muted, #6B6558)" }}>Loading…</p>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: "var(--muted, #6B6558)", marginBottom: 6 }}>
            {visibleEntries.length} record{visibleEntries.length === 1 ? "" : "s"}
          </div>
          <div style={{ maxHeight: 560, overflow: "auto", border: "1px solid var(--line, #DCD5C4)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead style={{ position: "sticky", top: 0, background: "#FAF8F2" }}>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line, #DCD5C4)" }}>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>TL</th>
                  <th style={thStyle}>Check</th>
                  <th style={thStyle}>State</th>
                  <th style={thStyle}>Action</th>
                  <th style={thStyle}>Note</th>
                  <th style={thStyle}>Record ID</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line, #DCD5C4)" }}>
                    <td style={tdStyle}>{new Date(r.created_at).toLocaleString()}</td>
                    <td style={tdStyle}>{r.tl_name}</td>
                    <td style={tdStyle}>{CHECK_LABELS[r.check_key] || r.check_key}</td>
                    <td style={tdStyle}>{r.state || "—"}</td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 10.5, padding: "2px 7px", borderRadius: 10, color: "#fff",
                        background: ACTION_COLORS[r.action] || "#999",
                      }}>
                        {ACTION_LABELS[r.action] || r.action}
                      </span>
                    </td>
                    <td style={tdStyle}>{r.note || ""}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{r.record_id || ""}</td>
                  </tr>
                ))}
                {visibleEntries.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: "16px 6px", color: "var(--muted, #6B6558)" }}>No matching QC actions.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const selectStyle = {
  fontSize: 12, padding: "6px 8px", border: "1px solid var(--line, #DCD5C4)",
  borderRadius: 5, background: "#fff",
};
const thStyle = { padding: "8px 6px", fontWeight: 600 };
const tdStyle = { padding: "7px 6px" };
