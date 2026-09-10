import React, { useState } from "react";
import { uploadGovtBodyFile, uploadOfficeDetailsFile, getGovtBodyCheckResult } from "../api";
import DataTable from "./DataTable";

export default function GovtBodyCheckPage({ onResult }) {
  const [govtFile, setGovtFile] = useState(null);
  const [officeFile, setOfficeFile] = useState(null);
  const [govtUploadId, setGovtUploadId] = useState(null);
  const [officeUploadId, setOfficeUploadId] = useState(null);
  const [govtCount, setGovtCount] = useState(null);
  const [officeCount, setOfficeCount] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleGovtFile(file) {
    setGovtFile(file.name);
    const res = await uploadGovtBodyFile(file);
    setGovtUploadId(res.upload_id);
    setGovtCount(res.records_loaded);
  }

  async function handleOfficeFile(file) {
    setOfficeFile(file.name);
    const res = await uploadOfficeDetailsFile(file);
    setOfficeUploadId(res.upload_id);
    setOfficeCount(res.records_loaded);
  }

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await getGovtBodyCheckResult(govtUploadId, officeUploadId);
      setResult(res);
      onResult?.(res.flagged_count);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const bothUploaded = govtUploadId && officeUploadId;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Govt body unverified status</h2>
        </div>
      </div>
      <div className="logic-note">
        <span className="logic-label">How this check works</span>
        Joins the Office Details export to the Government Body export using Office ID (the only field
        the two exports actually share). An office is flagged if it has no Government Body linked at
        all, or if the Government Body it's linked to has a Status other than "Verified and Approved".
        Runs on every office in the file, not just active ones.
      </div>

      <div className="uploadbar" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <label className="upload-btn">
            1. Upload Government Body export
            <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => e.target.files[0] && handleGovtFile(e.target.files[0])} />
          </label>
          <span className="filename">{govtFile || "No file uploaded yet"}</span>
          {govtCount != null && <span className="rowcount">{govtCount} govt bodies loaded</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <label className="upload-btn">
            2. Upload Office Details export
            <input type="file" accept=".xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => e.target.files[0] && handleOfficeFile(e.target.files[0])} />
          </label>
          <span className="filename">{officeFile || "No file uploaded yet"}</span>
          {officeCount != null && <span className="rowcount">{officeCount} offices loaded</span>}
        </div>
        {bothUploaded && (
          <button className="upload-btn" style={{ width: "fit-content" }} onClick={runCheck} disabled={loading}>
            {loading ? "Checking…" : "3. Run check"}
          </button>
        )}
      </div>

      {!bothUploaded && <div className="empty-note">Upload both files to run this check.</div>}
      {error && <div className="placeholder-card"><b>Error</b>{error}</div>}

      {result && (
        <>
          <div className="summary-row">
            <Stat label="Total offices" value={result.total_offices} />
            <Stat label="Linked to a Verified Govt Body" value={result.clean_count} tone="ok" />
            <Stat label="No govt body link" value={result.no_link_count} tone="flag" />
            <Stat label="Linked govt body unverified" value={result.govt_body_unverified_count} tone="flag" />
          </div>
          <Table
            title="No Government Body linked at all"
            cols={["office_id", "office_name", "role", "state"]}
            headers={["Office ID", "Office Name", "Role", "State"]}
            rows={result.no_link_records}
          />
          <Table
            title="Linked to an unverified Government Body"
            cols={["office_id", "office_name", "government_body_name", "govt_body_status", "role", "state"]}
            headers={["Office ID", "Office Name", "Govt Body", "Govt Body Status", "Role", "State"]}
            rows={result.unverified_records}
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
