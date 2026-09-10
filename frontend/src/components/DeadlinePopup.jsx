import React, { useEffect, useState } from "react";
import { getValidationDetail } from "../api";

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function recordKey(r) {
  // Prefer Office ID (a tenure record's stable identity); fall back to
  // Person ID + End Date if Office ID is ever blank on a record.
  return r.office_id || `${r.person_id}|${r.end_date}`;
}

function mutedStorageKey(uploadId) {
  return `deadlinePopup:muted:${uploadId}`;
}

function lastShownStorageKey(uploadId) {
  return `deadlinePopup:lastShownDate:${uploadId}`;
}

function loadMuted(uploadId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(mutedStorageKey(uploadId)) || "[]"));
  } catch {
    return new Set();
  }
}

function saveMuted(uploadId, mutedSet) {
  localStorage.setItem(mutedStorageKey(uploadId), JSON.stringify([...mutedSet]));
}

/**
 * Shows an "Upcoming deadlines" popup automatically once per calendar day
 * (per uploaded file) whenever there are tenures ending within the next
 * 15 days. Individual items can be permanently muted ("Stop reminding
 * me"). Items disappear on their own once the End Date passes, since
 * they simply drop out of the backend's flagged list.
 *
 * A small pill button stays visible so the person can reopen the list
 * on demand even after dismissing today's auto-popup.
 */
export default function DeadlinePopup({ uploadId }) {
  const [records, setRecords] = useState([]);
  const [muted, setMuted] = useState(new Set());
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!uploadId) return;
    setMuted(loadMuted(uploadId));
    getValidationDetail(uploadId, "upcoming_deadlines")
      .then((data) => {
        setRecords(data.records || []);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [uploadId]);

  useEffect(() => {
    if (!checked || !uploadId) return;
    const visible = records.filter((r) => !muted.has(recordKey(r)));
    if (visible.length === 0) return;
    const lastShown = localStorage.getItem(lastShownStorageKey(uploadId));
    if (lastShown !== todayStr()) {
      setOpen(true);
      localStorage.setItem(lastShownStorageKey(uploadId), todayStr());
    }
  }, [checked, records, muted, uploadId]);

  if (!uploadId || !checked) return null;

  const visible = records.filter((r) => !muted.has(recordKey(r)));
  if (visible.length === 0) return null;

  function stopReminding(r) {
    const next = new Set(muted);
    next.add(recordKey(r));
    setMuted(next);
    saveMuted(uploadId, next);
  }

  return (
    <>
      <button className="deadline-pill" onClick={() => setOpen(true)}>
        {visible.length} deadline{visible.length !== 1 ? "s" : ""} within 15 days
      </button>

      {open && (
        <div className="deadline-overlay" onClick={() => setOpen(false)}>
          <div className="deadline-modal" onClick={(e) => e.stopPropagation()}>
            <div className="deadline-modal-header">
              <h3>Upcoming deadlines</h3>
              <button className="deadline-close" onClick={() => setOpen(false)}>×</button>
            </div>
            <p className="deadline-modal-sub">
              Tenures ending within the next 15 days. This reappears once a day until each
              item's end date passes, or until you stop reminders for it.
            </p>
            <div className="deadline-list">
              {visible
                .slice()
                .sort((a, b) => a.days_remaining - b.days_remaining)
                .map((r) => (
                  <div className="deadline-item" key={recordKey(r)}>
                    <div className="deadline-item-main">
                      <div className="deadline-item-title">{r.full_name || "—"} — {r.current_office || "—"}</div>
                      <div className="deadline-item-sub">
                        Person ID: {r.person_id || "—"} · Office ID: {r.office_id || "—"} · State: {r.state || "—"}
                      </div>
                    </div>
                    <div className="deadline-item-right">
                      <div className={`deadline-days ${r.days_remaining <= 3 ? "urgent" : ""}`}>
                        {r.days_remaining === 0 ? "Ends today" : `${r.days_remaining} day${r.days_remaining !== 1 ? "s" : ""} left`}
                      </div>
                      <div className="deadline-end-date">{r.end_date}</div>
                      <button className="deadline-stop-btn" onClick={() => stopReminding(r)}>
                        Stop reminding me
                      </button>
                    </div>
                  </div>
                ))}
            </div>
            <div className="deadline-modal-footer">
              <button className="deadline-close-today" onClick={() => setOpen(false)}>
                Close for now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
