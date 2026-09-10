import React, { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import UploadBar from "./components/UploadBar";
import ValidationPage from "./components/ValidationPage";
import PlaceholderPage from "./components/PlaceholderPage";
import GovtBodyCheckPage from "./components/GovtBodyCheckPage";
import TranslationsCheckPage from "./components/TranslationsCheckPage";
import DeadlinePopup from "./components/DeadlinePopup";
import LoginPage from "./components/LoginPage";
import TlWorklistPage from "./components/TlWorklistPage";
import ManageTlsPage from "./components/ManageTlsPage";
import LogsPage from "./components/LogsPage";
import DeepDivePage from "./components/DeepDivePage";
import { uploadFile, getSummary, getMe, getLatestUpload, clearCurrentUpload, getTeamLeads } from "./api";
import { NAV_GROUPS } from "./navConfig";
import { METRICS_BY_CHECK, DEEP_DIVE_TITLES } from "./deepDiveConfig";

const PENDING_KEYS = new Set(
  NAV_GROUPS.flatMap((g) => g.items.filter((i) => i.pending).map((i) => i.key))
);

export default function App() {
  const [activeKey, setActiveKey] = useState("prefix");
  const [uploadId, setUploadId] = useState(null);
  const [fileName, setFileName] = useState("");
  const [recordCount, setRecordCount] = useState(null);
  const [states, setStates] = useState([]);
  const [state, setState] = useState("");
  const [tlNames, setTlNames] = useState([]);
  const [tlFilter, setTlFilter] = useState("");
  const [counts, setCounts] = useState(null);
  const [extraCounts, setExtraCounts] = useState({});
  const [uploadError, setUploadError] = useState(null);
  const [uploading, setUploading] = useState(false);

  // TL/manager session — separate from the main uploader dashboard above.
  const [tlSession, setTlSession] = useState(null);
  const [tlChecking, setTlChecking] = useState(true);
  // "dashboard" | "tl" | "manage-tls" | "logs" | "deep-dive"
  const [viewMode, setViewMode] = useState("dashboard");
  const [qcCheckKey, setQcCheckKey] = useState(null); // which check's "Team Lead QC" button was clicked
  const [deepDiveCheckKey, setDeepDiveCheckKey] = useState(null); // which check's "Deep Dive" button was clicked

  useEffect(() => {
    const token = localStorage.getItem("oh_tl_token");
    if (!token) { setTlChecking(false); return; }
    getMe(token)
      .then((me) => setTlSession({ ...me, token }))
      .catch(() => localStorage.removeItem("oh_tl_token"))
      .finally(() => setTlChecking(false));
  }, []);

  // Global Team Lead filter list — same lifecycle as the States filter:
  // loaded once and available everywhere, independent of which Excel is
  // currently uploaded.
  useEffect(() => {
    getTeamLeads()
      .then((list) => {
        const names = (list || [])
          .filter((t) => t.role !== "manager")
          .map((t) => t.name)
          .sort((a, b) => a.localeCompare(b));
        setTlNames(names);
      })
      .catch(() => {});
  }, []);

  function handleLogout() {
    localStorage.removeItem("oh_tl_token");
    setTlSession(null);
    setQcCheckKey(null);
    setDeepDiveCheckKey(null);
    setViewMode("dashboard");
  }

  function goToTlQc(checkKey) {
    setQcCheckKey(checkKey);
    setViewMode("tl");
  }

  // Called from ValidationPage's "Deep Dive" button with the check_key of
  // whichever page it was clicked on — the SAME generic DeepDivePage is
  // rendered below for every check, just with different config pulled
  // from METRICS_BY_CHECK / DEEP_DIVE_TITLES by that key.
  function goToDeepDive(checkKey) {
    setDeepDiveCheckKey(checkKey);
    setViewMode("deep-dive");
  }

  async function handleFile(file) {
    setFileName(file.name);
    setUploadError(null);
    setUploading(true);
    try {
      const res = await uploadFile(file);
      setUploadId(res.upload_id);
      setRecordCount(res.records_loaded);
      setStates(res.states);
      setState("");
      await refreshCounts(res.upload_id, "");
    } catch (e) {
      setUploadError(e.message || "Upload failed — check that the backend server is running and reachable.");
      setRecordCount(null);
    } finally {
      setUploading(false);
    }
  }

  const [lastUpdated, setLastUpdated] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [clearing, setClearing] = useState(false);

  async function refreshCounts(id, st) {
    const summary = await getSummary(id, st);
    setCounts(summary);
    setLastUpdated(new Date());
  }

  // Restore whatever Excel is already loaded on the backend — the uploaded
  // dataset persists (it's saved in the DB) and should stay put across page
  // reloads until someone uploads a new file or hits Clear Excel.
  useEffect(() => {
    getLatestUpload()
      .then(async (info) => {
        if (info.upload_id) {
          setUploadId(info.upload_id);
          setFileName(info.filename || "");
          setRecordCount(info.records_loaded);
          setStates(info.states || []);
          await refreshCounts(info.upload_id, "");
        }
      })
      .catch(() => {})
      .finally(() => setRestoring(false));
  }, []);

  async function handleClearExcel() {
    if (!window.confirm("Clear the uploaded Excel? This removes the current dataset from the dashboard — you'll need to re-upload to see data again.")) return;
    setClearing(true);
    try {
      await clearCurrentUpload();
      setUploadId(null);
      setFileName("");
      setRecordCount(null);
      setStates([]);
      setState("");
      setCounts(null);
      setExtraCounts({});
      setUploadError(null);
    } catch (e) {
      setUploadError(e.message || "Failed to clear the uploaded Excel.");
    } finally {
      setClearing(false);
    }
  }

  function handleStateChange(newState) {
    setState(newState);
    if (uploadId) refreshCounts(uploadId, newState);
  }

  if (tlChecking || restoring) return null;

  // Hard gate: nobody sees any dashboard — manager's or TL's — without
  // signing in first. One login form; the account's role alone decides
  // where it lands. No separate "Team Lead Login" / "Manager Login"
  // buttons, no dashboard peeking through behind them.
  if (!tlSession) {
    return (
      <LoginPage
        onLogin={(result) => {
          setTlSession(result);
          setViewMode(result.role === "manager" ? "dashboard" : "tl");
        }}
      />
    );
  }

  if (viewMode === "tl") {
    return (
      <TlWorklistPage
        tl={tlSession}
        token={tlSession.token}
        onLogout={handleLogout}
        onBackToDashboard={tlSession.role === "manager" ? () => setViewMode("dashboard") : null}
        initialCheckKey={qcCheckKey}
      />
    );
  }

  const deepDiveTitleEntry = deepDiveCheckKey ? DEEP_DIVE_TITLES[deepDiveCheckKey] : null;
  const deepDiveMetrics = deepDiveCheckKey ? METRICS_BY_CHECK[deepDiveCheckKey] : null;

  return (
    <div className="app">
      <DeadlinePopup uploadId={uploadId} />
      <Sidebar
        activeKey={activeKey}
        onSelect={(key) => { setActiveKey(key); setViewMode("dashboard"); }}
        counts={counts}
        extraCounts={extraCounts}
        tlSession={tlSession}
        managerActiveView={viewMode === "manage-tls" || viewMode === "logs" ? viewMode : null}
        onSelectManagerView={setViewMode}
      />
      <div className="main">
        <div className="session-toolbar">
          <span className="session-who">
            <span className="session-avatar">{(tlSession.name || "?").slice(0, 1).toUpperCase()}</span>
            {tlSession.name}
            <span className="session-role-badge">{tlSession.role}</span>
          </span>
          {tlSession.role !== "manager" && (
            <button className="tb-btn" onClick={() => setViewMode("tl")}>Go to my worklist</button>
          )}
          {tlSession.role === "manager" && (
            <button className="tb-btn" onClick={() => setViewMode("logs")}>History &amp; Logs</button>
          )}
          <button className="tb-btn tb-btn-danger" onClick={handleLogout}>Log out</button>
        </div>
        {activeKey === "govt_body_status" && viewMode === "dashboard" ? (
          <GovtBodyCheckPage onResult={(v) => setExtraCounts((c) => ({ ...c, govt_body_status: v }))} />
        ) : activeKey === "translations" && viewMode === "dashboard" ? (
          <TranslationsCheckPage onResult={(v) => setExtraCounts((c) => ({ ...c, translations: v }))} />
        ) : viewMode === "logs" && tlSession?.role === "manager" ? (
          <LogsPage onBack={() => setViewMode("dashboard")} />
        ) : viewMode === "manage-tls" && tlSession?.role === "manager" ? (
          <ManageTlsPage onBack={() => setViewMode("dashboard")} />
        ) : viewMode === "deep-dive" && tlSession?.role === "manager" && deepDiveCheckKey && deepDiveMetrics ? (
          <DeepDivePage
            checkKey={deepDiveCheckKey}
            pageTitle={deepDiveTitleEntry ? deepDiveTitleEntry[0] : "Deep Dive"}
            pageSubtitle={deepDiveTitleEntry ? deepDiveTitleEntry[1] : ""}
            metrics={deepDiveMetrics}
            onBack={() => setViewMode("dashboard")}
          />
        ) : (
          <>
            <UploadBar
              fileName={fileName}
              recordCount={recordCount}
              onFile={handleFile}
              uploading={uploading}
              error={uploadError}
              onClear={handleClearExcel}
              clearing={clearing}
            />
            {PENDING_KEYS.has(activeKey) ? (
              <PlaceholderPage pageKey={activeKey} />
            ) : (
              <ValidationPage
                uploadId={uploadId}
                pageKey={activeKey}
                state={state}
                onStateChange={handleStateChange}
                states={states}
                tlFilter={tlFilter}
                onTlFilterChange={setTlFilter}
                tlNames={tlNames}
                onQc={goToTlQc}
                onDeepDive={tlSession.role === "manager" ? goToDeepDive : null}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}