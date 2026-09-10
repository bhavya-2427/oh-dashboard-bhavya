import React, { useMemo, useState } from "react";

function csvEscape(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename, headers, cols, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  (rows || []).forEach((r) => {
    lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Drop-in replacement for the old static <Table>. Same props (title, cols,
 * headers, rows) plus sorting (click a header), a free-text filter box that
 * searches every visible column, a "Download CSV" button that exports
 * exactly what's currently filtered/sorted on screen, and an optional
 * rowClassName(row) callback for per-row styling (e.g. highlighting a
 * repeat-offender row in red).
 */
export default function DataTable({ title, cols, headers, rows, filename, rowClassName }) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(1); // 1 asc, -1 desc

  const filtered = useMemo(() => {
    const src = rows || [];
    if (!filter.trim()) return src;
    const q = filter.trim().toLowerCase();
    return src.filter((r) => cols.some((c) => String(r[c] ?? "").toLowerCase().includes(q)));
  }, [rows, filter, cols]);

  const sorted = useMemo(() => {
    if (sortCol == null) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const an = Number(av), bn = Number(bv);
      let cmp;
      if (av !== "" && bv !== "" && !isNaN(an) && !isNaN(bn)) cmp = an - bn;
      else cmp = String(av).localeCompare(String(bv));
      return cmp * sortDir;
    });
    return copy;
  }, [filtered, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => -d);
    } else {
      setSortCol(col);
      setSortDir(1);
    }
  }

  const exportName = filename || (title || "records").toLowerCase().replace(/[^a-z0-9]+/g, "_");

  return (
    <>
      <div className="section-title">
        {title} <span className="hint">{sorted.length}{sorted.length !== (rows || []).length ? ` of ${(rows || []).length}` : ""} record(s)</span>
      </div>
      <div className="dt-toolbar">
        <input
          type="text"
          placeholder="Filter this table…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="dt-filter-input"
        />
        <button
          className="dt-download-btn"
          onClick={() => downloadCsv(exportName, headers, cols, sorted)}
          disabled={sorted.length === 0}
          title="Download exactly what's shown (filtered + sorted) as a CSV"
        >
          ⬇ Download CSV
        </button>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} onClick={() => toggleSort(cols[i])} className="dt-sortable-th" title="Click to sort">
                  {h}{sortCol === cols[i] ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i} className={rowClassName ? rowClassName(r) : undefined}>
                {cols.map((c) => <td key={c}>{r[c] ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="empty-note">No matching records</div>}
      </div>
    </>
  );
}
