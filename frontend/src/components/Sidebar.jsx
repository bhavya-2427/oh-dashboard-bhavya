import React from "react";
import { NAV_GROUPS } from "../navConfig";

const GROUP_COLORS = {
  "Identity & Format": "var(--accent-blue)",
  "Completeness": "var(--accent-amber)",
  "Role & Tenure Logic": "var(--accent-purple)",
  "Party & Duplication": "var(--accent-teal)",
  "Translations": "var(--accent-pink)",
  "Alerts": "var(--red)",
};

export default function Sidebar({ activeKey, onSelect, counts, extraCounts, tlSession, onSelectManagerView, managerActiveView }) {
  const isManager = tlSession && tlSession.role === "manager";

  return (
    <div className="sidebar">
      <div className="brand">
        <div className="seal">OH</div>
        <h1>OH Validations Register</h1>
        <p>Data quality control panel</p>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="navgroup-label">
            <span className="navgroup-dot" style={{ background: GROUP_COLORS[group.label] || "var(--gold)" }} />
            {group.label}
          </div>
          {group.items.map((item) => (
            <div
              key={item.key}
              className={`navitem${!managerActiveView && activeKey === item.key ? " active" : ""}`}
              onClick={() => onSelect(item.key)}
              style={!managerActiveView && activeKey === item.key ? { borderLeftColor: GROUP_COLORS[group.label] || "var(--gold)" } : undefined}
            >
              {item.label}
              <span className="count">
                {item.separateUpload
                  ? (extraCounts?.[item.key] ?? "—")
                  : item.pending
                  ? "—"
                  : counts?.[item.key]?.flagged_count ?? "—"}
              </span>
            </div>
          ))}
        </div>
      ))}

      {isManager && (
        <div>
          <div className="navgroup-label">
            <span className="navgroup-dot" style={{ background: "#4C7EA8" }} />
            Manager
          </div>
          <div
            className={`navitem${managerActiveView === "logs" ? " active" : ""}`}
            onClick={() => onSelectManagerView("logs")}
            style={managerActiveView === "logs" ? { borderLeftColor: "#4C7EA8" } : undefined}
          >
            History &amp; Logs
          </div>
          <div
            className={`navitem${managerActiveView === "manage-tls" ? " active" : ""}`}
            onClick={() => onSelectManagerView("manage-tls")}
            style={managerActiveView === "manage-tls" ? { borderLeftColor: "#4C7EA8" } : undefined}
          >
            Manage TLs &amp; Rights
          </div>
        </div>
      )}
    </div>
  );
}
