import React, { useState } from "react";
import { login, createTeamLead } from "../api";

const ALL_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "National", "Odisha",
  "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" | "create"

  // login fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // create-account fields
  const [newUsername, setNewUsername] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("tl");
  const [selectedStates, setSelectedStates] = useState([]);
  const [created, setCreated] = useState(null);

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(username, password);
      localStorage.setItem("oh_tl_token", result.token);
      onLogin(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await createTeamLead(newUsername, newName, newPassword, selectedStates, newRole);
      setCreated({ username: newUsername });
      setUsername(newUsername);
      setPassword("");
      setMode("login");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleState(s) {
    setSelectedStates((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <div className="login-screen">
      <div className="login-hero">
        <div className="login-hero-seal">OH</div>
        <h1>OH Validations Register</h1>
        <p className="login-hero-tag">Data Quality Control Panel</p>
        <p className="login-hero-desc">
          Centralized QC for Office Holder records — prefix &amp; naming checks, completeness,
          role &amp; tenure logic, party duplication, and translation review, with full
          state/constituency-scoped access for every Team Lead.
        </p>
        <div className="login-hero-tls">
          <span className="login-hero-tls-label">Team leads</span>
          <div className="login-hero-tls-chips">
            <span className="scope-chip">Deepak</span>
            <span className="scope-chip">Rituraj</span>
            <span className="scope-chip">Divya</span>
            <span className="scope-chip">Gaurav</span>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>{mode === "login" ? "Sign in" : "Create TL / Manager Account"}</h2>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted, #6B6558)" }}>
              {mode === "login" ? "Enter your username and password to continue" : "OH Validations Register — QC workflow"}
            </p>
          </div>

          {created && mode === "login" && (
            <div style={{ color: "var(--green, #3F6B4F)", fontSize: 12.5, textAlign: "center" }}>
              Account "{created.username}" created — sign in below.
            </div>
          )}

          {mode === "login" ? (
            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted, #6B6558)", display: "block", marginBottom: 4 }}>Username</label>
                <input
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  required autoFocus
                  style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4, fontSize: 13.5 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted, #6B6558)", display: "block", marginBottom: 4 }}>Password</label>
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4, fontSize: 13.5 }}
                />
              </div>

              {error && <div style={{ color: "var(--red, #A6403D)", fontSize: 12.5 }}>{error}</div>}

              <button type="submit" className="upload-btn" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
              <button type="button" className="deadline-stop-btn" onClick={() => { setError(null); setMode("create"); }}>
                + Create a new TL / Manager account
              </button>
            </form>
          ) : (
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted, #6B6558)", display: "block", marginBottom: 4 }}>Full name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus
                style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4, fontSize: 13.5 }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--muted, #6B6558)", display: "block", marginBottom: 4 }}>Username</label>
                <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required
                  style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4, fontSize: 13.5 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--muted, #6B6558)", display: "block", marginBottom: 4 }}>Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required
                  style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4, fontSize: 13.5 }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted, #6B6558)", display: "block", marginBottom: 4 }}>Role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4, fontSize: 13.5 }}>
                <option value="tl">Team Lead (scoped to selected states)</option>
                <option value="manager">Manager (sees all states)</option>
              </select>
            </div>
            {newRole === "tl" && (
              <div>
                <label style={{ fontSize: 12, color: "var(--muted, #6B6558)", display: "block", marginBottom: 6 }}>
                  Assigned state(s) — {selectedStates.length} selected
                </label>
                <div style={{
                  maxHeight: 160, overflow: "auto", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4,
                  padding: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4,
                }}>
                  {ALL_STATES.map((s) => (
                    <label key={s} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedStates.includes(s)} onChange={() => toggleState(s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && <div style={{ color: "var(--red, #A6403D)", fontSize: 12.5 }}>{error}</div>}

            <button type="submit" className="upload-btn" disabled={loading}>
              {loading ? "Creating…" : "Create account"}
            </button>
            <button type="button" className="deadline-stop-btn" onClick={() => { setError(null); setMode("login"); }}>
              ← Back to sign in
            </button>
          </form>
        )}
        </div>
      </div>
    </div>
  );
}
