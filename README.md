# OH Validations Register

Real project scaffold: **React** frontend, **FastAPI** backend, **SQLite** database
(swap to Postgres later by changing one line in `backend/app/database.py`).

## What's live vs. pending

Live (real logic, tested against your actual Excel files):
- Prefix check (point 2) — Mr./Ms. vs gender; Dr., Prof., Capt., Adv. accepted as valid for either gender
- Full name format (point 7)
- Govt body unverified status (point 1) — only "Verified and Approved" counts as good, confirmed with manager
- Partial dates (point 4)
- Missing social media — person + officeholder (point 8)
- Missing DOB (point 9)
- Selection method mismatch (point 5) — first-pass keyword mapping, replace with your official reference list
- Seat status by state (point 13) — approximates "vacant" as "not marked active"; refine once you confirm exact vacancy statuses
- Overlapping tenures (point 12) — **known noisy, awaiting manager sign-off**. Currently flags ANY date
  overlap for the same person across  tenure records with no grace window (confirmed: no overlap should ever
  be legitimate for a transfer/succession). BUT real data shows people legitimately holding an MLA seat +
  multiple Minister portfolios at the same time, which this currently flags too. Needs an exception rule for
  concurrent-but-different offices before this is trustworthy — see the in-app note on this page.
- Look-alike parties (point 11) — NOT auto-merging anything. Finds party names that look textually similar
  (e.g. "Shiv Sena" vs "Shivsena", "RPI" vs "RPI(A)") and shows each one's member count side by side so a
  human can QC whether it's a real typo/duplicate or two genuinely distinct parties.
- Multi-party check (point 15) — groups by the real **Person ID** column (not name — common Indian names
  like "Amit Kumar" collide across different real people, tested and confirmed this matters a lot). Flags
  anyone whose Person ID is linked to more than one distinct Party Name across their tenure records. Found
  14 genuine flags out of 9,229 people in the real file — many look like duplicate-entry issues (same
  office, same exact dates, listed once as "Independent" and once under a real party name).

Pending (need reference lists / logic sign-off from your team before they can be built):
- Spelling errors (6) — needs approved reference list of correct office/govt body names
- Translations (10) — needs the actual OH/PE/VIF translation source files
- Alerts (14) — needs the deadline window (e.g. 30 days) and which date fields count as deadlines
- Govt IDs in separate column (3) — explicitly parked earlier, not started

## Background context gathered on the source system (the "feed tool")

The Excel exports come from an internal feed tool with 6 tabs: Party Details, Person Details,
Party Leadership, Office Details, Government Body, Office Holder Tenure. Key facts that shape
validation logic:
- Status values across all tabs: **Unverified / Verified and Approved / Verified and Rejected**
- Mandatory (`*`) fields per tab — Party Details: Full Name, Status, Country/States, Source. Person
  Details: Full Name, Party Affiliation, Gender, Source (Prefix/DOB/socials are NOT mandatory in the
  tool, which is exactly why those validations matter). Office Details: Office Name, Level, Jurisdiction,
  Role, Seat Placement Method, Source. Government Body: Government Body, Office Name, Source.
  Office Holder Tenure: Office Name, Person Full Name, Constituency, Seat Placement, Source —
  **Start/End Date, Seat Status, and Office Term Type are NOT mandatory**, which is why partial/blank
  dates are so common in real exports.
- Seat Placement / Selection Method has exactly 3 values: directly-elected, indirectly-elected, appointed
- Party Chair (not Party Leader — that's for other countries) should correspond to an actual OH record —
  potential future validation, not yet built
- Non-executive roles (e.g. Secretary to the President) are associated people but NOT officeholders —
  should be excluded from OH-specific checks if they ever appear in an export

## Running it locally

### Backend
```
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Runs on http://127.0.0.1:8000. Interactive API docs at http://127.0.0.1:8000/docs.

### Frontend
```
cd frontend
npm install
npm run dev
```
Runs on http://127.0.0.1:5173 and calls the backend at port 8000 (see `src/api.js`).

## How data flows

1. User uploads an OH Excel file in the browser.
2. Frontend POSTs it to `/upload`.
3. Backend parses the `DB` sheet using the fixed column layout in `validations.py`,
   runs every validation, and stores both the raw parsed records and the validation
   summary counts in SQLite.
4. Frontend fetches `/uploads/{id}/summary` for sidebar counts, and
   `/uploads/{id}/validation/{key}` for each page's flagged-record table.
5. The state filter re-queries both endpoints with `?state=...`.

## Where things live

- `backend/app/validations.py` — every validation's logic. Add a new function + register
  it in `REGISTRY` to add a new check.
- `backend/app/database.py` — SQLite models. The current MVP stores the whole parsed
  dataset as JSON per upload for simplicity; for production scale, split this into a
  proper `records` table with real columns and indexes.
- `frontend/src/navConfig.js` — sidebar structure. Add an item here (with `pending: true`
  if the backend isn't ready yet) to add a new page.
- `frontend/src/components/ValidationPage.jsx` — one render case per live validation key.

## Known gaps to fix before this goes to more than one user

- No authentication — fine for an internal single-team tool, add before wider rollout.
- CORS is currently locked to `http://localhost:5173` — update in `backend/app/main.py`
  once you know the real deployment URL.
- The whole dataset re-computes on every upload; for very large files this is fine
  (tested at ~14,500 rows in under a couple seconds), but if files grow much larger,
  consider background job processing (e.g. Celery) instead of doing it inline in the
  request.
