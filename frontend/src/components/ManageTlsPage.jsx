import React, { useEffect, useState } from "react";
import { getTeamLeads, updateTeamLeadStates, deleteTeamLead } from "../api";

const ALL_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "National", "Odisha",
  "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export default function ManageTlsPage({ onBack }) {
  const [tls, setTls] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editStates, setEditStates] = useState([]);
  const [editConstituencies, setEditConstituencies] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const tlList = await getTeamLeads();
      setTls(tlList);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function startEdit(tl) {
    setEditingId(tl.id);
    setEditStates(tl.states || []);
    setEditConstituencies((tl.constituencies || []).join(", "));
  }

  function toggleState(s) {
    setEditStates((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function saveStates(tlId) {
    try {
      const constituencies = editConstituencies.split(",").map((s) => s.trim()).filter(Boolean);
      await updateTeamLeadStates(tlId, editStates, constituencies);
      setEditingId(null);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(tl) {
    if (!window.confirm(`Remove ${tl.name} (${tl.username})? They'll be logged out immediately.`)) return;
    try {
      await deleteTeamLead(tl.id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Manage TLs &amp; Rights</h2>
          <p>Assign each TL the states — and optionally specific constituencies within those states — they're responsible for. Saved instantly, and stays exactly as set until you change it here again. This page is manager-only and never visible to TL accounts.</p>
        </div>
      </div>

      {error && <div style={{ color: "var(--red, #A6403D)", fontSize: 12.5, margin: "16px 0" }}>{error}</div>}
      {loading ? (
        <p style={{ fontSize: 13, color: "var(--muted, #6B6558)", marginTop: 20 }}>Loading…</p>
      ) : (
        <div className="tablewrap" style={{ marginTop: 22 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>States</th>
                <th>Constituencies</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tls.map((tl) => (
                <tr key={tl.id}>
                  <td>{tl.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{tl.username}</td>
                  <td>{tl.role}</td>
                  <td style={{ maxWidth: 300 }}>
                    {editingId === tl.id ? (
                      <div style={{
                        maxHeight: 140, overflow: "auto", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4,
                        padding: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginBottom: 6,
                      }}>
                        {ALL_STATES.map((s) => (
                          <label key={s} style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5 }}>
                            <input type="checkbox" checked={editStates.includes(s)} onChange={() => toggleState(s)} />
                            {s}
                          </label>
                        ))}
                      </div>
                    ) : (
                      tl.role === "manager" ? "All states" : (
                        (tl.states || []).length
                          ? (tl.states || []).map((s) => <span key={s} className="scope-chip">{s}</span>)
                          : "— none assigned —"
                      )
                    )}
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    {editingId === tl.id ? (
                      <div>
                        <input
                          value={editConstituencies}
                          onChange={(e) => setEditConstituencies(e.target.value)}
                          placeholder="e.g. Jaipur, Alwar, Kota"
                          style={{ width: "100%", fontSize: 11.5, padding: "6px 8px", border: "1px solid var(--line, #DCD5C4)", borderRadius: 4, marginBottom: 6 }}
                        />
                        <div style={{ fontSize: 10.5, color: "var(--muted, #6B6558)", marginBottom: 6 }}>
                          Comma-separated. Optional — leave blank to give the TL every constituency in their assigned states.
                        </div>
                        <button className="upload-btn" style={{ marginRight: 6 }} onClick={() => saveStates(tl.id)}>Save</button>
                        <button className="deadline-stop-btn" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      tl.role === "manager" ? "All" : (
                        (tl.constituencies || []).length
                          ? (tl.constituencies || []).map((c) => <span key={c} className="scope-chip constituency">{c}</span>)
                          : "— all in assigned states —"
                      )
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {editingId !== tl.id && (
                      <>
                        <button className="deadline-stop-btn" style={{ marginRight: 6 }} onClick={() => startEdit(tl)}>Edit rights</button>
                        <button className="deadline-stop-btn" onClick={() => handleDelete(tl)}>Remove</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tls.length === 0 && <div className="empty-note">No TL/manager accounts yet — create one from the login screen.</div>}
        </div>
      )}
    </div>
  );
}
