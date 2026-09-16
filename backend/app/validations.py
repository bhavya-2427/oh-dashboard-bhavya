"""
All 15 validation checks live here. Each function takes the parsed
DataFrame and returns either a summary (counts) or, when detail=True,
a summary plus the flagged rows themselves (for the drill-down table).

Column positions match the fixed "DB" sheet template used in the
OfficeHolder India exports. If the export template changes, only
COLUMN_MAP needs updating — nothing else.
"""
import re
import os
import pandas as pd

COLUMN_MAP = {
    "country": 0, "state": 1,
    "person_status": 2, "person_record_status": 3,
    "person_id": 10,
    "prefix": 11, "first_name": 12, "middle_name": 13, "last_name": 14, "full_name": 15,
    "birth_date": 19,
    "sm_youtube": 20, "sm_facebook": 21, "sm_twitter": 22, "sm_instagram": 23, "sm_linkedin": 24, "sm_tiktok": 25,
    "gender": 26,
    "party_full_name": 38, "party_abbrev": 39,
    "office_status": 54,
    "office_id": 62,
    "current_office": 63, "office_role": 66,
    "oh_youtube": 70, "oh_facebook": 71, "oh_twitter": 72, "oh_instagram": 73, "oh_linkedin": 74, "oh_tiktok": 75,
    "seat_placement_method": 76, "government_body": 77,
    "tenure_constituency": 89,
    "start_date": 92, "end_date": 93,
    "tenure_seat_method": 94, "seat_status": 95,
}

TITLE_PREFIXES = {"Dr.", "Prof.", "Capt.", "Adv.", "Col."}
APPOINTED_KEYWORDS = ["judge", "governor", "minister", "cabinet"]
INDIRECT_KEYWORDS = ["speaker", "deputy speaker", "dy. speaker", "chairman", "vice chairman", "vice-chairman"]


def build_dataframe(raw: pd.DataFrame) -> pd.DataFrame:
    """raw = sheet read with header=None. Data starts at row index 5 (0-based)."""
    data = raw.iloc[5:].reset_index(drop=True)
    out = pd.DataFrame()
    for name, idx in COLUMN_MAP.items():
        if idx < data.shape[1]:
            col = data[idx].fillna("").astype(str).str.strip()
            out[name] = col.replace({"nan": "", "None": "", "NaT": ""})
        else:
            out[name] = ""
    out = out[out.apply(lambda r: any(v not in ("", "nan") for v in r), axis=1)].reset_index(drop=True)
    return out


def _all(df):
    return df.to_dict(orient="records")


# ---------- Point 2: Prefix ----------
def check_prefix(df, detail=False, limit=None):
    df = _verified_active(df)
    rows = df[df["gender"].isin(["Male", "Female"])].copy()
    expected = rows["gender"].map({"Male": "Mr.", "Female": "Ms."})
    is_title = rows["prefix"].isin(TITLE_PREFIXES)
    is_blank = rows["prefix"] == ""
    is_mismatch = (~is_title) & (~is_blank) & (rows["prefix"] != expected)
    result = {
        "total_count": len(rows),
        "flagged_count": int(is_mismatch.sum() + is_blank.sum()),
        "correct_count": int(len(rows) - is_mismatch.sum() - is_blank.sum()),
        "mismatch_count": int(is_mismatch.sum()),
        "blank_count": int(is_blank.sum()),
    }
    if detail:
        flagged = rows[is_mismatch | is_blank].copy()
        flagged["expected"] = expected[is_mismatch | is_blank]
        # "issue_type" lets the frontend split the combined flagged list back
        # into its Mismatched vs Blank Prefix halves (and tag each with a
        # TL) without re-deriving the same boolean logic a second time.
        flagged["issue_type"] = is_mismatch[is_mismatch | is_blank].map({True: "mismatch", False: "blank"})
        result["records"] = _all(flagged[["person_id", "full_name", "state", "gender", "prefix", "expected", "party_full_name", "issue_type"]])
    return result


# ---------- Point 7: Full name format ----------
# Confirmed rule: First Name and Last Name must both be present whenever
# there is any name data. Only Middle Name may be blank. A record where
# First AND Last are both blank is still flagged, not skipped.
def check_full_name(df, detail=False, limit=None):
    df = _verified_active(df)

    def issues(row):
        probs = []
        if not row["first_name"] and not row["last_name"]:
            probs.append("First and last name both blank")
        else:
            if not row["first_name"]:
                probs.append("Missing first name")
            if not row["last_name"]:
                probs.append("Missing last name")
        full = row["full_name"]
        if full:
            if full != full.strip():
                probs.append("Leading/trailing space")
            if re.search(r"\s{2,}", full):
                probs.append("Double space")
        return probs

    df = df.copy()
    df["_issues"] = df.apply(issues, axis=1)
    flagged = df[df["_issues"].map(len) > 0].copy()
    flagged["issues"] = flagged["_issues"].map(lambda x: ", ".join(x))
    flagged = flagged.drop_duplicates(subset=["person_id"])
    result = {"total_count": df["person_id"].nunique(), "flagged_count": len(flagged)}
    if detail:
        out = flagged[["person_id", "full_name", "first_name", "middle_name", "last_name", "state", "party_full_name", "issues"]]
        result["records"] = _all(out)
    return result


# ---------- Point 1: Govt body unverified status ----------
def check_govt_body_status(df, detail=False, limit=None):
    flagged = df[(df["office_status"] != "") & (df["office_status"] != "Verified and Approved")]
    result = {"total_count": len(df), "flagged_count": len(flagged)}
    if detail:
        result["records"] = _all(flagged[["office_id", "government_body", "current_office", "state", "office_status", "office_role"]])
    return result


def _verified_active(df):
    return df[
        (df["person_status"] == "Verified and Approved")
        & (df["person_record_status"].str.lower() == "active")
    ]


# ---------- Point 4: Partial dates ----------
def _classify_date(v: str) -> str:
    if not v:
        return "blank"
    if re.match(r"^\d{4}-\d{2}-\d{2}$", v):
        return "complete"
    if re.match(r"^\d{4}-\d{2}$", v):
        return "year-month"
    if re.match(r"^\d{4}$", v):
        return "year-only"
    return "unrecognized"


def check_partial_dates(df, detail=False, limit=None):
    df = _verified_active(df).copy()
    df["_start_class"] = df["start_date"].map(_classify_date)
    df["_end_class"] = df["end_date"].map(_classify_date)
    flagged = df[(df["_start_class"] != "complete") | (df["_end_class"] != "complete")]
    result = {
        "total_count": len(df),
        "flagged_count": len(flagged),
        "blank_start": int((df["_start_class"] == "blank").sum()),
        "blank_end": int((df["_end_class"] == "blank").sum()),
        "partial_start": int(df["_start_class"].isin(["year-only", "year-month"]).sum()),
        "partial_end": int(df["_end_class"].isin(["year-only", "year-month"]).sum()),
    }
    if detail:
        cols = ["office_id", "full_name", "state", "current_office", "start_date", "_start_class", "end_date", "_end_class"]
        rename = {"_start_class": "start_status", "_end_class": "end_status"}

        result["records"] = _all(flagged[cols].rename(columns=rename))

        # Three separate bucket lists, one per card — a row CAN appear in
        # more than one bucket (e.g. blank start date AND partial end
        # date on the same row), same "a row can double-count across
        # buckets" idea as Missing DOB's missing/partial split, just
        # three-way here instead of two. Each bucket feeds its own by-TL
        # breakdown and its own repeat-offender tracking in main.py.
        blank_start_df = df[df["_start_class"] == "blank"][cols].rename(columns=rename)
        blank_end_df = df[df["_end_class"] == "blank"][cols].rename(columns=rename)
        partial_mask = (
            df["_start_class"].isin(["year-only", "year-month"])
            | df["_end_class"].isin(["year-only", "year-month"])
        )
        partial_df = df[partial_mask][cols].rename(columns=rename)

        result["blank_start_records"] = _all(blank_start_df)
        result["blank_end_records"] = _all(blank_end_df)
        result["partial_records"] = _all(partial_df)
    return result


# ---------- Point 8: Missing social media (person + officeholder) ----------
PERSON_PLATFORMS = ["sm_facebook", "sm_twitter", "sm_instagram", "sm_youtube", "sm_linkedin", "sm_tiktok"]
OH_PLATFORMS = ["oh_facebook", "oh_twitter", "oh_instagram", "oh_youtube", "oh_linkedin", "oh_tiktok"]


def check_social_media(df, detail=False, limit=None):
    df = _verified_active(df)

    def missing_counts(cols):
        return {c: int((df[c] == "").sum()) for c in cols}

    person_missing = missing_counts(PERSON_PLATFORMS)
    oh_missing = missing_counts(OH_PLATFORMS)
    result = {
        "total_count": len(df),
        # NOTE: this summed-across-all-platforms number is kept here only
        # for backward compatibility with callers that don't need detail
        # (e.g. the sidebar nav count via run_all/summary_counts). The
        # detail endpoint in main.py OVERRIDES this with the count of
        # records missing every platform, which is what the on-page cards
        # and Deep Dive actually track — see main.py's social_media block.
        "flagged_count": sum(person_missing.values()) + sum(oh_missing.values()),
        "person_missing": person_missing,
        "officeholder_missing": oh_missing,
    }
    if detail:
        all_blank_person = df[(df[PERSON_PLATFORMS] == "").all(axis=1)]
        all_blank_oh = df[(df[OH_PLATFORMS] == "").all(axis=1)]
        result["person_records"] = _all(all_blank_person[["person_id", "full_name", "state", "current_office"]])
        result["officeholder_records"] = _all(all_blank_oh[["office_id", "current_office", "state", "government_body"]])

        # Per-platform flagged lists — one list per INDIVIDUAL platform
        # (missing just that one, not necessarily all of them), so the
        # frontend can drill into any single platform card and see exactly
        # who/what is missing it, with its own TL breakdown and its own
        # repeat-offender tracking — same drill-down pattern every other
        # check's buckets already use.
        person_platform_records = {}
        for col in PERSON_PLATFORMS:
            missing_rows = df[df[col] == ""]
            person_platform_records[col] = _all(missing_rows[["person_id", "full_name", "state", "current_office"]])
        oh_platform_records = {}
        for col in OH_PLATFORMS:
            missing_rows = df[df[col] == ""]
            oh_platform_records[col] = _all(missing_rows[["office_id", "current_office", "state", "government_body"]])
        result["person_platform_records"] = person_platform_records
        result["officeholder_platform_records"] = oh_platform_records
    return result


# ---------- Point 9: Missing DOB ----------
def check_missing_dob(df, detail=False, limit=None):
    df = _verified_active(df).copy()
    df["_dob_class"] = df["birth_date"].map(_classify_date)
    missing = df[df["_dob_class"] == "blank"]
    partial = df[df["_dob_class"].isin(["year-only", "year-month"])]
    result = {
        "total_count": len(df),
        "flagged_count": len(missing),
        "partial_count": len(partial),
    }
    if detail:
        cols = ["person_id", "full_name", "state", "current_office", "birth_date"]
        result["records"] = _all(missing[cols])
        result["partial_records"] = _all(partial[cols])
    return result


# ---------- Point 5: Selection method mismatch ----------
#
# Explicit office-role -> expected-method rules, checked in priority
# order (most specific first). This replaces the old loose single-word
# keyword scan (APPOINTED_KEYWORDS / INDIRECT_KEYWORDS), which produced
# wrong results whenever an office's exact wording didn't happen to
# contain one of a handful of hardcoded words — e.g. "Chief Justice"
# was missed entirely because the old list only checked for the
# substring "judge", so every Chief Justice record was silently
# defaulted to "directly-elected" instead of the correct "appointed".
#
# Rules mirror the manager-confirmed reference table exactly:
#   MLA                                  -> directly-elected
#   Member of Lok Sabha                  -> directly-elected
#   MLC (Graduate / Teacher constituency)-> directly-elected
#   Member of Rajya Sabha                -> indirectly-elected
#   MLC (Local Authorities constituency) -> indirectly-elected
#   MLC (Legislative Assembly Constituencies, i.e. nominated by MLAs)
#                                         -> indirectly-elected
#   Speaker / Deputy Speaker             -> indirectly-elected
#   President / Vice President           -> indirectly-elected
#   Minister(s) / Cabinet                -> appointed
#   Chief Justice                        -> appointed
#   Judge(s)                             -> appointed
#   Governor                             -> appointed
#
# Each rule is (match_fn, expected_method); match_fn receives the
# lowercased "{role} {office} {constituency}" text and the raw
# constituency string (needed to distinguish MLC sub-types, which all
# share the same office/role wording and only differ by constituency).
def _mlc_constituency_type(constituency: str) -> str:
    c = (constituency or "").lower()
    if "graduate" in c:
        return "graduate"
    if "teacher" in c:
        return "teacher"
    if "local authorit" in c:
        return "local_authorities"
    if "legislative assembly constituenc" in c or "assembly constituenc" in c:
        return "assembly_nominated"
    return ""


_SELECTION_RULES = [
    # (predicate(text, constituency_type) -> bool, expected_method)
    (lambda t, ct: "chief justice" in t, "appointed"),
    (lambda t, ct: "judge" in t, "appointed"),
    (lambda t, ct: "governor" in t, "appointed"),
    (lambda t, ct: "minister" in t or "cabinet" in t, "appointed"),
    (lambda t, ct: "deputy speaker" in t or "dy. speaker" in t or "dy speaker" in t, "indirectly-elected"),
    (lambda t, ct: "speaker" in t, "indirectly-elected"),
    (lambda t, ct: "vice president" in t, "indirectly-elected"),
    (lambda t, ct: re.search(r"\bpresident\b", t) is not None and "vice" not in t, "indirectly-elected"),
    (lambda t, ct: "rajya sabha" in t, "indirectly-elected"),
    (lambda t, ct: ("legislative council" in t or "mlc" in t) and ct in ("local_authorities", "assembly_nominated"), "indirectly-elected"),
    (lambda t, ct: ("legislative council" in t or "mlc" in t) and ct in ("graduate", "teacher"), "directly-elected"),
    (lambda t, ct: "legislative council" in t or "mlc" in t, "directly-elected"),  # MLC fallback if constituency type unknown
    (lambda t, ct: "lok sabha" in t, "directly-elected"),
    (lambda t, ct: "legislative assembly" in t or "mla" in t, "directly-elected"),
]


def _expected_method(role: str, office: str, constituency: str = "") -> str:
    text = f"{role} {office} {constituency}".lower()
    ct = _mlc_constituency_type(constituency)
    for predicate, expected in _SELECTION_RULES:
        if predicate(text, ct):
            return expected
    return "directly-elected"  # conservative fallback for anything unmatched


def check_selection_method(df, detail=False, limit=None):
    df = _verified_active(df).copy()
    constituency_col = df["tenure_constituency"] if "tenure_constituency" in df.columns else pd.Series([""] * len(df), index=df.index)
    df["_expected"] = [
        _expected_method(role, office, constituency)
        for role, office, constituency in zip(df["office_role"], df["current_office"], constituency_col)
    ]
    df["_actual"] = df["seat_placement_method"].str.lower()
    df.loc[df["_actual"] == "", "_actual"] = df["tenure_seat_method"].str.lower()

    def is_match(row):
        if not row["_actual"]:
            return True
        if row["_expected"] == "appointed":
            return "appointed" in row["_actual"]
        if row["_expected"] == "indirectly-elected":
            return "indirect" in row["_actual"]
        return row["_expected"] in row["_actual"]

    df["_match"] = df.apply(is_match, axis=1)
    flagged = df[(df["_actual"] != "") & (~df["_match"])]
    result = {
        "total_count": len(df),
        "flagged_count": len(flagged),
        "blank_method_count": int((df["_actual"] == "").sum()),
    }
    if detail:
        out = flagged[["office_id", "full_name", "state", "office_role", "current_office", "_actual", "_expected"]].rename(
            columns={"_actual": "recorded_method", "_expected": "expected_method"}
        )
        result["records"] = _all(out)
    return result


# ---------- Point 13: Vacant seats by state ----------
VACANCY_GRACE_DAYS = 60


def check_seat_status(df, detail=False, limit=None):
    today = pd.Timestamp.today()
    df = df.copy()
    df["_end"] = df["end_date"].map(_parse_date_loose)
    df["_active"] = df["seat_status"].str.lower() == "active"

    def classify(row):
        if row["_active"]:
            return "filled"
        if row["_end"] is None:
            return "vacant_unknown"
        days_past = (today - row["_end"]).days
        if days_past <= VACANCY_GRACE_DAYS:
            return "vacant_recent"
        return "overdue"

    df["_category"] = df.apply(classify, axis=1)
    grouped = df.groupby("state")["_category"].value_counts().unstack(fill_value=0)
    for col in ["filled", "vacant_recent", "overdue", "vacant_unknown"]:
        if col not in grouped.columns:
            grouped[col] = 0

    by_state = {}
    for state, row in grouped.iterrows():
        by_state[state] = {
            "total": int(row.sum()),
            "filled": int(row["filled"]),
            "vacant_recent": int(row["vacant_recent"]),
            "overdue": int(row["overdue"]),
            "vacant_unknown": int(row["vacant_unknown"]),
        }

    result = {
        "total_count": len(df),
        "flagged_count": int((df["_category"] != "filled").sum()),
        "overdue_count": int((df["_category"] == "overdue").sum()),
        "by_state": by_state,
    }
    if detail:
        overdue_rows = df[df["_category"] == "overdue"]
        result["overdue_records"] = _all(overdue_rows[["office_id", "full_name", "state", "current_office", "end_date"]])
    return result


# ---------- Point 12: Overlapping tenures ----------
def _parse_date_loose(v: str):
    if not v:
        return None
    v = v.strip()
    try:
        if re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            return pd.Timestamp(v)
        if re.match(r"^\d{4}-\d{2}$", v):
            return pd.Timestamp(v + "-01")
        if re.match(r"^\d{4}$", v):
            return pd.Timestamp(v + "-01-01")
    except Exception:
        return None
    return None


def _seat_type(office_role: str, current_office: str) -> str:
    text = f"{office_role} {current_office}".lower()
    if "deputy speaker" in text or "speaker" in text:
        return "speaker"
    if "mla" in text or "legislative assembly" in text:
        return "mla"
    if "mlc" in text or "legislative council" in text:
        return "mlc"
    if "lok sabha" in text:
        return "lok_sabha"
    if "rajya sabha" in text:
        return "rajya_sabha"
    if "judge" in text or "court" in text:
        return "judge"
    if "minister" in text:
        return "minister"
    if "governor" in text:
        return "governor"
    return "other"


def check_overlapping_tenures(df, detail=False, limit=None):
    today = pd.Timestamp.today()
    work = _verified_active(df)
    work = work[(work["person_id"] != "") & (work["current_office"] != "")].copy()
    work["_start"] = work["start_date"].map(_parse_date_loose)
    work["_end"] = work["end_date"].map(_parse_date_loose)
    work["_end_effective"] = work["_end"].fillna(today)
    work["_seat_type"] = work.apply(lambda r: _seat_type(r["office_role"], r["current_office"]), axis=1)
    work = work[work["_start"].notna()]

    flagged_pairs = []
    for person_id, group in work.groupby("person_id"):
        if len(group) < 2:
            continue
        records = group.to_dict(orient="records")
        for i in range(len(records)):
            for j in range(i + 1, len(records)):
                a, b = records[i], records[j]
                if a["_seat_type"] != b["_seat_type"]:
                    continue
                if a["_seat_type"] in ("minister", "other", "governor", "speaker"):
                    continue
                overlap = a["_start"] <= b["_end_effective"] and b["_start"] <= a["_end_effective"]
                if overlap:
                    flagged_pairs.append({
                        "person_id": person_id,
                        "full_name": a["full_name"],
                        "seat_type": a["_seat_type"],
                        "office_a": a["current_office"], "start_a": a["start_date"], "end_a": a["end_date"] or "ongoing",
                        "office_b": b["current_office"], "start_b": b["start_date"], "end_b": b["end_date"] or "ongoing",
                    })

    result = {
        "total_count": int(work["person_id"].nunique()),
        "flagged_count": len(flagged_pairs),
    }
    if detail:
        result["records"] = flagged_pairs
    return result


import difflib


def _normalize_party_name(name: str) -> str:
    base = re.sub(r"\([^)]*\)", "", name)
    base = re.sub(r"[^a-z0-9 ]", "", base.lower())
    return re.sub(r"\s+", " ", base).strip()


def check_lookalike_parties(df, detail=False, limit=None):
    work = _verified_active(df)
    work = work[work["party_full_name"] != ""]
    counts = work.groupby("party_full_name")["person_id"].nunique().to_dict()
    names = list(counts.keys())
    normalized = {n: _normalize_party_name(n) for n in names}

    state_breakdown = {}
    person_ids = {}
    for name, grp in work.groupby("party_full_name"):
        sb = grp[grp["state"] != ""].groupby("state")["person_id"].nunique()
        state_breakdown[name] = [{"state": s, "count": int(c)} for s, c in sb.sort_values(ascending=False).items()]
        id_state = grp[["person_id", "state"]].dropna(subset=["person_id"]).drop_duplicates(subset=["person_id"])
        person_ids[name] = [
            {"person_id": pid, "state": st if pd.notna(st) and st != "" else "—"}
            for pid, st in sorted(zip(id_state["person_id"], id_state["state"]))
        ]

    seen_pairs = set()
    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            na, nb = normalized[a], normalized[b]
            if not na or not nb:
                continue
            is_prefix_match = na.startswith(nb) or nb.startswith(na)
            ratio = difflib.SequenceMatcher(None, na, nb).ratio()
            if is_prefix_match or ratio >= 0.82:
                key = tuple(sorted([a, b]))
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    pairs.append({
                        "party_a": a, "count_a": int(counts[a]),
                        "states_a": state_breakdown.get(a, []), "person_ids_a": person_ids.get(a, []),
                        "party_b": b, "count_b": int(counts[b]),
                        "states_b": state_breakdown.get(b, []), "person_ids_b": person_ids.get(b, []),
                        "similarity": round(ratio, 2),
                    })

    pairs.sort(key=lambda p: -p["similarity"])
    result = {
        "total_count": len(names),
        "flagged_count": len(pairs),
    }
    if detail:
        result["records"] = pairs
    return result


# ---------- Point 15: Multi-party check ----------
def check_multi_party(df, detail=False, limit=None):
    work = _verified_active(df)
    work = work[(work["person_id"] != "") & (work["party_full_name"] != "")]
    grouped = work.groupby("person_id")["party_full_name"].nunique()
    flagged_ids = grouped[grouped > 1].index.tolist()

    records = []
    for pid in flagged_ids:
        rows = work[work["person_id"] == pid]
        parties = sorted(rows["party_full_name"].unique().tolist())
        records.append({
            "person_id": pid,
            "full_name": rows["full_name"].iloc[0],
            "parties": ", ".join(parties),
            "record_count": len(rows),
        })

    result = {
        "total_count": int(work["person_id"].nunique()),
        "flagged_count": len(records),
    }
    if detail:
        result["records"] = records
    return result


_INDIA_GOVT_ALLOWLIST = {
    "sabha", "vidhan", "lok", "rajya", "parishad", "zila", "panchayat", "panchayati",
    "gram", "nagar", "nigam", "sena", "bhartiya", "bharatiya", "janata", "dal", "samiti",
    "morcha", "sachivalayam", "raj", "swaraj", "adhikari", "mandal",
    "andhra", "pradesh", "arunachal", "assam", "bihar", "chhattisgarh", "goa", "gujarat",
    "haryana", "himachal", "jharkhand", "karnataka", "kerala", "madhya", "maharashtra",
    "manipur", "meghalaya", "mizoram", "nagaland", "odisha", "punjab", "rajasthan",
    "sikkim", "tamil", "nadu", "telangana", "tripura", "uttarakhand", "uttar",
    "bengal", "delhi", "puducherry", "chandigarh", "lakshadweep", "ladakh", "jammu",
    "kashmir", "dadra", "nagar", "haveli", "diu", "daman",
    "organisation", "organisations", "nationalised", "centre", "colour", "programme",
    "labour", "defence", "authorised", "organised", "recognised", "modernisation",
    "rajbhasha", "devasthan", "barak", "nahar", "gurudwara", "gurdwara", "odia",
    "provedoria",
}


# ==========================================================================
# Spelling checker — Indian-terms dictionary (proactive fix)
#
# pyspellchecker's default English word list has no concept of Indian
# proper nouns or Hindi/regional transliterated admin terms, so words like
# "Muzaffarnagar" or "Nagarpalika" used to get flagged every single time.
# This loads a maintainable, external word list so common Indian words are
# recognized BEFORE anything gets flagged — no manual "mark as correct"
# needed for terms already in the list.
# ==========================================================================

_INDIAN_DICT_PATH = os.path.join(os.path.dirname(__file__), "data", "indian_dictionary.txt")


def _load_indian_dictionary() -> set:
    """One word per line, lowercase, in backend/app/data/indian_dictionary.txt.
    Add to this file any time a genuine Indian name/place keeps getting
    flagged — no code change needed, just add the word and restart."""
    if not os.path.exists(_INDIAN_DICT_PATH):
        return set()
    with open(_INDIAN_DICT_PATH, encoding="utf-8") as f:
        return {line.strip().lower() for line in f if line.strip() and not line.startswith("#")}


_INDIAN_DICTIONARY = _load_indian_dictionary()

# Suffixes common to Indian place/person names — a word ending in one of
# these is sent straight to "unrecognized" instead of being force-
# corrected to an unrelated English word via edit distance.
_INDIAN_NAME_SUFFIXES = (
    "pur", "pura", "puram", "nagar", "nagari", "abad", "garh", "gram", "gaon",
    "wadi", "wala", "wal", "eshwar", "prasad", "narayan", "krishna",
)


def _looks_like_indian_proper_noun(word_lower: str) -> bool:
    return len(word_lower) > 4 and word_lower.endswith(_INDIAN_NAME_SUFFIXES)


def _edit_distance(a: str, b: str) -> int:
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            tmp = dp[j]
            dp[j] = prev if a[i - 1] == b[j - 1] else 1 + min(prev, dp[j], dp[j - 1])
            prev = tmp
    return dp[n]


_NATIONAL_TITLES = {
    "chief justice of the supreme court of india", "judge of the supreme court of india",
    "member of lok sabha", "member of rajya sabha", "president of india",
    "prime minister of india", "speaker of lok sabha", "vice president of india",
}

_STATE_ROLE_PREFIXES = [
    "member of legislative assembly of", "speaker of legislative assembly of",
    "deputy speaker of legislative assembly of", "judge of the high court of",
    "chief justice of the high court of", "governor of", "chief minister of",
    "deputy chief minister of", "member of legislative council of",
]

_MINISTER_ROLE_PREFIXES = [
    "minister of state with independent charge for",
    "minister of state for",
    "minister for",
]

_ROLE_TEMPLATE_LIST = [
    ("member of legislative assembly of", "Member of Legislative Assembly of [Jurisdiction]"),
    ("speaker of legislative assembly of", "Speaker of Legislative Assembly of [Jurisdiction]"),
    ("deputy speaker of legislative assembly of", "Deputy Speaker of Legislative Assembly of [Jurisdiction]"),
    ("judge of the high court of", "Judge of the High Court of [Jurisdiction]"),
    ("chief justice of the high court of", "Chief Justice of the High Court of [Jurisdiction]"),
    ("governor of", "Governor of [Jurisdiction]"),
    ("chief minister of", "Chief Minister of [Jurisdiction]"),
    ("deputy chief minister of", "Deputy Chief Minister of [Jurisdiction]"),
    ("member of legislative council of", "Member of Legislative Council of [Jurisdiction]"),
    ("chief justice of the supreme court of india", "Chief Justice of the Supreme Court of India"),
    ("judge of the supreme court of india", "Judge of the Supreme Court of India"),
    ("member of lok sabha", "Member of Lok Sabha"),
    ("member of rajya sabha", "Member of Rajya Sabha"),
    ("president of india", "President of India"),
    ("prime minister of india", "Prime Minister of India"),
    ("speaker of lok sabha", "Speaker of Lok Sabha"),
    ("vice president of india", "Vice President of India"),
    ("minister of state with independent charge for", "Minister of State with Independent Charge for [Portfolio] of [Jurisdiction]"),
    ("minister of state for", "Minister of State for [Portfolio] of [Jurisdiction]"),
    ("minister for", "Minister for [Portfolio] of [Jurisdiction]"),
]


def _naming_convention_check(office_name: str):
    low = re.sub(r"\s+", " ", office_name.strip().lower())

    if low in _NATIONAL_TITLES:
        return None
    for prefix in _STATE_ROLE_PREFIXES:
        if low.startswith(prefix):
            rest = low[len(prefix):].strip()
            if rest:
                return None
            return f"Expected '{prefix.title()} [Jurisdiction]' — jurisdiction looks missing"
    for prefix in _MINISTER_ROLE_PREFIXES:
        if low.startswith(prefix):
            rest = low[len(prefix):].strip()
            if " of " in rest and rest.split(" of ")[-1].strip():
                return None
            return f"Expected '{prefix.title()} [Portfolio] of [Jurisdiction]' — portfolio/jurisdiction looks missing or malformed"

    query_words = low.split()
    best_ratio, best_template = 0.0, None
    for keyword, template_display in _ROLE_TEMPLATE_LIST:
        kw_words = keyword.split()
        query_slice = " ".join(query_words[: len(kw_words) + 1])
        ratio = difflib.SequenceMatcher(None, query_slice, keyword).ratio()
        if ratio > best_ratio:
            best_ratio, best_template = ratio, template_display
    if best_ratio >= 0.62:
        return f"Doesn't match the expected format — closest known one is '{best_template}'"
    return None


def check_naming_convention(df, detail=False, limit=None):
    df = _verified_active(df)
    records = []
    seen = set()
    # `state` is pulled alongside office_id/current_office so flagged
    # records can be mapped to a TL the same way every other check does —
    # this check previously had no state column in its output at all.
    values = df[["office_id", "current_office", "state"]].drop_duplicates()
    for row_idx, row in values.iterrows():
        raw_value = row["current_office"]
        if not isinstance(raw_value, str) or not raw_value.strip():
            continue
        hint = _naming_convention_check(raw_value)
        if not hint:
            continue
        office_key = row["office_id"] if pd.notna(row["office_id"]) and str(row["office_id"]).strip() else f"row{row_idx}"
        key = (office_key, raw_value)
        if key in seen:
            continue
        seen.add(key)
        records.append({"id": office_key, "field": "current_office", "value": raw_value, "expected": hint, "state": row["state"]})
    result = {
        "total_count": len(values),
        "flagged_count": len(records),
        "note": (
            "Flags an office title that starts with a known role (Minister, MLA, "
            "Governor, etc.) but doesn't follow the manager-confirmed exact format "
            "for that role — e.g. missing portfolio or jurisdiction."
        ),
    }
    if detail:
        result["records"] = records
    return result


def check_spelling_errors(df, detail=False, limit=None, extra_allowlist=None):
    try:
        from spellchecker import SpellChecker
    except ImportError:
        return {"total_count": 0, "flagged_count": 0, "error": "pyspellchecker not installed"}

    df = _verified_active(df)

    allowlist = _INDIA_GOVT_ALLOWLIST | _INDIAN_DICTIONARY | (extra_allowlist or set())

    sp = SpellChecker(distance=1)
    sp.word_frequency.load_words(_INDIAN_DICTIONARY)  # so a real typo of an Indian word gets corrected TO the Indian word, not to an unrelated English one
    fields = [("current_office", "office_id"), ("government_body", "office_id")]

    # NOT anchored to the start of the string: a value can contain SEVERAL
    # concatenated entries joined by "; " (e.g. two Government Body names
    # in one cell), each with its own ID prefix. Anchoring to ^ only
    # stripped the first one, leaving every subsequent "gov-<hex>-" prefix
    # in place — the digit characters in that hex string then get stripped
    # by the word-extraction regex below, leaving letter fragments (e.g.
    # "6dcec" -> "dcec", "588835ccfcb" -> "ccfcb") that looked exactly like
    # real unrecognized words but were actually leftover ID garbage.
    id_prefix_re = re.compile(r"(?:^|(?<=;\s))(gov|off|per|par)-[0-9a-fA-F]+-", re.IGNORECASE)

    def clean(value):
        return id_prefix_re.sub("", value)

    all_values = []
    for field, id_field in fields:
        all_values.extend(df[field].dropna().unique().tolist())
    all_values = [clean(v) for v in all_values if isinstance(v, str) and v.strip()]

    word_doc_count = {}
    for v in set(all_values):
        words = set(w.lower() for w in re.findall(r"[A-Za-z']+", v) if len(w) > 2 and w.isalpha())
        for w in words:
            word_doc_count[w] = word_doc_count.get(w, 0) + 1

    classify_cache = {}

    def classify(word: str):
        wl = word.lower()
        if wl in classify_cache:
            return classify_cache[wl]
        if wl in allowlist or wl in sp:
            result = None
        elif word_doc_count.get(wl, 0) > 1:
            # appears in 2+ separate records — a real typo almost never repeats identically that often
            result = None
        elif _looks_like_indian_proper_noun(wl):
            # e.g. "...pur", "...nagar", "...garh" — don't force an English "correction" on these
            result = ("unrecognized", None)
        else:
            max_dist = 1 if len(wl) <= 5 else 2  # short words: a distance-2 "correction" is usually noise, not a real typo
            correction = sp.correction(wl)
            if correction and correction != wl and _edit_distance(wl, correction) <= max_dist:
                result = ("typo", correction)
            else:
                result = ("unrecognized", None)
        classify_cache[wl] = result
        return result

    typo_records = []
    unrecognized_records = []
    seen = set()
    for field, id_field in fields:
        values = df[[id_field, field, "state"]].drop_duplicates()
        for row_idx, row in values.iterrows():
            raw_value = row[field]
            if not isinstance(raw_value, str) or not raw_value.strip():
                continue

            value = clean(raw_value)
            words = re.findall(r"[A-Za-z']+", value)
            typo_hits, unrecognized_hits = [], []
            for w in words:
                if not (w.isalpha() and len(w) > 2 and not w.isupper()):
                    continue
                result = classify(w)
                if result is None:
                    continue
                kind, suggestion = result
                if kind == "typo":
                    typo_hits.append(f"{w} → {suggestion}")
                else:
                    unrecognized_hits.append(w)

            key = (row[id_field], field, raw_value)
            if key in seen:
                continue
            office_key = row[id_field] if pd.notna(row[id_field]) and str(row[id_field]).strip() else f"row{row_idx}"
            composite_id = f"{office_key}::{field}"
            if typo_hits:
                seen.add(key)
                typo_records.append({
                    "id": composite_id, "field": field, "value": raw_value,
                    "flagged_words": ", ".join(typo_hits), "state": row["state"],
                })
            elif unrecognized_hits:
                seen.add(key)
                unrecognized_records.append({
                    "id": composite_id, "field": field, "value": raw_value,
                    "flagged_words": ", ".join(unrecognized_hits), "state": row["state"],
                })

    result = {
        "total_count": len(df),
        "flagged_count": len(typo_records),
        "unrecognized_count": len(unrecognized_records),
        "note": (
            "Checks Current Office and Government Body text for two separate things: "
            "(1) Likely typos — a word not in the dictionary but with a confident close "
            "match (e.g. Gaurantee → Guarantee), safe to trust. "
            "(2) Unrecognized words — a word not in any dictionary with no close match at "
            "all (usually a Hindi/regional term or Indian proper noun a dictionary can't "
            "know); click 'Mark as correct' once and it's remembered permanently, so it "
            "never gets flagged again on any future upload. "
            "Naming convention format mismatches are now their own separate check."
        ),
    }
    if detail:
        result["records"] = typo_records
        result["unrecognized_records"] = unrecognized_records
    return result


def _strip_invisible(s: str) -> str:
    if s is None:
        return ""
    s = str(s)
    for ch in ("\u200b", "\u200c", "\u200d", "\ufeff"):
        s = s.replace(ch, "")
    return s.strip()


def _find_col(columns, *candidates):
    norm = {_strip_invisible(c).lower(): c for c in columns}
    for cand in candidates:
        key = _strip_invisible(cand).lower()
        if key in norm:
            return norm[key]
    return None


def parse_govt_body_export(raw: pd.DataFrame) -> pd.DataFrame:
    id_col = _find_col(raw.columns, "Government Body Id", "Government Body ID", "Id")
    name_col = _find_col(raw.columns, "Government Body Name", "Government Body")
    office_id_col = _find_col(raw.columns, "Office Id", "Office ID")
    status_col = _find_col(raw.columns, "Status")
    out = pd.DataFrame()
    out["government_body_id"] = raw[id_col].astype(str).str.strip() if id_col else ""
    out["government_body_name"] = raw[name_col].astype(str).str.strip() if name_col else ""
    out["office_id"] = raw[office_id_col].astype(str).str.strip() if office_id_col else ""
    out["status"] = raw[status_col].astype(str).str.strip() if status_col else ""
    out = out.replace({"nan": ""})
    return out[out["government_body_id"] != ""]


def parse_office_details_export(raw: pd.DataFrame) -> pd.DataFrame:
    id_col = _find_col(raw.columns, "Office Id", "Office ID", "Id")
    name_col = _find_col(raw.columns, "Office Name", "Office name")
    status_col = _find_col(raw.columns, "Status")
    role_col = _find_col(raw.columns, "Role", "Office Role")
    state_col = _find_col(raw.columns, "State")
    out = pd.DataFrame()
    out["office_id"] = raw[id_col].astype(str).str.strip() if id_col else ""
    out["office_name"] = raw[name_col].astype(str).str.strip() if name_col else ""
    out["office_status"] = raw[status_col].astype(str).str.strip() if status_col else ""
    out["role"] = raw[role_col].astype(str).str.strip() if role_col else ""
    out["state"] = raw[state_col].astype(str).str.strip() if state_col else ""
    out = out.replace({"nan": ""})
    return out[out["office_id"] != ""]


def check_govt_body_unverified_v2(govt_df: pd.DataFrame, office_df: pd.DataFrame) -> dict:
    govt_by_office = govt_df.set_index("office_id")[
        ["government_body_id", "government_body_name", "status"]
    ].to_dict(orient="index")

    def classify(row):
        gb = govt_by_office.get(row["office_id"])
        if gb is None:
            return "no_link"
        if gb["status"] != "Verified and Approved":
            return "govt_body_unverified"
        return "clean"

    office_df = office_df.copy()
    office_df["_category"] = office_df.apply(classify, axis=1)

    no_link = office_df[office_df["_category"] == "no_link"]
    unverified = office_df[office_df["_category"] == "govt_body_unverified"].copy()
    clean = office_df[office_df["_category"] == "clean"]

    unverified["government_body_id"] = unverified["office_id"].map(
        lambda oid: govt_by_office[oid]["government_body_id"]
    )
    unverified["government_body_name"] = unverified["office_id"].map(
        lambda oid: govt_by_office[oid]["government_body_name"]
    )
    unverified["govt_body_status"] = unverified["office_id"].map(
        lambda oid: govt_by_office[oid]["status"]
    )

    return {
        "total_offices": len(office_df),
        "total_govt_bodies": len(govt_df),
        "clean_count": len(clean),
        "no_link_count": len(no_link),
        "govt_body_unverified_count": len(unverified),
        "flagged_count": len(no_link) + len(unverified),
        "no_link_records": _all(no_link[["office_id", "office_name", "role", "state"]]),
        "unverified_records": _all(
            unverified[
                ["office_id", "office_name", "government_body_id", "government_body_name", "govt_body_status", "role", "state"]
            ]
        ),
    }


def check_upcoming_deadlines(df, detail=False, limit=None, window_days=15):
    today = pd.Timestamp.today().normalize()
    work = df.copy()
    work["_end"] = pd.to_datetime(work["end_date"].map(_parse_date_loose), errors="coerce")
    work = work[work["_end"].notna()]
    if len(work) == 0:
        return {"total_count": 0, "flagged_count": 0, "window_days": window_days, **({"records": []} if detail else {})}
    work["_days_remaining"] = (work["_end"] - today).dt.days
    flagged = work[(work["_days_remaining"] >= 0) & (work["_days_remaining"] <= window_days)].copy()
    flagged = flagged.sort_values("_days_remaining")
    flagged["days_remaining"] = flagged["_days_remaining"].astype(int)

    result = {
        "total_count": len(work),
        "flagged_count": len(flagged),
        "window_days": window_days,
    }
    if detail:
        cols = ["person_id", "office_id", "full_name", "current_office", "state", "end_date", "days_remaining"]
        result["records"] = _all(flagged[cols])
    return result


def parse_translation_export(raw: pd.DataFrame, category: str) -> pd.DataFrame:
    cols = list(raw.columns)
    id_col = _find_col(cols, "ID")
    name_col = None
    for c in cols:
        if c != id_col and "name" in str(c).lower() and "country" not in str(c).lower():
            name_col = c
            break

    rows = []
    i = 0
    while i < len(cols):
        c = cols[i]
        is_meta = c in (id_col, name_col) or "country" in str(c).lower()
        nxt = cols[i + 1] if i + 1 < len(cols) else None
        if not is_meta and nxt is not None and str(nxt).lower().startswith("status"):
            sub = pd.DataFrame()
            sub["id"] = raw[id_col].astype(str).str.strip() if id_col else ""
            sub["name"] = raw[name_col].astype(str).str.strip() if name_col else ""
            text = raw[c]
            status = raw[nxt]

            def classify(t, s):
                if pd.isna(t) or str(t).strip() == "":
                    return "not_started"
                if pd.notna(s) and str(s).strip().lower() == "verified":
                    return "verified"
                return "unverified"

            sub["translation_status"] = [classify(t, s) for t, s in zip(text, status)]
            sub["language"] = str(c)
            sub["category"] = category
            rows.append(sub)
            i += 2
        else:
            i += 1

    if not rows:
        return pd.DataFrame(columns=["id", "name", "language", "category", "translation_status"])
    return pd.concat(rows, ignore_index=True)


def check_translation_pending(long_df: pd.DataFrame) -> dict:
    if long_df is None or len(long_df) == 0:
        return {
            "total_records": 0, "total_language_slots": 0,
            "unverified_count": 0, "not_started_count": 0, "verified_count": 0,
            "people_with_unverified": 0,
            "by_category": {}, "by_language": [], "records": [],
        }

    unverified = long_df[long_df["translation_status"] == "unverified"]
    not_started = long_df[long_df["translation_status"] == "not_started"]

    by_category = {
        cat: int((long_df[long_df["category"] == cat]["translation_status"] == "unverified").sum())
        for cat in sorted(long_df["category"].unique())
    }

    lang_summary = []
    for lang, grp in long_df.groupby("language"):
        n_not_started = int((grp["translation_status"] == "not_started").sum())
        n_unverified = int((grp["translation_status"] == "unverified").sum())
        n_verified = int((grp["translation_status"] == "verified").sum())
        lang_summary.append({
            "language": lang, "total": len(grp),
            "not_started": n_not_started, "unverified": n_unverified, "verified": n_verified,
        })
    lang_summary.sort(key=lambda x: -x["unverified"])

    return {
        "total_records": int(long_df["id"].nunique()),
        "total_language_slots": len(long_df),
        "unverified_count": len(unverified),
        "not_started_count": len(not_started),
        "verified_count": int((long_df["translation_status"] == "verified").sum()),
        "people_with_unverified": int(unverified["id"].nunique()),
        "by_category": by_category,
        "by_language": lang_summary,
        "records": _all(unverified[["id", "name", "category", "language", "translation_status"]]),
    }


def record_id_for(record: dict) -> str:
    for key in ("person_id", "office_id", "id"):
        v = record.get(key)
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        s = str(v).strip()
        if not s or s.lower() == "nan":
            continue
        return s
    return "|".join(str(v) for v in record.values())


REGISTRY = {
    "prefix": check_prefix,
    "full_name": check_full_name,
    "partial_dates": check_partial_dates,
    "social_media": check_social_media,
    "missing_dob": check_missing_dob,
    "selection_method": check_selection_method,
    "seat_status": check_seat_status,
    "overlapping_tenures": check_overlapping_tenures,
    "lookalike_parties": check_lookalike_parties,
    "multi_party": check_multi_party,
    "upcoming_deadlines": check_upcoming_deadlines,
    "spelling": check_spelling_errors,
    "naming_convention": check_naming_convention,
}


def run_all(df: pd.DataFrame, spelling_allowlist=None) -> dict:
    results = {key: fn(df, detail=False) for key, fn in REGISTRY.items() if key != "spelling"}
    results["spelling"] = check_spelling_errors(df, detail=False, extra_allowlist=spelling_allowlist)
    return results


def summary_counts(df: pd.DataFrame, spelling_allowlist=None) -> dict:
    return run_all(df, spelling_allowlist=spelling_allowlist)