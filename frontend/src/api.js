const BASE_URL = "http://127.0.0.1:8000"; // FastAPI dev server default port

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  let res;
  try {
    res = await fetch(`${BASE_URL}/upload`, { method: "POST", body: formData });
  } catch (e) {
    throw new Error(`Couldn't reach the backend at ${BASE_URL}. Is it running? (${e.message})`);
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail || ""; } catch { /* not JSON */ }
    throw new Error(`Upload failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export async function getLatestUpload() {
  const res = await fetch(`${BASE_URL}/uploads/latest`);
  if (!res.ok) throw new Error("Failed to check for an existing upload");
  return res.json();
}

export async function clearCurrentUpload() {
  const res = await fetch(`${BASE_URL}/uploads/current`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear the uploaded Excel");
  return res.json();
}

export async function getSummary(uploadId, state) {
  const url = new URL(`${BASE_URL}/uploads/${uploadId}/summary`);
  if (state) url.searchParams.set("state", state);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load summary");
  return res.json();
}

export async function getValidationDetail(uploadId, key, state) {
  const url = new URL(`${BASE_URL}/uploads/${uploadId}/validation/${key}`);
  if (state) url.searchParams.set("state", state);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load validation detail");
  return res.json();
}

// ---------- Generic Deep Dive — works for any check_key that has daily
// snapshot tracking (see backend DEEP_DIVE_CHECK_KEYS) ----------
export async function getCheckDeepDive(checkKey, range) {
  const url = new URL(`${BASE_URL}/deep-dive/${checkKey}`);
  if (range) url.searchParams.set("range", range);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load Deep Dive for ${checkKey}`);
  return res.json();
}

// Kept for backward compatibility — delegates to the generic function above.
export async function getMissingDobDeepDive(range) {
  return getCheckDeepDive("missing_dob", range);
}

export async function deleteMissingDobSnapshot(dateStr) {
  const res = await fetch(`${BASE_URL}/missing-dob/snapshot/${dateStr}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete that day's snapshot");
  return res.json();
}

// ---------- Govt Body Unverified Status: two-file upload flow ----------
export async function uploadGovtBodyFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/govt-body-check/upload-govt-body`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Government Body upload failed");
  return res.json();
}

export async function uploadOfficeDetailsFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/govt-body-check/upload-office-details`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Office Details upload failed");
  return res.json();
}

export async function getGovtBodyCheckResult(govtBodyUploadId, officeUploadId) {
  const url = new URL(`${BASE_URL}/govt-body-check/result`);
  url.searchParams.set("govt_body_upload_id", govtBodyUploadId);
  url.searchParams.set("office_upload_id", officeUploadId);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load Govt Body check result");
  return res.json();
}

// ---------- OH / PE / VIF pending translations ----------
export async function uploadTranslationFile(category, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/translations/upload/${category}`, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`${category.toUpperCase()} translation upload failed`);
  return res.json();
}

export async function getTranslationsResult({ ohUploadId, peUploadId, vifUploadId }) {
  const url = new URL(`${BASE_URL}/translations/result`);
  if (ohUploadId) url.searchParams.set("oh_upload_id", ohUploadId);
  if (peUploadId) url.searchParams.set("pe_upload_id", peUploadId);
  if (vifUploadId) url.searchParams.set("vif_upload_id", vifUploadId);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load translations result");
  return res.json();
}

// ---------- Spelling allowlist: self-service, persists across uploads ----------
export async function addToSpellingAllowlist(word, note) {
  const url = new URL(`${BASE_URL}/spelling-allowlist`);
  url.searchParams.set("word", word);
  if (note) url.searchParams.set("note", note);
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error("Failed to add word to allowlist");
  return res.json();
}

// ---------- TL QC workflow: auth, worklist, actions ----------
export async function login(username, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Invalid username or password");
  return res.json();
}

export async function getMe(token) {
  const url = new URL(`${BASE_URL}/auth/me`);
  url.searchParams.set("token", token);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Session expired");
  return res.json();
}

export async function getTlWorklist(token, checkKey) {
  const url = new URL(`${BASE_URL}/tl/worklist`);
  url.searchParams.set("token", token);
  url.searchParams.set("check_key", checkKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load worklist");
  return res.json();
}

export async function postTlAction(token, checkKey, recordId, state, action, note) {
  const res = await fetch(`${BASE_URL}/tl/action`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, check_key: checkKey, record_id: recordId, state, action, note }),
  });
  if (!res.ok) throw new Error("Failed to save action");
  return res.json();
}

export async function getTlProgressByCheck(token) {
  const url = new URL(`${BASE_URL}/tl/progress-by-check`);
  url.searchParams.set("token", token);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load progress");
  return res.json();
}

export async function getActivityLog({ tlId, state, checkKey, action, dateFrom, dateTo, limit } = {}) {
  const url = new URL(`${BASE_URL}/activity-log`);
  if (tlId) url.searchParams.set("tl_id", tlId);
  if (state) url.searchParams.set("state", state);
  if (checkKey) url.searchParams.set("check_key", checkKey);
  if (action) url.searchParams.set("action", action);
  if (dateFrom) url.searchParams.set("date_from", dateFrom);
  if (dateTo) url.searchParams.set("date_to", dateTo);
  if (limit) url.searchParams.set("limit", limit);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load activity log");
  const data = await res.json();
  return data.entries || [];
}

export async function getActivityLogSummary() {
  const res = await fetch(`${BASE_URL}/activity-log/summary`);
  if (!res.ok) throw new Error("Failed to load activity log summary");
  const data = await res.json();
  return data.summary || [];
}

export async function getActivityLogOverview() {
  const res = await fetch(`${BASE_URL}/activity-log/overview`);
  if (!res.ok) throw new Error("Failed to load activity log overview");
  return res.json();
}

export async function getTeamLeads() {
  const res = await fetch(`${BASE_URL}/team-leads`);
  if (!res.ok) throw new Error("Failed to load team leads");
  return res.json();
}

export async function updateTeamLeadStates(tlId, states, constituencies) {
  const res = await fetch(`${BASE_URL}/team-leads/${tlId}/states`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ states, constituencies: constituencies || [] }),
  });
  if (!res.ok) throw new Error("Failed to update states");
  return res.json();
}

export async function deleteTeamLead(tlId) {
  const res = await fetch(`${BASE_URL}/team-leads/${tlId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete team lead");
  return res.json();
}

export async function createTeamLead(username, name, password, states, role, constituencies) {
  const res = await fetch(`${BASE_URL}/team-leads`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, name, password, states, role, constituencies: constituencies || [] }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail || ""; } catch { /* not JSON */ }
    throw new Error(detail || "Couldn't create account");
  }
  return res.json();
}