import React, { useState } from "react";
import { uploadTranslationFile, getTranslationsResult } from "../api";
import DataTable, { downloadCsv } from "./DataTable";

const SLOTS = [
  { key: "oh", label: "OH" },
  { key: "pe", label: "PE" },
  { key: "vif", label: "VIF" },
];

export default function TranslationsCheckPage({ onResult }) {
  const [files, setFiles] = useState({});      // key -> filename
  const [uploadIds, setUploadIds] = useState({}); // key -> upload_id
  const [counts, setCounts] = useState({});    // key -> records_loaded
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(key, file) {
    setFiles((f) => ({ ...f, [key]: file.name }));
    setError(null);
    try {
      const res = await uploadTranslationFile(key, file);
      setUploadIds((u) => ({ ...u, [key]: res.upload_id }));
      setCounts((c) => ({ ...c, [key]: res.records_loaded }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await getTranslationsResult({
        ohUploadId: uploadIds.oh,
        peUploadId: uploadIds.pe,
        vifUploadId: uploadIds.vif,
      });
      setResult(res);
      onResult?.(res.unverified_count);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const anyUploaded = SLOTS.some((s) => uploadIds[s.key]);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>OH / PE / VIF pending translations</h2>
        </div>
      </div>
      <div className="logic-note">
        <span className="logic-label">How this check works</span>
        Upload one or more translation exports (OH / PE / VIF). Each language column is classified as
        "not started" (cell is blank — translation hasn't been attempted), "unverified" (translated,
        but its Status column isn't marked Verified yet), or "verified" (done). The "Pending" totals
        below are unverified + not-started combined, but the two are always broken out separately too.
      </div>

      <div className="uploadbar" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        {SLOTS.map((s, i) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <label className="upload-btn">
              {i + 1}. Upload {s.label} translation export
              <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => e.target.files[0] && handleFile(s.key, e.target.files[0])} />
            </label>
            <span className="filename">{files[s.key] || "No file uploaded yet"}</span>
            {counts[s.key] != null && <span className="rowcount">{counts[s.key]} {s.label} records loaded</span>}
          </div>
        ))}
        {anyUploaded && (
          <button className="upload-btn" style={{ width: "fit-content" }} onClick={runCheck} disabled={loading}>
            {loading ? "Checking…" : "Run check"}
          </button>
        )}
      </div>

      {!anyUploaded && <div className="empty-note">Upload at least one of OH, PE, or VIF translation exports to run this check.</div>}
      {error && <div className="placeholder-card"><b>Error</b>{error}</div>}

      {result && (
        <>
          <div className="summary-row">
            <Stat label="People/records covered" value={result.total_records} />
            <Stat label="Language slots checked" value={result.total_language_slots} />
            <Stat label="Verified" value={result.verified_count} tone="ok" />
            <Stat label="Unverified (translated, not signed off)" value={result.unverified_count} tone="flag" />
            <Stat label="Not started (blank, no attempt yet)" value={result.not_started_count} />
            <Stat label="People with ≥1 unverified translation" value={result.people_with_unverified} tone="flag" />
          </div>

          <div className="section-title">Unverified by category <span className="hint">translated but not marked Verified — split by which export it came from</span></div>
          <div className="platform-grid">
            {Object.entries(result.by_category || {}).map(([cat, v]) => (
              <Stat key={cat} label={`${cat} unverified`} value={v} tone={v > 0 ? "flag" : "ok"} />
            ))}
          </div>

          <ByLanguageTable rows={result.by_language} />

          <Table
            title="Unverified translations"
            cols={["id", "name", "category", "language", "translation_status"]}
            headers={["ID", "Name", "Category", "Language", "Status"]}
            rows={result.records}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat-card${tone ? " " + tone : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function Table(props) {
  return <DataTable {...props} />;
}

function ByLanguageTable({ rows }) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(1);

  let data = rows || [];
  if (filter.trim()) {
    const q = filter.trim().toLowerCase();
    data = data.filter((r) => r.language.toLowerCase().includes(q));
  }
  if (sortCol) {
    data = [...data].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return cmp * sortDir;
    });
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => -d);
    else { setSortCol(col); setSortDir(1); }
  }

  const cols = ["language", "total", "not_started", "unverified", "verified"];
  const headers = ["Language", "Total", "Not started", "Unverified", "Verified"];

  return (
    <>
      <div className="section-title">By language <span className="hint">not started vs unverified vs verified, sorted by unverified first</span></div>
      <div className="dt-toolbar">
        <input type="text" placeholder="Filter by language…" value={filter} onChange={(e) => setFilter(e.target.value)} className="dt-filter-input" />
        <button className="dt-download-btn" onClick={() => downloadCsv("translations_by_language", headers, cols, data)} disabled={data.length === 0}>
          ⬇ Download CSV
        </button>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} className="dt-sortable-th" onClick={() => toggleSort(cols[i])}>
                  {h}{sortCol === cols[i] ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.language}>
                <td>{r.language}</td><td>{r.total}</td>
                <td>{r.not_started}</td>
                <td style={{ fontWeight: 600, color: r.unverified > 0 ? "var(--red, #B3261E)" : undefined }}>{r.unverified}</td>
                <td>{r.verified}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <div className="empty-note">No matching languages</div>}
      </div>
    </>
  );
}
