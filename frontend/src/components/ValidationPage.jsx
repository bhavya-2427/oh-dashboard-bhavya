import React, { useEffect, useState } from "react";
import { getValidationDetail, addToSpellingAllowlist } from "../api";
import DataTable, { downloadCsv } from "./DataTable";
import { METRICS_BY_CHECK } from "../deepDiveConfig";

const TITLES = {
  prefix: ["Prefix validation", "Compares each person's Prefix (Mr., Ms., etc.) to their Gender — Male should use Mr., Female should use Ms. Dr., Prof., Capt., Adv., and Col. are accepted for either gender. Only Verified and Approved, Active persons are checked."],
  full_name: ["Full name format", "Checks that First Name and Last Name are both filled in whenever a person has any name data at all — only Middle Name is allowed to be blank. Also catches stray leading/trailing or double spaces in the Full Name. Only Verified and Approved, Active persons are checked."],
  govt_body_status: ["Govt body unverified status", "Cross-checks every office against the Government Body export. An office is flagged if it has no Government Body linked at all, or if the Government Body it's linked to has a Status other than \"Verified and Approved\". Runs on all offices, not just active ones — the goal is to catch every broken or unverified link, wherever it is."],
  partial_dates: ["Partial dates", "Classifies each record's Start Date and End Date as complete, partial (only a year, or only a year and month), or fully blank. Only Verified and Approved, Active persons are checked."],
  social_media: ["Missing social media", "Checks whether social media handles are filled in — the person's own personal accounts and the officeholder's official accounts are checked and shown separately. Only Verified and Approved, Active persons are checked."],
  missing_dob: ["Missing date of birth", "Flags any record with no Date of Birth on file, and separately any record with only a partial Date of Birth (year only, or year and month). Only Verified and Approved, Active persons are checked."],
  selection_method: ["Selection method mismatch", "Checks that the Seat Placement Method (e.g. Directly Elected, Nominated) makes sense for that office's role. Only Verified and Approved, Active persons are checked."],
  seat_status: ["Vacant seats by state", "Classifies every seat as filled (Active) or vacant. A vacant seat gets a 60-day grace period after its End Date before it's flagged as overdue for removal from the register. Runs on all records — tracking vacancies is the whole point of this check."],
  overlapping_tenures: ["Overlapping tenures", "Finds a person holding two tenures of the SAME seat type (e.g. two MLA seats) with overlapping dates — not physically possible. Concurrent Minister portfolios, a Governor's temporary additional charge of another state, and a Speaker who's also an MLA are all confirmed-normal and never flagged. Only Verified and Approved, Active persons are checked, so an overlap is only caught while both sides are still active."],
  lookalike_parties: ["Look-alike parties", "Finds party names that look nearly identical (e.g. \"Kerala Congress\" vs \"Kerala Congress (B)\") and shows each side's member count, so a human can judge whether it's a genuine duplicate or two real, separate parties. Only Verified and Approved, Active persons are checked."],
  multi_party: ["Multi-party check", "Flags any Person ID linked to more than one distinct party across their tenure records. Only Verified and Approved, Active persons are checked."],
  spelling: ["Spelling errors", "Checks Current Office and Government Body text for two things: (1) Likely typos — a misspelled word with a confident, close dictionary match. (2) Unrecognized words — a word not in any dictionary with no close match, usually a regional/Hindi term or an Indian proper noun; mark it correct once and it's remembered forever, on every future upload. Only Verified and Approved, Active persons are checked."],
  naming_convention: ["Naming convention", "Flags an office title that starts with a known role (Minister, MLA, Governor, etc.) but doesn't follow the manager-confirmed exact format for that role — e.g. missing portfolio or jurisdiction. Only Verified and Approved, Active persons are checked."],
  upcoming_deadlines: ["Upcoming deadlines", "Flags any tenure whose End Date falls within the next 15 days, so nobody misses a seat that needs action soon. A record disappears from this list on its own once its End Date has passed."],
};

function FilterBar({ state, onStateChange, states, tlFilter, onTlFilterChange, tlNames, recurrence, onRecurrenceChange }) {
  return (
    <div className="filter-bar-row">
      <div className="filter-pill">
        <span className="filter-pill-label">State</span>
        <select value={state} onChange={(e) => onStateChange(e.target.value)}>
          <option value="">All states</option>
          {(states || []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {tlNames && tlNames.length > 0 && (
        <div className="filter-pill">
          <span className="filter-pill-label">TL</span>
          <select value={tlFilter} onChange={(e) => onTlFilterChange(e.target.value)}>
            <option value="">All team leads</option>
            {tlNames.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}

      {onRecurrenceChange && (
        <div className="filter-pill">
          <span className="filter-pill-label">Status</span>
          <select value={recurrence} onChange={(e) => onRecurrenceChange(e.target.value)}>
            <option value="all">All</option>
            <option value="repeat">Repeat</option>
            <option value="new">New</option>
          </select>
        </div>
      )}
    </div>
  );
}

export default function ValidationPage({ uploadId, pageKey, state, onStateChange, states, tlFilter, onTlFilterChange, tlNames, onQc, onDeepDive }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recurrence, setRecurrence] = useState("all");

  useEffect(() => {
    if (!uploadId) return;
    setLoading(true);
    getValidationDetail(uploadId, pageKey, state)
      .then(setData)
      .finally(() => setLoading(false));
  }, [uploadId, pageKey, state]);

  useEffect(() => {
    setRecurrence("all");
  }, [pageKey]);

  const [title, subtitle] = TITLES[pageKey] || [pageKey, ""];

  const hasDeepDive = Boolean(METRICS_BY_CHECK[pageKey]);

  return (
    <div>
      <div className="topbar">
        <div><h2>{title}</h2></div>
        <div style={{ display: "flex", gap: 8 }}>
          {hasDeepDive && onDeepDive && (
            <button className="upload-btn" onClick={() => onDeepDive(pageKey)}>
              Deep Dive
            </button>
          )}
          {onQc && (
            <button className="upload-btn" onClick={() => onQc(pageKey)}>
              Team Lead QC for this check
            </button>
          )}
        </div>
      </div>
      <div className="logic-note">
        <span className="logic-label">How this check works</span>
        {subtitle}
      </div>

      {!uploadId && <div className="empty-note">Upload an OH Excel file to run this check.</div>}
      {uploadId && loading && <div className="empty-note">Loading…</div>}
      {uploadId && !loading && data && (
        <ValidationBody
          pageKey={pageKey}
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={setRecurrence}
        />
      )}
    </div>
  );
}

function ValidationBody({ pageKey, data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames, onRecurrenceChange }) {
  switch (pageKey) {
    case "prefix":
      return <PrefixBody data={data} tlFilter={tlFilter} />;
    case "full_name":
      return (
        <FullNameBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "govt_body_status":
      return (
        <>
          <div className="summary-row">
            <Stat label="Total office records" value={data.total_count} />
            <Stat label="Unverified / other status" value={data.flagged_count} tone="flag" />
          </div>
          <Table
            title="Flagged records"
            cols={["office_id", "government_body", "current_office", "office_role", "state", "office_status"]}
            headers={["Office ID", "Govt body", "Office", "Role", "State", "Status on record"]}
            rows={data.records}
          />
        </>
      );
    case "partial_dates":
      return (
        <PartialDatesBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "social_media":
      return (
        <SocialMediaBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "missing_dob":
      return (
        <MissingDobBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "selection_method":
      return (
        <SelectionMethodBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "seat_status": {
      const states = Object.entries(data.by_state || {}).sort((a, b) => (b[1].overdue) - (a[1].overdue));
      return (
        <>
          <div className="summary-row">
            <Stat label="Total seats" value={data.total_count} />
            <Stat label="Filled (active)" value={data.total_count - data.flagged_count} tone="ok" />
            <Stat label="Overdue for removal (>60 days)" value={data.overdue_count} tone="flag" />
            <Stat label="States covered" value={states.length} />
          </div>
          <div className="placeholder-card" style={{ marginBottom: 16 }}>
            <b>Overdue = data hygiene issue</b>
            These seats ended more than 60 days ago but are still present in the export — the tool should have
            purged them by now. Worth raising as its own finding, separate from genuinely recent vacancies.
          </div>
          <div className="section-title">By state</div>
          <div className="state-grid">
            {states.map(([st, v]) => (
              <div className="state-card" key={st}>
                <div className="sname">{st}</div>
                <div className="snum">{v.overdue}</div>
                <div className="stotal">overdue · {v.filled} filled · {v.total} total</div>
              </div>
            ))}
          </div>
          <Table
            title="Overdue records (>60 days past End Date, still in export)"
            cols={["office_id", "full_name", "state", "current_office", "end_date"]}
            headers={["Office ID", "Name", "State", "Office", "End date"]}
            rows={data.overdue_records}
          />
        </>
      );
    }
    case "overlapping_tenures":
      return (
        <>
          <div className="summary-row">
            <Stat label="People checked" value={data.total_count} />
            <Stat label="Overlapping pairs found" value={data.flagged_count} tone="flag" />
          </div>
          <Table
            title="Flagged pairs"
            cols={["person_id", "full_name", "seat_type", "office_a", "start_a", "end_a", "office_b", "start_b", "end_b"]}
            headers={["Person ID", "Name", "Seat type", "Office A", "Start A", "End A", "Office B", "Start B", "End B"]}
            rows={data.records}
          />
        </>
      );
    case "lookalike_parties":
      return (
        <LookalikePartiesBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "multi_party":
      return (
        <>
          <div className="summary-row">
            <Stat label="Unique people checked" value={data.total_count} />
            <Stat label="Flagged (linked to 2+ parties)" value={data.flagged_count} tone="flag" />
          </div>
          <Table
            title="Flagged people"
            cols={["person_id", "full_name", "parties", "record_count"]}
            headers={["Person ID", "Name", "Parties linked", "Record count"]}
            rows={data.records}
          />
        </>
      );
    case "spelling":
      return (
        <SpellingBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "naming_convention":
      return (
        <NamingConventionBody
          data={data}
          tlFilter={tlFilter}
          recurrence={recurrence}
          state={state}
          onStateChange={onStateChange}
          states={states}
          onTlFilterChange={onTlFilterChange}
          tlNames={tlNames}
          onRecurrenceChange={onRecurrenceChange}
        />
      );
    case "upcoming_deadlines":
      return (
        <>
          <div className="summary-row">
            <Stat label="Total tenures with a real end date" value={data.total_count} />
            <Stat label={`Ending within ${data.window_days} days`} value={data.flagged_count} tone="flag" />
          </div>
          <Table
            title="Upcoming end dates"
            cols={["person_id", "office_id", "full_name", "current_office", "state", "end_date", "days_remaining"]}
            headers={["Person ID", "Office ID", "Name", "Office", "State", "End date", "Days left"]}
            rows={data.records}
          />
        </>
      );
    default:
      return <div className="empty-note">No renderer for this validation yet.</div>;
  }
}

const TL_COLOR_PALETTE = ["#4C7EA8", "#B08A2E", "#4C8A63", "#8B5FA3", "#A6403D", "#3F8F8A"];

function colorForTl(tlName, tlNames) {
  if (tlName === "Unassigned") return "#8A7F6B";
  const idx = tlNames.filter((n) => n !== "Unassigned").indexOf(tlName);
  return TL_COLOR_PALETTE[(idx < 0 ? 0 : idx) % TL_COLOR_PALETTE.length];
}

const PERSON_ACCENT = "#2E8B84";
const OFFICEHOLDER_ACCENT = "#7A5AA8";

function PrefixBody({ data, tlFilter }) {
  const [selected, setSelected] = useState("total");

  const byTlMismatch = data.by_tl_mismatch || {};
  const byTlBlank = data.by_tl_blank || {};
  const tlNames = Array.from(new Set([...Object.keys(byTlMismatch), ...Object.keys(byTlBlank)])).sort();

  const allRecords = data.records || [];

  const visibleRows = allRecords.filter((r) => {
    if (selected === "mismatch" && r.issue_type !== "mismatch") return false;
    if (selected === "blank" && r.issue_type !== "blank") return false;
    if (tlFilter && r.tl_name !== tlFilter) return false;
    return true;
  });

  const activeByTl = selected === "mismatch" ? byTlMismatch : selected === "blank" ? byTlBlank : null;

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  const tableRows = selected === "correct" ? [] : visibleRows;

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Records checked" value={data.total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="Prefix correct" value={data.correct_count} tone="ok" active={selected === "correct"} onClick={() => setSelected("correct")} />
        <Stat label="Mismatched" value={data.mismatch_count} tone="flag" active={selected === "mismatch"} onClick={() => setSelected("mismatch")} />
        <Stat label="Blank prefix" value={data.blank_count} tone="warn" active={selected === "blank"} onClick={() => setSelected("blank")} />
      </div>

      {activeByTl && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={activeByTl[tl] || 0} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      {selected === "correct" ? (
        <div className="empty-note" style={{ marginTop: 24 }}>
          {data.correct_count} record(s) have the correct prefix — nothing to review here.
        </div>
      ) : (
        <Table
          title="Flagged records"
          cols={["person_id", "full_name", "state", "gender", "prefix", "expected", "party_full_name", "tl_name", "issue_type"]}
          headers={["Person ID", "Name", "State", "Gender", "Prefix on record", "Expected", "Party", "TL", "Issue"]}
          rows={tableRows}
        />
      )}
    </>
  );
}

function FullNameBody({ data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("total");

  const byTlFullName = data.by_tl_full_name || {};
  const tlNames = Object.keys(byTlFullName).sort();

  const allRecords = data.records || [];

  const visibleRows = allRecords.filter((r) => {
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const repeatCount = allRecords.filter((r) => r.repeat).length;

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Records checked" value={data.total_count} prevValue={data.prev_total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="Format errors" value={data.flagged_count} prevValue={data.prev_flagged_count} tone="flag" active={selected === "flagged"} onClick={() => setSelected("flagged")} />
      </div>

      {selected === "flagged" && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={byTlFullName[tl] || 0} prevValue={(data.prev_by_tl_full_name || {})[tl]} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 -4px", flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same Person ID was already flagged for this same issue yesterday and is still unfixed today</span>
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{repeatCount}</b> total</span>
      </div>

      <FilterBar state={state} onStateChange={onStateChange} states={states} tlFilter={tlFilter} onTlFilterChange={onTlFilterChange} tlNames={tlNameList} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange} />

      <Table
        title="Flagged records"
        cols={["person_id", "full_name", "first_name", "middle_name", "last_name", "state", "party_full_name", "issues", "tl_name"]}
        headers={["Person ID", "Full name", "First", "Middle", "Last", "State", "Party", "Issue(s)", "TL"]}
        rows={visibleRows}
        rowClassName={(r) => (r.repeat ? "dt-row-repeat" : undefined)}
      />
    </>
  );
}

function NamingConventionBody({ data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("total");

  const byTlNaming = data.by_tl_naming_convention || {};
  const tlNames = Object.keys(byTlNaming).sort();

  const allRecords = data.records || [];

  const visibleRows = allRecords.filter((r) => {
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const repeatCount = allRecords.filter((r) => r.repeat).length;

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Total office titles checked" value={data.total_count} prevValue={data.prev_total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="Format mismatches" value={data.flagged_count} prevValue={data.prev_flagged_count} tone="flag" active={selected === "flagged"} onClick={() => setSelected("flagged")} />
      </div>

      {selected === "flagged" && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={byTlNaming[tl] || 0} prevValue={(data.prev_by_tl_naming_convention || {})[tl]} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 -4px", flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same office title was already flagged for this same issue yesterday and is still unfixed today</span>
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{repeatCount}</b> total</span>
      </div>

      <FilterBar state={state} onStateChange={onStateChange} states={states} tlFilter={tlFilter} onTlFilterChange={onTlFilterChange} tlNames={tlNameList} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange} />

      <Table
        title="Naming convention mismatches"
        cols={["id", "value", "expected", "state", "tl_name"]}
        headers={["Office ID", "Office title", "Expected format", "State", "TL"]}
        rows={visibleRows}
        rowClassName={(r) => (r.repeat ? "dt-row-repeat" : undefined)}
      />
    </>
  );
}

function SelectionMethodBody({ data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("total");

  const byTlMissing = data.by_tl_missing || {};
  const tlNames = Object.keys(byTlMissing).sort();

  const allRecords = data.records || [];

  const visibleRows = allRecords.filter((r) => {
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const repeatCount = allRecords.filter((r) => r.repeat).length;

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Records checked" value={data.total_count} prevValue={data.prev_total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="Possible mismatch" value={data.flagged_count} prevValue={data.prev_flagged_count} tone="flag" active={selected === "flagged"} onClick={() => setSelected("flagged")} />
        <Stat label="Blank selection method" value={data.blank_method_count} tone="warn" />
      </div>

      {selected === "flagged" && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={byTlMissing[tl] || 0} prevValue={(data.prev_by_tl_missing || {})[tl]} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      <div className="placeholder-card" style={{ margin: "18px 0 0" }}>
        <b>Reference mapping used</b>
        Appointed: Chief Justice, Judge, Governor, Minister, Cabinet. Indirectly elected: Speaker, Deputy Speaker, President, Vice President, Rajya Sabha, MLC (Local Authorities / Assembly-nominated). Directly elected: MLA, Lok Sabha, MLC (Graduate / Teacher constituencies).
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 -4px", flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same office was already flagged for this same issue yesterday and is still unfixed today</span>
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{repeatCount}</b> total</span>
      </div>

      <FilterBar state={state} onStateChange={onStateChange} states={states} tlFilter={tlFilter} onTlFilterChange={onTlFilterChange} tlNames={tlNameList} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange} />

      <Table
        title="Possible mismatches"
        cols={["office_id", "full_name", "office_role", "current_office", "recorded_method", "expected_method", "tl_name"]}
        headers={["Office ID", "Name", "Office role", "Office", "Recorded method", "Expected", "TL"]}
        rows={visibleRows}
        rowClassName={(r) => (r.repeat ? "dt-row-repeat" : undefined)}
      />
    </>
  );
}

function PartialDatesBody({ data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("total");

  const byTlBlankStart = data.by_tl_blank_start || {};
  const byTlBlankEnd = data.by_tl_blank_end || {};
  const byTlPartial = data.by_tl_partial || {};
  const tlNames = Array.from(new Set([...Object.keys(byTlBlankStart), ...Object.keys(byTlBlankEnd), ...Object.keys(byTlPartial)])).sort();

  const prevByTlBlankStart = data.prev_by_tl_blank_start || {};
  const prevByTlBlankEnd = data.prev_by_tl_blank_end || {};
  const prevByTlPartial = data.prev_by_tl_partial || {};

  const allRecords = data.records || [];

  const visibleRows = allRecords.filter((r) => {
    if (selected === "blank_start" && r.issue_type !== "blank_start") return false;
    if (selected === "blank_end" && r.issue_type !== "blank_end") return false;
    if (selected === "partial" && r.issue_type !== "partial") return false;
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  const activeByTl = selected === "blank_start" ? byTlBlankStart : selected === "blank_end" ? byTlBlankEnd : selected === "partial" ? byTlPartial : null;
  const prevActiveByTl = selected === "blank_start" ? prevByTlBlankStart : selected === "blank_end" ? prevByTlBlankEnd : selected === "partial" ? prevByTlPartial : null;

  const repeatCounts = {
    blank_start: allRecords.filter((r) => r.issue_type === "blank_start" && r.repeat).length,
    blank_end: allRecords.filter((r) => r.issue_type === "blank_end" && r.repeat).length,
    partial: allRecords.filter((r) => r.issue_type === "partial" && r.repeat).length,
  };

  const tableRows = selected === "total"
    ? allRecords.filter((r) => {
        if (tlFilter && r.tl_name !== tlFilter) return false;
        if (recurrence === "repeat" && !r.repeat) return false;
        if (recurrence === "new" && r.repeat) return false;
        return true;
      })
    : visibleRows;

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Total records (verified + active)" value={data.total_count} prevValue={data.prev_total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="Blank start date" value={data.blank_start} prevValue={data.prev_blank_start} tone="flag" active={selected === "blank_start"} onClick={() => setSelected("blank_start")} />
        <Stat label="Blank end date" value={data.blank_end} prevValue={data.prev_blank_end} tone="flag" active={selected === "blank_end"} onClick={() => setSelected("blank_end")} />
        <Stat label="Partial (year/month only)" value={data.partial_start + data.partial_end} prevValue={data.prev_partial_count} tone="warn" active={selected === "partial"} onClick={() => setSelected("partial")} />
      </div>

      {activeByTl && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={activeByTl[tl] || 0} prevValue={prevActiveByTl ? prevActiveByTl[tl] : undefined} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      {selected !== "total" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 -4px", flexWrap: "wrap" }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
          <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same Office ID was already flagged for this same issue yesterday and is still unfixed today</span>
          <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{repeatCounts[selected] || 0}</b> total</span>
        </div>
      )}

      <FilterBar state={state} onStateChange={onStateChange} states={states} tlFilter={tlFilter} onTlFilterChange={onTlFilterChange} tlNames={tlNameList} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange} />

      <Table
        title="Flagged records"
        cols={["office_id", "full_name", "state", "current_office", "start_date", "start_status", "end_date", "end_status", "tl_name", "issue_type"]}
        headers={["Office ID", "Name", "State", "Office", "Start date", "Status", "End date", "Status", "TL", "Issue"]}
        rows={tableRows}
        rowClassName={(r) => (r.repeat ? "dt-row-repeat" : undefined)}
      />
    </>
  );
}

function SocialMediaBody({ data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("person_all");

  const applyFilters = (records) => (records || []).filter((r) => {
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const allPersonRecords = data.person_records || [];
  const allOhRecords = data.officeholder_records || [];
  const personPlatformRecords = data.person_platform_records || {};
  const ohPlatformRecords = data.officeholder_platform_records || {};

  const byTlPersonPlatform = data.by_tl_person_platform || {};
  const byTlOhPlatform = data.by_tl_officeholder_platform || {};
  const prevByTlPersonPlatform = data.prev_by_tl_person_platform || {};
  const prevByTlOhPlatform = data.prev_by_tl_officeholder_platform || {};

  let activeRecords, activeByTl, activePrevByTl;
  if (selected === "person_all") {
    activeRecords = allPersonRecords;
    activeByTl = data.by_tl_missing || {};
    activePrevByTl = data.prev_by_tl_missing || {};
  } else if (selected === "oh_all") {
    activeRecords = allOhRecords;
    activeByTl = data.by_tl_partial || {};
    activePrevByTl = data.prev_by_tl_partial || {};
  } else if (selected.startsWith("person:")) {
    const platform = selected.slice("person:".length);
    activeRecords = personPlatformRecords[platform] || [];
    activeByTl = byTlPersonPlatform[platform] || {};
    activePrevByTl = prevByTlPersonPlatform[platform] || {};
  } else {
    const platform = selected.slice("oh:".length);
    activeRecords = ohPlatformRecords[platform] || [];
    activeByTl = byTlOhPlatform[platform] || {};
    activePrevByTl = prevByTlOhPlatform[platform] || {};
  }

  const tlNames = Object.keys(activeByTl).sort();
  const visibleRows = applyFilters(activeRecords);
  const repeatCount = activeRecords.filter((r) => r.repeat).length;

  const isOfficeholderSide = selected === "oh_all" || selected.startsWith("oh:");
  const tableCols = isOfficeholderSide
    ? ["office_id", "current_office", "state", "government_body", "tl_name"]
    : ["person_id", "full_name", "state", "current_office", "tl_name"];
  const tableHeaders = isOfficeholderSide
    ? ["Office ID", "Office", "State", "Govt body", "TL"]
    : ["Person ID", "Name", "State", "Office", "TL"];

  const summaryRowStyle = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 26 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10, marginBottom: 20 };

  return (
    <>
      <div style={summaryRowStyle}>
        <Stat label="Total records (verified + active)" value={data.total_count} prevValue={data.prev_total_count} />
        <Stat
          label="Missing ALL personal platforms"
          value={data.flagged_count}
          prevValue={data.prev_flagged_count}
          color={PERSON_ACCENT}
          active={selected === "person_all"}
          onClick={() => setSelected("person_all")}
        />
        <Stat
          label="Missing ALL official platforms"
          value={data.partial_count}
          prevValue={data.prev_partial_count}
          color={OFFICEHOLDER_ACCENT}
          active={selected === "oh_all"}
          onClick={() => setSelected("oh_all")}
        />
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Person — personal social media (verified + active only)</div>
      <div className="platform-grid">
        {Object.entries(data.person_missing || {}).map(([k, v]) => (
          <Stat
            key={k}
            label={`${labelize(k)} missing`}
            value={v}
            prevValue={(data.prev_person_missing || {})[k]}
            color={PERSON_ACCENT}
            sub={`of ${data.total_count} records`}
            active={selected === `person:${k}`}
            onClick={() => setSelected(`person:${k}`)}
          />
        ))}
      </div>

      <div className="section-title">Officeholder — official social media (verified + active only)</div>
      <div className="platform-grid">
        {Object.entries(data.officeholder_missing || {}).map(([k, v]) => (
          <Stat
            key={k}
            label={`${labelize(k)} missing`}
            value={v}
            prevValue={(data.prev_officeholder_missing || {})[k]}
            color={OFFICEHOLDER_ACCENT}
            sub={`of ${data.total_count} records`}
            active={selected === `oh:${k}`}
            onClick={() => setSelected(`oh:${k}`)}
          />
        ))}
      </div>

      {tlNames.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 24 }}>
            {selected === "person_all" ? "Missing all personal platforms"
              : selected === "oh_all" ? "Missing all official platforms"
              : selected.startsWith("person:") ? `${labelize(selected.slice(7))} missing (personal)`
              : `${labelize(selected.slice(3))} missing (official)`} — by team lead
          </div>
          <div style={tlRowStyle}>
            {tlNames.map((tl) => (
              <Stat key={tl} label={tl} value={activeByTl[tl] || 0} prevValue={activePrevByTl[tl]} color={colorForTl(tl, tlNames)} compact />
            ))}
          </div>
        </>
      )}

      <FilterBar state={state} onStateChange={onStateChange} states={states} tlFilter={tlFilter} onTlFilterChange={onTlFilterChange} tlNames={tlNameList} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 -4px", flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same person/office was already missing this on yesterday's upload and is still unfixed today</span>
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{repeatCount}</b> total</span>
      </div>

      <Table
        title="Flagged records"
        cols={tableCols}
        headers={tableHeaders}
        rows={visibleRows}
        rowClassName={(r) => (r.repeat ? "dt-row-repeat" : undefined)}
      />
    </>
  );
}

function SpellingBody({ data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("total");

  const byTlTypos = data.by_tl_typos || {};
  const byTlUnrecognized = data.by_tl_unrecognized || {};
  const tlNames = Array.from(new Set([...Object.keys(byTlTypos), ...Object.keys(byTlUnrecognized)])).sort();

  const prevByTlMissing = data.prev_by_tl_missing || {};
  const prevByTlPartial = data.prev_by_tl_partial || {};

  const allTypoRecords = data.records || [];
  const allUnrecognizedRecords = data.unrecognized_records || [];

  const applyFilters = (records) => records.filter((r) => {
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const typoRecords = applyFilters(allTypoRecords);
  const unrecognizedRecords = applyFilters(allUnrecognizedRecords);

  const activeByTl = selected === "typos" ? byTlTypos : selected === "unrecognized" ? byTlUnrecognized : null;
  const prevActiveByTl = selected === "typos" ? prevByTlMissing : selected === "unrecognized" ? prevByTlPartial : null;

  const repeatTypoCount = allTypoRecords.filter((r) => r.repeat).length;
  const repeatUnrecognizedCount = allUnrecognizedRecords.filter((r) => r.repeat).length;

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Total records" value={data.total_count} prevValue={data.prev_total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="Likely typos" value={data.flagged_count} prevValue={data.prev_flagged_count} tone="flag" active={selected === "typos"} onClick={() => setSelected("typos")} />
        <Stat label="Unrecognized words" value={data.unrecognized_count} prevValue={data.prev_partial_count} tone="warn" active={selected === "unrecognized"} onClick={() => setSelected("unrecognized")} />
      </div>

      {activeByTl && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={activeByTl[tl] || 0} prevValue={prevActiveByTl ? prevActiveByTl[tl] : undefined} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      {selected !== "total" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 -4px", flexWrap: "wrap" }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
          <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same flagged word/value was already flagged yesterday and is still unfixed today</span>
          <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{selected === "typos" ? repeatTypoCount : repeatUnrecognizedCount}</b> total</span>
        </div>
      )}

      <FilterBar state={state} onStateChange={onStateChange} states={states} tlFilter={tlFilter} onTlFilterChange={onTlFilterChange} tlNames={tlNameList} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange} />

      {(selected === "total" || selected === "typos") && (
        <Table
          title="Likely typos"
          cols={["id", "field", "value", "flagged_words", "state", "tl_name"]}
          headers={["ID", "Field", "Value", "Flagged word → suggestion", "State", "TL"]}
          rows={typoRecords}
          rowClassName={(r) => (r.repeat ? "dt-row-repeat" : undefined)}
        />
      )}

      {(selected === "total" || selected === "unrecognized") && (
        <>
          <div className="section-title">Unrecognized words <span className="hint">not in any dictionary and no close match — usually Hindi/regional admin terms or Indian proper nouns; mark confirmed-correct ones below so they never appear again</span></div>
          <UnrecognizedWordsTable records={unrecognizedRecords} />
        </>
      )}
    </>
  );
}

function MissingDobBody({ data, tlFilter, recurrence, state, onStateChange, states, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("total");

  const byTlMissing = data.by_tl_missing || {};
  const byTlPartial = data.by_tl_partial || {};
  const tlNames = Array.from(new Set([...Object.keys(byTlMissing), ...Object.keys(byTlPartial)])).sort();

  const prevByTlMissing = data.prev_by_tl_missing || {};
  const prevByTlPartial = data.prev_by_tl_partial || {};

  const allRecords = data.records || [];

  const visibleRows = allRecords.filter((r) => {
    if (selected === "missing" && r.pm !== "M") return false;
    if (selected === "partial" && r.pm !== "P") return false;
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  const activeByTl = selected === "missing" ? byTlMissing : selected === "partial" ? byTlPartial : null;
  const prevActiveByTl = selected === "missing" ? prevByTlMissing : selected === "partial" ? prevByTlPartial : null;

  const repeatMissingCount = allRecords.filter((r) => r.pm === "M" && r.repeat).length;
  const repeatPartialCount = allRecords.filter((r) => r.pm === "P" && r.repeat).length;
  const repeatTotalCount = repeatMissingCount + repeatPartialCount;

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Total records (verified + active)" value={data.total_count} prevValue={data.prev_total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="DOB missing" value={data.flagged_count} prevValue={data.prev_flagged_count} tone="flag" active={selected === "missing"} onClick={() => setSelected("missing")} />
        <Stat label="DOB partial (year / year-month only)" value={data.partial_count} prevValue={data.prev_partial_count} tone="warn" active={selected === "partial"} onClick={() => setSelected("partial")} />
      </div>

      {activeByTl && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={activeByTl[tl] || 0} prevValue={prevActiveByTl ? prevActiveByTl[tl] : undefined} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 -4px", flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same Person ID was already flagged for this same issue (missing/partial) yesterday and is still unfixed today</span>
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{repeatTotalCount}</b> total {" "}(<b style={{ color: "var(--red, #A6403D)" }}>{repeatMissingCount}</b> missing,{" "}
          <b style={{ color: "var(--amber-dark, #8A6427)" }}>{repeatPartialCount}</b> partial)</span>
      </div>

      <FilterBar state={state} onStateChange={onStateChange} states={states} tlFilter={tlFilter} onTlFilterChange={onTlFilterChange} tlNames={tlNameList} recurrence={recurrence} onRecurrenceChange={onRecurrenceChange} />

      <Table
        title="Records missing or partial DOB"
        cols={["person_id", "full_name", "state", "current_office", "birth_date", "tl_name", "pm"]}
        headers={["Person ID", "Name", "State", "Office", "DOB on file", "TL", "P/M"]}
        rows={visibleRows}
        rowClassName={(r) => (r.repeat ? "dt-row-repeat" : undefined)}
      />
    </>
  );
}

// ---------- Look-alike parties: no per-record State filter (a pair
// spans two parties, each with its own multi-state breakdown) — TL +
// Status filters only, using the dominant-TL tag computed on the
// backend. ----------
function LookalikePartiesBody({ data, tlFilter, recurrence, onTlFilterChange, tlNames: tlNameList, onRecurrenceChange }) {
  const [selected, setSelected] = useState("total");

  const byTlMissing = data.by_tl_missing || {};
  const tlNames = Object.keys(byTlMissing).sort();

  const allRecords = data.records || [];

  const visibleRows = allRecords.filter((r) => {
    if (tlFilter && r.tl_name !== tlFilter) return false;
    if (recurrence === "repeat" && !r.repeat) return false;
    if (recurrence === "new" && r.repeat) return false;
    return true;
  });

  const repeatCount = allRecords.filter((r) => r.repeat).length;

  const topRowStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
  const tlRowStyle = { display: "grid", gridTemplateColumns: `repeat(${tlNames.length || 1}, minmax(0, 1fr))`, gap: 10, marginTop: 10 };

  return (
    <>
      <div style={topRowStyle}>
        <Stat label="Distinct party names" value={data.total_count} prevValue={data.prev_total_count} active={selected === "total"} onClick={() => setSelected("total")} />
        <Stat label="Similar-looking pairs" value={data.flagged_count} prevValue={data.prev_flagged_count} tone="warn" active={selected === "flagged"} onClick={() => setSelected("flagged")} />
      </div>

      {selected === "flagged" && (
        <div style={tlRowStyle}>
          {tlNames.map((tl) => (
            <Stat key={tl} label={tl} value={byTlMissing[tl] || 0} prevValue={(data.prev_by_tl_missing || {})[tl]} color={colorForTl(tl, tlNames)} compact />
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 -4px", flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--red-bg, #F7E7E5)", border: "1px solid var(--red, #A6403D)", display: "inline-block" }} />
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}>Red row = same pair of party names was already flagged yesterday and is still unfixed today</span>
        <span style={{ fontSize: 11.5, color: "var(--muted, #6B6558)" }}> — <b style={{ fontSize: 13, color: "var(--red, #A6403D)" }}>{repeatCount}</b> total</span>
      </div>

      <div className="filter-bar-row">
        {tlNameList && tlNameList.length > 0 && (
          <div className="filter-pill">
            <span className="filter-pill-label">TL</span>
            <select value={tlFilter} onChange={(e) => onTlFilterChange(e.target.value)}>
              <option value="">All team leads</option>
              {tlNameList.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}
        {onRecurrenceChange && (
          <div className="filter-pill">
            <span className="filter-pill-label">Status</span>
            <select value={recurrence} onChange={(e) => onRecurrenceChange(e.target.value)}>
              <option value="all">All</option>
              <option value="repeat">Repeat</option>
              <option value="new">New</option>
            </select>
          </div>
        )}
      </div>

      <div className="section-title">Pairs for manual review <span className="hint">most similar first · counts are unique members (Person ID) · click a row to see states + IDs</span></div>
      <LookalikeTable records={visibleRows} />
    </>
  );
}

function Stat({ label, value, tone, sub, active, onClick, color, compact, prevValue }) {
  const style = color ? { borderTop: `3px solid ${color}` } : undefined;

  const hasPrev = prevValue !== undefined && prevValue !== null;
  const delta = hasPrev ? value - prevValue : null;
  const deltaLabel = hasPrev ? (delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0") : null;

  return (
    <div
      className={`stat-card${tone ? " " + tone : ""}${active ? " stat-card-active" : ""}${onClick ? " stat-card-clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{ ...style, ...(compact ? { padding: "10px 11px 9px" } : undefined) }}
    >
      {hasPrev && (
        <div className="stat-prev-badge" title={`Yesterday: ${prevValue}`}>
          <span className="stat-prev-value">{prevValue}</span>
        </div>
      )}
      <div className="label" style={compact ? { fontSize: 9.5, marginBottom: 5, letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : undefined}>
        {label}
      </div>
      <div className="value" style={{ ...(color ? { color } : undefined), ...(compact ? { fontSize: 19 } : undefined) }}>
        {value}
        {hasPrev && (
          <span style={{ fontSize: compact ? 12 : 15, fontWeight: 500, marginLeft: 5, color: delta > 0 ? "#A6403D" : delta < 0 ? "#4C8A63" : "var(--muted)" }}>
            ({deltaLabel})
          </span>
        )}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Table(props) {
  return <DataTable {...props} />;
}

function labelize(key) {
  return key.replace(/^(sm_|oh_)/, "").replace(/^\w/, (c) => c.toUpperCase());
}

function LookalikeTable({ records }) {
  const [openRow, setOpenRow] = useState(null);
  const [filter, setFilter] = useState("");

  const rows = (records || []).filter((r) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (r.party_a || "").toLowerCase().includes(q) || (r.party_b || "").toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="dt-toolbar">
        <input type="text" placeholder="Filter this table…" value={filter} onChange={(e) => setFilter(e.target.value)} className="dt-filter-input" />
        <button
          className="dt-download-btn"
          onClick={() => downloadCsv(
            "lookalike_parties",
            ["Party A", "Members A", "Party B", "Members B", "Similarity %", "TL"],
            ["party_a", "count_a", "party_b", "count_b", "similarity_pct", "tl_name"],
            rows.map((r) => ({ ...r, similarity_pct: Math.round(r.similarity * 100) }))
          )}
          disabled={rows.length === 0}
        >
          ⬇ Download CSV
        </button>
      </div>
    <div className="tablewrap">
      <table>
        <thead>
          <tr><th>Party A</th><th>Members</th><th>Party B</th><th>Members</th><th>Similarity</th><th>TL</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <React.Fragment key={i}>
              <tr onClick={() => setOpenRow(openRow === i ? null : i)} style={{ cursor: "pointer" }} className={r.repeat ? "dt-row-repeat" : undefined}>
                <td>{r.party_a}</td><td>{r.count_a}</td>
                <td>{r.party_b}</td><td>{r.count_b}</td>
                <td>{Math.round(r.similarity * 100)}%</td>
                <td>{r.tl_name}</td>
              </tr>
              {openRow === i && (
                <tr>
                  <td colSpan={6} className="lookalike-expand-cell">
                    <div className="lookalike-detail-row">
                      <PartyDetail name={r.party_a} states={r.states_a} ids={r.person_ids_a} />
                      <PartyDetail name={r.party_b} states={r.states_b} ids={r.person_ids_b} />
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty-note">No matching records</div>}
    </div>
    </div>
  );
}

function PartyDetail({ name, states, ids }) {
  const [filter, setFilter] = useState("");
  const [sortByState, setSortByState] = useState(false);
  const [copied, setCopied] = useState(false);

  const filtered = (ids || []).filter(
    (r) => !filter || r.person_id.toLowerCase().includes(filter.toLowerCase()) || r.state.toLowerCase().includes(filter.toLowerCase())
  );
  const sorted = sortByState ? [...filtered].sort((a, b) => a.state.localeCompare(b.state)) : filtered;

  function copyIds() {
    navigator.clipboard.writeText(sorted.map((r) => r.person_id).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="lookalike-detail">
      <div className="lookalike-detail-header">
        <span className="lookalike-detail-name">{name}</span>
        <span className="lookalike-detail-count">{(ids || []).length} member(s)</span>
      </div>

      <div className="lookalike-state-table">
        {(states || []).length === 0 ? (
          <div className="empty-note" style={{ padding: "6px 0" }}>No state data</div>
        ) : (
          <table>
            <thead><tr><th>State</th><th>Members</th></tr></thead>
            <tbody>
              {states.map((s) => (
                <tr key={s.state}><td>{s.state}</td><td>{s.count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="lookalike-id-controls">
        <input type="text" placeholder="Filter by ID or state…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={() => setSortByState((v) => !v)}>{sortByState ? "Sorted by state" : "Sort by state"}</button>
        <button onClick={copyIds}>{copied ? "Copied!" : "Copy IDs"}</button>
      </div>

      <div className="lookalike-id-table">
        <table>
          <thead><tr><th>Person ID</th><th>State</th></tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.person_id}>
                <td className="mono">{r.person_id}</td>
                <td>{r.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="empty-note" style={{ padding: "8px 0" }}>No matches</div>}
      </div>
    </div>
  );
}

function UnrecognizedWordsTable({ records }) {
  const [marked, setMarked] = useState(new Set());
  const [pending, setPending] = useState(null);
  const [filter, setFilter] = useState("");

  const rows = [];
  (records || []).forEach((r) => {
    r.flagged_words.split(",").map((w) => w.trim()).filter(Boolean).forEach((word) => {
      rows.push({ ...r, word });
    });
  });

  async function markCorrect(word) {
    setPending(word);
    try {
      await addToSpellingAllowlist(word);
      setMarked((prev) => new Set(prev).add(word.toLowerCase()));
    } catch (e) {
      alert(`Couldn't save: ${e.message}`);
    } finally {
      setPending(null);
    }
  }

  let visibleRows = rows.filter((r) => !marked.has(r.word.toLowerCase()));
  if (filter.trim()) {
    const q = filter.trim().toLowerCase();
    visibleRows = visibleRows.filter(
      (r) => r.word.toLowerCase().includes(q) || String(r.value).toLowerCase().includes(q) || String(r.field).toLowerCase().includes(q)
    );
  }

  return (
    <div>
      <div className="dt-toolbar">
        <input type="text" placeholder="Filter this table…" value={filter} onChange={(e) => setFilter(e.target.value)} className="dt-filter-input" />
        <button
          className="dt-download-btn"
          onClick={() => downloadCsv("unrecognized_words", ["ID", "Field", "Value", "Unrecognized word"], ["id", "field", "value", "word"], visibleRows)}
          disabled={visibleRows.length === 0}
        >
          ⬇ Download CSV
        </button>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Field</th><th>Value</th><th>Unrecognized word</th><th></th></tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => (
              <tr key={i} className={r.repeat ? "dt-row-repeat" : undefined}>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.id}</td>
                <td>{r.field}</td>
                <td>{r.value}</td>
                <td style={{ fontWeight: 600 }}>{r.word}</td>
                <td>
                  <button
                    className="deadline-stop-btn"
                    disabled={pending === r.word}
                    onClick={() => markCorrect(r.word)}
                    title="This word is correct — never flag it again on any future upload"
                  >
                    {pending === r.word ? "Saving…" : "Mark as correct"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRows.length === 0 && (
          <div className="empty-note">
            {rows.length === 0 ? "None found" : "All marked as correct — they won't be flagged again on future uploads."}
          </div>
        )}
      </div>
    </div>
  );
}