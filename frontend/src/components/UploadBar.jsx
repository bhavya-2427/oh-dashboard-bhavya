import React, { useState } from "react";

export default function UploadBar({ fileName, recordCount, onFile, uploading, error, onClear, clearing }) {
  // A file chosen via the picker is only "staged" here — nothing is sent
  // to the server until Submit is clicked. Clear Selection just discards
  // the staged file locally, so a mistaken pick never touches the
  // dashboard's loaded data.
  const [stagedFile, setStagedFile] = useState(null);

  function handlePick(file) {
    setStagedFile(file);
  }

  function handleSubmit() {
    if (!stagedFile) return;
    onFile(stagedFile);
    setStagedFile(null);
  }

  function handleClearSelection() {
    setStagedFile(null);
  }

  return (
    <div>
      <div className="uploadbar">
        <label className="upload-btn">
          OH Excel Upload
          <input
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            value=""
            onChange={(e) => e.target.files[0] && handlePick(e.target.files[0])}
          />
        </label>

        {stagedFile ? (
          <>
            <span className="filename">{stagedFile.name} (not submitted yet)</span>
            <button className="upload-btn" onClick={handleSubmit} disabled={uploading}>
              {uploading ? "Submitting…" : "Submit"}
            </button>
            <button
              className="dt-download-btn"
              style={{ borderColor: "var(--red)", background: "var(--red-bg)", color: "var(--red)" }}
              onClick={handleClearSelection}
              disabled={uploading}
              title="Discard this file — nothing has been uploaded yet"
            >
              Clear Selection
            </button>
          </>
        ) : (
          <span className="filename">
            {uploading ? "Uploading…" : fileName || "No file uploaded yet"}
          </span>
        )}

        {!stagedFile && !uploading && recordCount != null && <span className="rowcount">{recordCount} records loaded</span>}

        {!stagedFile && fileName && !uploading && (
          <button className="dt-download-btn" style={{ borderColor: "var(--red)", background: "var(--red-bg)", color: "var(--red)" }}
            onClick={onClear} disabled={clearing} title="Delete today's submitted Excel and its data so a corrected file can be submitted for today">
            {clearing ? "Deleting…" : "✕ Delete this day's Excel"}
          </button>
        )}
      </div>
      {stagedFile && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-18px 0 24px 2px" }}>
          File selected but not submitted — click Submit to upload and load it, or Clear Selection to discard it. Only one Excel can be submitted per day.
        </div>
      )}
      {!stagedFile && fileName && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-18px 0 24px 2px" }}>
          This file stays loaded — it won't disappear on refresh or re-login. Only one Excel can be submitted per day; use Delete this day's Excel to remove it and submit a corrected file for today.
        </div>
      )}
      {error && (
        <div className="placeholder-card" style={{ borderColor: "var(--red)", marginTop: 12 }}>
          <b style={{ color: "var(--red)" }}>Upload failed</b>
          {error}
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            Common causes: the backend server isn't running, it's on a different port than the
            frontend expects, or the connection timed out. Check the terminal running <code>uvicorn</code> for errors.
          </div>
        </div>
      )}
    </div>
  );
}