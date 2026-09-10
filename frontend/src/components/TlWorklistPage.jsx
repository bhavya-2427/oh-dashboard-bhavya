import React, { useEffect, useState } from "react";
import { getTlWorklist, postTlAction, getTlProgressByCheck } from "../api";
import { downloadCsv } from "./DataTable";

const CHECK_LABELS = {
  prefix: "Prefix check", full_name: "Full name format", spelling: "Spelling errors",
  naming_convention: "Naming convention",
  govt_body_status: "Govt body unverified", partial_dates: "Partial dates",
  social_media: "Missing social media", missing_dob: "Missing DOB",
  selection_method: "Selection method mismatch", overlapping_tenures: "Overlapping tenures",
  seat_status: "Vacant seats", lookalike_parties: "Look-alike parties",
  multi_party: "Multi-party check", upcoming_deadlines: "Upcoming deadlines",
};

// One-line plain-English explanation of what each check is actually flagging —
// shown at the top of the worklist so a TL knows what they're looking at.
const CHECK_NOTES = {
  prefix: "Flags a Prefix (Mr./Ms./etc.) that doesn't match the person's Gender on record.",
  full_name: "Flags a missing First/Last Name, or stray spacing in the Full Name.",
  spelling: "Flags likely typos and unrecognized words in Current Office / Government Body text.",
  naming_convention: "Flags an office title that doesn't follow the manager-confirmed exact format for its role.",
  govt_body_status: "Flags an office with no Government Body linked, or one that isn't Verified and Approved.",
  partial_dates: "Flags a Start/End Date that's only partly filled in (e.g. year only) or fully blank.",
  social_media: "Flags missing social media handles — personal and official accounts, checked separately.",
  missing_dob: "Flags a record with no Date of Birth on file.",
  selection_method: "Flags a Seat Placement Method that doesn't make sense for that office's role.",
  overlapping_tenures: "Flags a person holding two tenures of the SAME seat type with overlapping dates.",
  seat_status: "Flags a seat that's vacant and past its 60-day grace period for removal.",
  lookalike_parties: "Flags party names that look nearly identical — possible duplicates.",
  multi_party: "Flags a person linked to more than one distinct party across their tenure records.",
  upcoming_deadlines: "Flags any tenure whose End Date falls within the next 15 days.",
};

const ACTIONS = [
  { key: "reviewed", label: "Mark Reviewed", cls: "qc-btn-reviewed" },
  { key: "fixed", label: "Fixed", cls: "qc-btn-fixed" },
  { key: "escalated", label: "Flag for Manager", cls: "qc-btn-escalate" },
];

// Clickable status filter cards shown above the table. "total" and "pending"
// are computed client-side from the full record list; the rest match the
// action_breakdown keys the backend already returns. "not_impacted" is a
// passive default — any flagged record nobody has ever clicked on counts
// here automatically, no action needed.
const STATUS_CARDS = [
  { key: "total", label: "Total flagged (your states)" },
  { key: "pending", label: "Pending" },
  { key: "reviewed", label: "Reviewed", qcTone: "reviewed" },
  { key: "fixed", label: "Fixed", qcTone: "fixed" },
  { key: "escalated", label: "Flagged for Manager", qcTone: "escalate" },
  { key: "not_impacted", label: "Not Impacted", qcTone: "notissue" },
];

const EMPTY_BREAKDOWN = { reviewed: 0, fixed: 0, escalated: 0, not_impacted: 0 };

export default function TlWorklistPage({ tl, token, onLogout, onBackToDashboard, initialCheckKey }) {
  const [checkKey, setCheckKey] = useState(initialCheckKey || "missing_dob");
  const [overview, setOverview] = useState(null);
  const [worklist, setWorklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null); // which breakdown card just changed, for a little pulse
  const [statusFilter, setStatusFilter] = useState("total"); // which card is active — defaults to Total on every check switch
  const inFlightRef = React.useRef(new Set()); // synchronous guard — blocks a second click on the same record before React re-renders the disabled button

  useEffect(() => {
    getTlProgressByCheck(token).then((r) => setOverview(r.checks)).catch(() => {});
  }, [token]);

  useEffect(() => {
    setLoading(true);
    setStatusFilter("total"); // reset to Total whenever a different check is opened
    getTlWorklist(token, checkKey)
      .then(setWorklist)
      .finally(() => setLoading(false));
  }, [token, checkKey]);

  async function act(record, action) {
    // Synchronous re-entrancy guard: a fast double-click fires two handlers before
    // `busyId` has re-rendered the button as disabled. This check happens on the
    // same tick as the click, so the second click is dropped immediately.
    if (inFlightRef.current.has(record.record_id)) return;
    inFlightRef.current.add(record.record_id);
    setBusyId(record.record_id);
    try {
      await postTlAction(token, checkKey, record.record_id, record.state, action, noteDrafts[record.record_id]);
      // Re-fetch the worklist from the backend rather than incrementing counters
      // locally — the backend recomputes action_breakdown as one count per record's
      // LATEST action, so it can never double-count the same record being actioned
      // more than once (which local +1/-1 arithmetic was prone to on races/re-clicks).
      const fresh = await getTlWorklist(token, checkKey);
      setWorklist(fresh);
      setFlash(action);
      setTimeout(() => setFlash(null), 700);
      getTlProgressByCheck(token).then((r) => setOverview(r.checks)).catch(() => {});
    } catch (e) {
      alert(`Couldn't save: ${e.message}`);
    } finally {
      inFlightRef.current.delete(record.record_id);
      setBusyId(null);
    }
  }

  // Saves/edits the note without changing the record's current status — reuses
  // whatever action is already on the record (or "reviewed" if none yet), so
  // the note is preserved and shows up TL-side and in Manager -> History & Logs,
  // without silently marking something Fixed just because a note was typed.
  function saveNote(record) {
    act(record, record.latest_action?.action || "reviewed");
  }

  const cols = worklist?.records?.[0] ? Object.keys(worklist.records[0]).filter(
    (k) => !["record_id", "latest_action"].includes(k)
  ) : [];

  const bd = worklist?.action_breakdown || EMPTY_BREAKDOWN;

  const isSuppressing = (rec) => rec.latest_action && rec.latest_action.action === "fixed";
  const allRecords = worklist?.records || [];
  const pendingCount = allRecords.filter((r) => !isSuppressing(r)).length;
  const countFor = (statusKey) => {
    if (statusKey === "total") return allRecords.length;
    if (statusKey === "pending") return pendingCount;
    return bd[statusKey] ?? 0;
  };
  const visibleRecords = allRecords.filter((r) => {
    if (statusFilter === "total") return true;
    if (statusFilter === "pending") return !isSuppressing(r);
    if (statusFilter === "not_impacted") return !r.latest_action;
    return r.latest_action && r.latest_action.action === statusFilter;
  });

  return (
    <div className="app">
      <div className="sidebar">
        <div className="brand">
          <div className="seal">OH</div>
          <h1>TL Worklist</h1>
          <p>{tl.name} · {tl.states.join(", ") || "All states"}</p>
        </div>
        <div className="navgroup-label">Checks</div>
        {(overview && overview.length > 0 ? overview : Object.keys(CHECK_LABELS).map((k) => ({ check_key: k, pending: null }))).map((c) => (
          <div
            key={c.check_key}
            className={`navitem${checkKey === c.check_key ? " active" : ""}`}
            onClick={() => setCheckKey(c.check_key)}
          >
            <span>{CHECK_LABELS[c.check_key] || c.check_key}</span>
            <span className="count">{c.pending ?? "—"}</span>
          </div>
        ))}
        <div style={{ padding: "20px 22px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {onBackToDashboard && (
            <button className="deadline-stop-btn" onClick={onBackToDashboard}>← Back to dashboard</button>
          )}
          <button className="deadline-stop-btn" onClick={onLogout}>Log out</button>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div>
            <h2>{CHECK_LABELS[checkKey] || checkKey}</h2>
            <p>{CHECK_NOTES[checkKey] || "Records flagged in your assigned state(s)."}</p>
          </div>
          {worklist && worklist.records.length > 0 && (
            <button
              className="dt-download-btn"
              onClick={() => downloadCsv(`${checkKey}_worklist`, cols, cols, visibleRecords)}
            >
              ⬇ Download CSV
            </button>
          )}
        </div>

        {/* What these words mean — shown once at the top, same terms used everywhere below */}
        <div className="logic-note" style={{ marginBottom: 16 }}>
          <span className="logic-label">What these mean</span>
          <b>Total</b> — every record this check has flagged in your state(s), regardless of status.{" "}
          <b>Pending</b> — not yet marked Fixed (includes untouched, Reviewed, and Flagged-for-Manager records).{" "}
          <b>Reviewed</b> — you've looked at it and confirmed it's a real issue, but haven't fixed it yet.{" "}
          <b>Fixed</b> — the underlying data was corrected; hidden from Pending from now on, even after the next upload.{" "}
          <b>Flagged for Manager</b> — sent up for someone else's attention; stays visible until resolved.{" "}
          <b>Not Impacted</b> — nobody has clicked on this record yet; the automatic default until someone does.{" "}
          Click any card below to filter the table to just that status — it starts on <b>Total</b>.
        </div>

        {worklist && (
          <>
            <div className="summary-row">
              {STATUS_CARDS.slice(0, 2).map((s) => (
                <Stat
                  key={s.key} label={s.label} value={countFor(s.key)}
                  tone={s.key === "pending" ? "flag" : undefined}
                  active={statusFilter === s.key}
                  onClick={() => setStatusFilter(s.key)}
                />
              ))}
            </div>
            <div className="summary-row" style={{ marginTop: -14 }}>
              {STATUS_CARDS.slice(2).map((s) => (
                <Stat
                  key={s.key} label={s.label} value={countFor(s.key)} qcTone={s.qcTone}
                  pulse={flash === s.key} active={statusFilter === s.key}
                  onClick={() => setStatusFilter(s.key)}
                />
              ))}
            </div>
          </>
        )}

        {loading && <div className="empty-note">Loading…</div>}

        {!loading && worklist && allRecords.length === 0 && (
          <div className="placeholder-card">
            <b>No data yet</b>
            No OH Excel file has been uploaded yet. Ask an admin to log out of TL mode, go to the normal
            dashboard, and upload the latest OH Excel via "Upload OH Excel (.xlsx)" — the worklist will
            then show records automatically, no re-login needed.
          </div>
        )}

        {!loading && worklist && allRecords.length > 0 && visibleRecords.length === 0 && (
          <div className="empty-note">Nothing in your state(s) matches this filter. 🎉</div>
        )}

        {!loading && worklist && visibleRecords.length > 0 && (
          <div className="tablewrap" style={{ maxHeight: "none" }}>
            <table>
              <thead>
                <tr>
                  {cols.map((c) => <th key={c}>{c}</th>)}
                  <th>Note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((r) => {
                  const currentAction = r.latest_action?.action;
                  const noteDirty = noteDrafts[r.record_id] !== undefined && noteDrafts[r.record_id] !== (r.latest_action?.note || "");
                  return (
                    <tr key={r.record_id} className={currentAction ? `qc-row-${currentAction.replace(/_/g, "-")}` : ""}>
                      {cols.map((c) => <td key={c}>{String(r[c] ?? "—")}</td>)}
                      <td>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            placeholder="optional note"
                            value={noteDrafts[r.record_id] !== undefined ? noteDrafts[r.record_id] : (r.latest_action?.note || "")}
                            onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [r.record_id]: e.target.value }))}
                            style={{ width: 130, fontSize: 11.5, padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 4 }}
                          />
                          <button
                            className="deadline-stop-btn"
                            style={{ fontSize: 10.5, padding: "4px 7px", opacity: noteDirty ? 1 : 0.5 }}
                            disabled={!noteDirty || busyId === r.record_id}
                            onClick={() => saveNote(r)}
                            title={r.latest_action?.note ? "Edit saved note" : "Save note"}
                          >
                            {r.latest_action?.note ? "Edit ✓" : "Save"}
                          </button>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {r.latest_action && (
                          <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 4 }}>
                            ✓ {(r.latest_action.action || "").replace(/_/g, " ")} by {r.latest_action.tl_name}
                          </div>
                        )}
                        {ACTIONS.map((a) => (
                          <button
                            key={a.key}
                            className={`qc-btn ${a.cls}${currentAction === a.key ? " qc-btn-active" : ""}`}
                            disabled={busyId === r.record_id}
                            onClick={() => act(r, a.key)}
                          >
                            {currentAction === a.key ? "✓ " : ""}{a.label}
                          </button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, qcTone, pulse, active, onClick }) {
  const cls = qcTone ? `qc-stat-${qcTone}` : (tone || "");
  return (
    <div
      className={`stat-card ${cls}${pulse ? " pulse" : ""}${active ? " stat-card-active" : ""}${onClick ? " stat-card-clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
