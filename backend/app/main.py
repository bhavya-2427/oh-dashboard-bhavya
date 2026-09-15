from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import pandas as pd
import io
import os
import csv
import uuid
from pathlib import Path
from datetime import date, timedelta

from . import database, validations

app = FastAPI(title="OH Validations Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

database.Base.metadata.create_all(bind=database.engine)

_seed_db = database.SessionLocal()
try:
    database.seed_default_manager(_seed_db)
    database.seed_default_team_leads(_seed_db)
finally:
    _seed_db.close()


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _state_to_tl_map(db) -> dict:
    mapping = {}
    for tl in database.list_team_leads(db):
        if tl["role"] == "manager":
            continue
        for st in tl.get("states") or []:
            mapping[st] = tl["name"]
    return mapping


def _tag_with_tl_and_pm(records: list, state_to_tl: dict, pm: str) -> list:
    out = []
    for r in records:
        rec = dict(r)
        rec["tl_name"] = state_to_tl.get(rec.get("state"), "Unassigned")
        rec["pm"] = pm
        out.append(rec)
    return out


def _tag_with_tl(records: list, state_to_tl: dict) -> list:
    out = []
    for r in records:
        rec = dict(r)
        rec["tl_name"] = state_to_tl.get(rec.get("state"), "Unassigned")
        out.append(rec)
    return out


def _by_tl_counts(records: list, state_to_tl: dict) -> dict:
    counts = {}
    for r in records:
        tl_name = state_to_tl.get(r.get("state"), "Unassigned")
        counts[tl_name] = counts.get(tl_name, 0) + 1
    return counts


def _missing_dob_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    missing_records = result.get("records", [])
    partial_records = result.get("partial_records", [])
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
        "partial_count": result["partial_count"],
        "by_tl_missing": _by_tl_counts(missing_records, state_to_tl),
        "by_tl_partial": _by_tl_counts(partial_records, state_to_tl),
        "missing_person_ids": [r.get("person_id") for r in missing_records if r.get("person_id")],
        "partial_person_ids": [r.get("person_id") for r in partial_records if r.get("person_id")],
    }


def _partial_dates_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    blank_start_records = result.get("blank_start_records", [])
    blank_end_records = result.get("blank_end_records", [])
    partial_records = result.get("partial_records", [])
    return {
        "total_count": result["total_count"],
        "blank_start": result["blank_start"],
        "blank_end": result["blank_end"],
        "partial_count": len(partial_records),
        "by_tl_blank_start": _by_tl_counts(blank_start_records, state_to_tl),
        "by_tl_blank_end": _by_tl_counts(blank_end_records, state_to_tl),
        "by_tl_partial": _by_tl_counts(partial_records, state_to_tl),
        "blank_start_office_ids": [r.get("office_id") for r in blank_start_records if r.get("office_id")],
        "blank_end_office_ids": [r.get("office_id") for r in blank_end_records if r.get("office_id")],
        "partial_office_ids": [r.get("office_id") for r in partial_records if r.get("office_id")],
    }


# ==========================================================================
# Generic Deep Dive snapshot payload builders — one per remaining check.
# All of these feed the SAME DailyCheckSnapshot table (keyed by check_key),
# and are read back by the single generic /deep-dive/{check_key} endpoint
# below. No new tables — just more rows with different check_key values.
# ==========================================================================

def _prefix_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    all_flagged = result.get("records", [])
    mismatch_records = [r for r in all_flagged if r.get("issue_type") == "mismatch"]
    blank_records = [r for r in all_flagged if r.get("issue_type") == "blank"]
    return {
        "total_count": result["total_count"],
        "flagged_count": result.get("mismatch_count", len(mismatch_records)),
        "partial_count": result.get("blank_count", len(blank_records)),
        "by_tl_missing": _by_tl_counts(mismatch_records, state_to_tl),
        "by_tl_partial": _by_tl_counts(blank_records, state_to_tl),
    }


def _full_name_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    flagged_records = result.get("records", [])
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
        "by_tl_missing": _by_tl_counts(flagged_records, state_to_tl),
        "flagged_person_ids": [r.get("person_id") for r in flagged_records if r.get("person_id")],
    }


def _naming_convention_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    flagged_records = result.get("records", [])
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
        "by_tl_missing": _by_tl_counts(flagged_records, state_to_tl),
        "flagged_office_ids": [r.get("id") for r in flagged_records if r.get("id")],
    }


def _spelling_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    typo_records = result.get("records", [])
    unrecognized_records = result.get("unrecognized_records", [])
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
        "partial_count": result.get("unrecognized_count", len(unrecognized_records)),
        "by_tl_missing": _by_tl_counts(typo_records, state_to_tl),
        "by_tl_partial": _by_tl_counts(unrecognized_records, state_to_tl),
        "typo_ids": [r.get("id") for r in typo_records if r.get("id")],
        "unrecognized_ids": [r.get("id") for r in unrecognized_records if r.get("id")],
    }


def _selection_method_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    flagged_records = result.get("records", [])
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
        "by_tl_missing": _by_tl_counts(flagged_records, state_to_tl),
        "flagged_office_ids": [r.get("office_id") for r in flagged_records if r.get("office_id")],
    }


def _social_media_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    """Stores everything needed for BOTH the two "missing ALL platforms"
    overview cards AND every individual platform card to have a prev-day
    delta, a by-TL breakdown, and repeat-offender tracking:
      - flagged_count/partial_count = COUNT of records missing every
        platform on that side (matches by_tl_missing/by_tl_partial below
        and the two on-page tables exactly — NOT a sum across the 6
        individual platform counts, which double-counts a person/office
        missing multiple platforms).
      - person_missing/officeholder_missing = per-platform counts (used
        for each individual platform card's own delta).
      - by_tl_person_platform/by_tl_officeholder_platform = per-platform
        by-TL breakdowns, one dict per platform.
      - person_platform_ids/officeholder_platform_ids = per-platform
        flagged ID lists, used to detect repeats for any single platform
        (not just "missing all")."""
    person_records = result.get("person_records", [])
    oh_records = result.get("officeholder_records", [])
    person_platform_records = result.get("person_platform_records", {})
    oh_platform_records = result.get("officeholder_platform_records", {})

    by_tl_person_platform = {p: _by_tl_counts(recs, state_to_tl) for p, recs in person_platform_records.items()}
    by_tl_oh_platform = {p: _by_tl_counts(recs, state_to_tl) for p, recs in oh_platform_records.items()}

    return {
        "total_count": result["total_count"],
        "flagged_count": len(person_records),
        "partial_count": len(oh_records),
        "person_missing": result.get("person_missing", {}),
        "officeholder_missing": result.get("officeholder_missing", {}),
        "by_tl_missing": _by_tl_counts(person_records, state_to_tl),
        "by_tl_partial": _by_tl_counts(oh_records, state_to_tl),
        "person_missing_ids": [r.get("person_id") for r in person_records if r.get("person_id")],
        "officeholder_missing_ids": [r.get("office_id") for r in oh_records if r.get("office_id")],
        "by_tl_person_platform": by_tl_person_platform,
        "by_tl_officeholder_platform": by_tl_oh_platform,
        "person_platform_ids": {p: [r.get("person_id") for r in recs if r.get("person_id")] for p, recs in person_platform_records.items()},
        "officeholder_platform_ids": {p: [r.get("office_id") for r in recs if r.get("office_id")] for p, recs in oh_platform_records.items()},
    }


def _overlapping_tenures_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
    }


def _lookalike_parties_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    pairs = result.get("records", [])

    def dominant_tl_for_pair(pair: dict) -> str:
        combined = {}
        for side_key in ("states_a", "states_b"):
            for entry in pair.get(side_key, []) or []:
                st = entry.get("state")
                cnt = entry.get("count", 0)
                if not st or st == "—":
                    continue
                combined[st] = combined.get(st, 0) + cnt
        tl_totals = {}
        for st, cnt in combined.items():
            tl_name = state_to_tl.get(st, "Unassigned")
            tl_totals[tl_name] = tl_totals.get(tl_name, 0) + cnt
        if not tl_totals:
            return "Unassigned"
        return max(tl_totals.items(), key=lambda kv: kv[1])[0]

    by_tl = {}
    for pair in pairs:
        tl_name = dominant_tl_for_pair(pair)
        by_tl[tl_name] = by_tl.get(tl_name, 0) + 1

    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
        "by_tl_missing": by_tl,
    }


def _multi_party_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
    }


def _upcoming_deadlines_snapshot_payload(result: dict, state_to_tl: dict) -> dict:
    flagged_records = result.get("records", [])
    return {
        "total_count": result["total_count"],
        "flagged_count": result["flagged_count"],
        "by_tl_missing": _by_tl_counts(flagged_records, state_to_tl),
    }


# ---------- Daily export folder ----------
DAILY_EXPORTS_DIR = Path(__file__).resolve().parent.parent / "daily_exports"


def _daily_folder_for_today() -> Path:
    folder_name = date.today().strftime("%d %b %Y")
    folder = DAILY_EXPORTS_DIR / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _save_original_excel(folder: Path, filename: str, contents: bytes):
    safe_name = filename or "upload.xlsx"
    (folder / safe_name).write_bytes(contents)


def _write_module_csv(folder: Path, module_label: str, headers: list, cols: list, records: list) -> Path:
    path = folder / f"{module_label} - errors.csv"
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        for r in records:
            writer.writerow([r.get(c, "") for c in cols])
    return path


def _get_upload_for_date(db, day_iso: str):
    rows = db.query(database.Upload).order_by(database.Upload.uploaded_at.desc()).all()
    for row in rows:
        if row.uploaded_at and row.uploaded_at.date().isoformat() == day_iso:
            return row
    return None


@app.post("/upload")
async def upload_excel(file: UploadFile = File(...)):
    today_iso = date.today().isoformat()
    db = database.SessionLocal()
    try:
        existing_today = _get_upload_for_date(db, today_iso)
        if existing_today is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"An Excel has already been submitted today ({existing_today.filename}). "
                    "Delete today's upload before submitting a corrected file for today."
                ),
            )
    finally:
        db.close()

    contents = await file.read()
    try:
        raw = pd.read_excel(io.BytesIO(contents), sheet_name="DB", header=None)
    except ValueError:
        raw = pd.read_excel(io.BytesIO(contents), sheet_name=0, header=None)

    df = validations.build_dataframe(raw)

    upload_id = str(uuid.uuid4())
    db = database.SessionLocal()
    try:
        database.save_upload(db, upload_id, file.filename, df)
        allowlist = database.get_spelling_allowlist(db)
        results = validations.run_all(df, spelling_allowlist=allowlist)
        database.save_results(db, upload_id, results)

        folder = _daily_folder_for_today()
        _save_original_excel(folder, file.filename, contents)

        state_to_tl = _state_to_tl_map(db)
        today_iso2 = date.today().isoformat()

        mdob_result = validations.check_missing_dob(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "missing_dob", _missing_dob_snapshot_payload(mdob_result, state_to_tl))
        missing_records = mdob_result.get("records", [])
        partial_records = mdob_result.get("partial_records", [])
        combined_dob_records = (
            _tag_with_tl_and_pm(missing_records, state_to_tl, "M")
            + _tag_with_tl_and_pm(partial_records, state_to_tl, "P")
        )
        _write_module_csv(
            folder, "Missing DOB",
            ["Person ID", "Name", "State", "Office", "DOB on file", "TL", "P/M"],
            ["person_id", "full_name", "state", "current_office", "birth_date", "tl_name", "pm"],
            combined_dob_records,
        )

        pdates_result = validations.check_partial_dates(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "partial_dates", _partial_dates_snapshot_payload(pdates_result, state_to_tl))

        prefix_result = validations.check_prefix(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "prefix", _prefix_snapshot_payload(prefix_result, state_to_tl))

        full_name_result = validations.check_full_name(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "full_name", _full_name_snapshot_payload(full_name_result, state_to_tl))

        naming_result = validations.check_naming_convention(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "naming_convention", _naming_convention_snapshot_payload(naming_result, state_to_tl))

        spelling_result = validations.check_spelling_errors(df, detail=True, extra_allowlist=allowlist)
        database.save_daily_check_snapshot(db, today_iso2, "spelling", _spelling_snapshot_payload(spelling_result, state_to_tl))

        selection_result = validations.check_selection_method(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "selection_method", _selection_method_snapshot_payload(selection_result, state_to_tl))

        social_result = validations.check_social_media(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "social_media", _social_media_snapshot_payload(social_result, state_to_tl))

        overlap_result = validations.check_overlapping_tenures(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "overlapping_tenures", _overlapping_tenures_snapshot_payload(overlap_result, state_to_tl))

        lookalike_result = validations.check_lookalike_parties(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "lookalike_parties", _lookalike_parties_snapshot_payload(lookalike_result, state_to_tl))

        multiparty_result = validations.check_multi_party(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "multi_party", _multi_party_snapshot_payload(multiparty_result, state_to_tl))

        deadlines_result = validations.check_upcoming_deadlines(df, detail=True)
        database.save_daily_check_snapshot(db, today_iso2, "upcoming_deadlines", _upcoming_deadlines_snapshot_payload(deadlines_result, state_to_tl))

    finally:
        db.close()

    return {
        "upload_id": upload_id,
        "records_loaded": len(df),
        "states": sorted([s for s in df["state"].dropna().unique().tolist() if s]),
    }


@app.get("/uploads/latest")
def get_latest_upload():
    db = database.SessionLocal()
    try:
        row = db.query(database.Upload).order_by(database.Upload.uploaded_at.desc()).first()
        if row is None:
            return {"upload_id": None}
        df = database.load_records(db, row.id)
        states = sorted([s for s in df["state"].dropna().unique().tolist() if s]) if df is not None else []
        return {
            "upload_id": row.id,
            "filename": row.filename,
            "records_loaded": row.record_count,
            "states": states,
            "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
        }
    finally:
        db.close()


@app.delete("/uploads/current")
def clear_current_upload():
    today_iso = date.today().isoformat()
    db = database.SessionLocal()
    try:
        row = _get_upload_for_date(db, today_iso)
        if row is None:
            raise HTTPException(status_code=404, detail="No Excel has been submitted today")
        db.query(database.ValidationResult).filter(database.ValidationResult.upload_id == row.id).delete()
        db.query(database.Upload).filter(database.Upload.id == row.id).delete()
        for check_key in (
            "missing_dob", "partial_dates", "prefix", "full_name", "naming_convention",
            "spelling", "selection_method", "social_media", "overlapping_tenures",
            "lookalike_parties", "multi_party", "upcoming_deadlines",
        ):
            database.delete_check_snapshot(db, check_key, today_iso)
        db.commit()
        return {"cleared": True, "date": today_iso}
    finally:
        db.close()


@app.get("/uploads/{upload_id}/summary")
def get_summary(upload_id: str, state: str | None = None):
    db = database.SessionLocal()
    try:
        df = database.load_records(db, upload_id)
        if df is None:
            raise HTTPException(status_code=404, detail="Upload not found")
        if state:
            df = df[df["state"] == state]
        allowlist = database.get_spelling_allowlist(db)
        return validations.summary_counts(df, spelling_allowlist=allowlist)
    finally:
        db.close()


@app.get("/uploads/{upload_id}/validation/{key}")
def get_validation_detail(upload_id: str, key: str, state: str | None = None):
    db = database.SessionLocal()
    try:
        df = database.load_records(db, upload_id)
        if df is None:
            raise HTTPException(status_code=404, detail="Upload not found")
        if state:
            df = df[df["state"] == state]
        if key not in validations.REGISTRY:
            raise HTTPException(status_code=404, detail=f"Unknown validation '{key}'")
        if key == "spelling":
            allowlist = database.get_spelling_allowlist(db)
            result = validations.check_spelling_errors(df, detail=True, extra_allowlist=allowlist)
            if "records" in result:
                result["records"] = _dedupe_records(result["records"])
            if "unrecognized_records" in result:
                result["unrecognized_records"] = _dedupe_records(result["unrecognized_records"])
            state_to_tl = _state_to_tl_map(db)
            typo_records = result.get("records", [])
            unrecognized_records = result.get("unrecognized_records", [])
            result["by_tl_typos"] = _by_tl_counts(typo_records, state_to_tl)
            result["by_tl_unrecognized"] = _by_tl_counts(unrecognized_records, state_to_tl)
            tagged_typos = _tag_with_tl_and_pm(typo_records, state_to_tl, "typo")
            tagged_unrecognized = _tag_with_tl_and_pm(unrecognized_records, state_to_tl, "unrecognized")

            prev_date, prev = database.get_previous_check_snapshot_with_date(db, "spelling", date.today().isoformat())
            if prev:
                result["prev_total_count"] = prev.get("total_count")
                result["prev_flagged_count"] = prev.get("flagged_count")
                result["prev_partial_count"] = prev.get("partial_count")
                result["prev_by_tl_missing"] = prev.get("by_tl_missing", {})
                result["prev_by_tl_partial"] = prev.get("by_tl_partial", {})

                prev_typo_ids = set(prev.get("typo_ids", []))
                prev_unrecognized_ids = set(prev.get("unrecognized_ids", []))
                for rec in tagged_typos:
                    rid = rec.get("id")
                    rec["repeat"] = bool(rid) and rid in prev_typo_ids
                for rec in tagged_unrecognized:
                    rid = rec.get("id")
                    rec["repeat"] = bool(rid) and rid in prev_unrecognized_ids
            else:
                for rec in tagged_typos:
                    rec["repeat"] = False
                for rec in tagged_unrecognized:
                    rec["repeat"] = False

            result["records"] = tagged_typos
            result["unrecognized_records"] = tagged_unrecognized
            return result
        result = validations.REGISTRY[key](df, detail=True)
        if "records" in result and key not in ("missing_dob", "prefix"):
            result["records"] = _dedupe_records(result["records"])

        if key == "prefix":
            state_to_tl = _state_to_tl_map(db)
            all_flagged = result.get("records", [])
            mismatch_records = [r for r in all_flagged if r.get("issue_type") == "mismatch"]
            blank_records = [r for r in all_flagged if r.get("issue_type") == "blank"]
            result["by_tl_mismatch"] = _by_tl_counts(mismatch_records, state_to_tl)
            result["by_tl_blank"] = _by_tl_counts(blank_records, state_to_tl)
            result["records"] = (
                _tag_with_tl_and_pm(mismatch_records, state_to_tl, "mismatch")
                + _tag_with_tl_and_pm(blank_records, state_to_tl, "blank")
            )
            for rec in result["records"]:
                rec["issue_type"] = rec.pop("pm")

        if key == "full_name":
            state_to_tl = _state_to_tl_map(db)
            flagged_records = result.get("records", [])
            result["by_tl_full_name"] = _by_tl_counts(flagged_records, state_to_tl)
            result["records"] = _tag_with_tl(flagged_records, state_to_tl)

            prev_date, prev = database.get_previous_check_snapshot_with_date(db, "full_name", date.today().isoformat())
            if prev:
                result["prev_total_count"] = prev.get("total_count")
                result["prev_flagged_count"] = prev.get("flagged_count")
                result["prev_by_tl_full_name"] = prev.get("by_tl_missing", {})

                if "flagged_person_ids" not in prev:
                    backfill_upload_id = database.find_latest_upload_id_on_date(db, prev_date)
                    if backfill_upload_id:
                        backfill_df = database.load_records(db, backfill_upload_id)
                        if backfill_df is not None:
                            backfill_result = validations.check_full_name(backfill_df, detail=True)
                            prev["flagged_person_ids"] = [
                                r.get("person_id") for r in backfill_result.get("records", []) if r.get("person_id")
                            ]
                            database.save_daily_check_snapshot(db, prev_date, "full_name", prev)

                prev_ids = set(prev.get("flagged_person_ids", []))
                for rec in result["records"]:
                    pid = rec.get("person_id")
                    rec["repeat"] = bool(pid) and pid in prev_ids
            else:
                for rec in result["records"]:
                    rec["repeat"] = False

        if key == "naming_convention":
            state_to_tl = _state_to_tl_map(db)
            flagged_records = result.get("records", [])
            result["by_tl_naming_convention"] = _by_tl_counts(flagged_records, state_to_tl)
            result["records"] = _tag_with_tl(flagged_records, state_to_tl)

            prev_date, prev = database.get_previous_check_snapshot_with_date(db, "naming_convention", date.today().isoformat())
            if prev:
                result["prev_total_count"] = prev.get("total_count")
                result["prev_flagged_count"] = prev.get("flagged_count")
                result["prev_by_tl_naming_convention"] = prev.get("by_tl_missing", {})

                if "flagged_office_ids" not in prev:
                    backfill_upload_id = database.find_latest_upload_id_on_date(db, prev_date)
                    if backfill_upload_id:
                        backfill_df = database.load_records(db, backfill_upload_id)
                        if backfill_df is not None:
                            backfill_result = validations.check_naming_convention(backfill_df, detail=True)
                            prev["flagged_office_ids"] = [
                                r.get("id") for r in backfill_result.get("records", []) if r.get("id")
                            ]
                            database.save_daily_check_snapshot(db, prev_date, "naming_convention", prev)

                prev_ids = set(prev.get("flagged_office_ids", []))
                for rec in result["records"]:
                    oid = rec.get("id")
                    rec["repeat"] = bool(oid) and oid in prev_ids
            else:
                for rec in result["records"]:
                    rec["repeat"] = False

        if key == "selection_method":
            state_to_tl = _state_to_tl_map(db)
            flagged_records = result.get("records", [])
            result["by_tl_missing"] = _by_tl_counts(flagged_records, state_to_tl)
            result["records"] = _tag_with_tl(flagged_records, state_to_tl)

            prev_date, prev = database.get_previous_check_snapshot_with_date(db, "selection_method", date.today().isoformat())
            if prev:
                result["prev_total_count"] = prev.get("total_count")
                result["prev_flagged_count"] = prev.get("flagged_count")
                result["prev_by_tl_missing"] = prev.get("by_tl_missing", {})

                if "flagged_office_ids" not in prev:
                    backfill_upload_id = database.find_latest_upload_id_on_date(db, prev_date)
                    if backfill_upload_id:
                        backfill_df = database.load_records(db, backfill_upload_id)
                        if backfill_df is not None:
                            backfill_result = validations.check_selection_method(backfill_df, detail=True)
                            prev["flagged_office_ids"] = [
                                r.get("office_id") for r in backfill_result.get("records", []) if r.get("office_id")
                            ]
                            database.save_daily_check_snapshot(db, prev_date, "selection_method", prev)

                prev_ids = set(prev.get("flagged_office_ids", []))
                for rec in result["records"]:
                    oid = rec.get("office_id")
                    rec["repeat"] = bool(oid) and oid in prev_ids
            else:
                for rec in result["records"]:
                    rec["repeat"] = False

        if key == "social_media":
            state_to_tl = _state_to_tl_map(db)
            person_records = _tag_with_tl(result.get("person_records", []), state_to_tl)
            oh_records = _tag_with_tl(result.get("officeholder_records", []), state_to_tl)
            person_platform_records = result.get("person_platform_records", {})
            oh_platform_records = result.get("officeholder_platform_records", {})

            # Per-platform TL-tagged records, keyed by platform column
            # name (e.g. "sm_facebook") — used when a specific platform
            # card is clicked, to show that platform's own flagged list.
            tagged_person_platforms = {p: _tag_with_tl(recs, state_to_tl) for p, recs in person_platform_records.items()}
            tagged_oh_platforms = {p: _tag_with_tl(recs, state_to_tl) for p, recs in oh_platform_records.items()}

            result["person_records"] = person_records
            result["officeholder_records"] = oh_records
            result["person_platform_records"] = tagged_person_platforms
            result["officeholder_platform_records"] = tagged_oh_platforms
            result["by_tl_missing"] = _by_tl_counts(person_records, state_to_tl)
            result["by_tl_partial"] = _by_tl_counts(oh_records, state_to_tl)

            # "vs yesterday" (combined counts + EVERY individual platform's
            # missing count) + repeat-offender flags — for the two "missing
            # ALL platforms" tables AND every individual platform's own
            # flagged list. Computed unconditionally regardless of any
            # active state filter.
            prev_date, prev = database.get_previous_check_snapshot_with_date(db, "social_media", date.today().isoformat())
            if prev:
                result["prev_total_count"] = prev.get("total_count")
                result["prev_flagged_count"] = prev.get("flagged_count")
                result["prev_partial_count"] = prev.get("partial_count")
                result["prev_person_missing"] = prev.get("person_missing", {})
                result["prev_officeholder_missing"] = prev.get("officeholder_missing", {})
                result["prev_by_tl_missing"] = prev.get("by_tl_missing", {})
                result["prev_by_tl_partial"] = prev.get("by_tl_partial", {})
                result["prev_by_tl_person_platform"] = prev.get("by_tl_person_platform", {})
                result["prev_by_tl_officeholder_platform"] = prev.get("by_tl_officeholder_platform", {})

                # Backfill: an old snapshot saved before the per-platform
                # ID lists existed won't have those keys — recompute once
                # from that day's original stored Excel, then save the
                # backfilled payload so future loads use it directly.
                needs_backfill = (
                    "person_missing_ids" not in prev
                    or "officeholder_missing_ids" not in prev
                    or "person_platform_ids" not in prev
                    or "officeholder_platform_ids" not in prev
                )
                if needs_backfill:
                    backfill_upload_id = database.find_latest_upload_id_on_date(db, prev_date)
                    if backfill_upload_id:
                        backfill_df = database.load_records(db, backfill_upload_id)
                        if backfill_df is not None:
                            backfill_result = validations.check_social_media(backfill_df, detail=True)
                            b_person_records = backfill_result.get("person_records", [])
                            b_oh_records = backfill_result.get("officeholder_records", [])
                            b_person_platform_records = backfill_result.get("person_platform_records", {})
                            b_oh_platform_records = backfill_result.get("officeholder_platform_records", {})
                            prev["person_missing_ids"] = [r.get("person_id") for r in b_person_records if r.get("person_id")]
                            prev["officeholder_missing_ids"] = [r.get("office_id") for r in b_oh_records if r.get("office_id")]
                            prev["person_platform_ids"] = {
                                p: [r.get("person_id") for r in recs if r.get("person_id")]
                                for p, recs in b_person_platform_records.items()
                            }
                            prev["officeholder_platform_ids"] = {
                                p: [r.get("office_id") for r in recs if r.get("office_id")]
                                for p, recs in b_oh_platform_records.items()
                            }
                            database.save_daily_check_snapshot(db, prev_date, "social_media", prev)

                prev_person_ids = set(prev.get("person_missing_ids", []))
                prev_oh_ids = set(prev.get("officeholder_missing_ids", []))
                prev_person_platform_ids = prev.get("person_platform_ids", {})
                prev_oh_platform_ids = prev.get("officeholder_platform_ids", {})

                for rec in result["person_records"]:
                    pid = rec.get("person_id")
                    rec["repeat"] = bool(pid) and pid in prev_person_ids
                for rec in result["officeholder_records"]:
                    oid = rec.get("office_id")
                    rec["repeat"] = bool(oid) and oid in prev_oh_ids

                for platform, recs in result["person_platform_records"].items():
                    prev_ids_for_platform = set(prev_person_platform_ids.get(platform, []))
                    for rec in recs:
                        pid = rec.get("person_id")
                        rec["repeat"] = bool(pid) and pid in prev_ids_for_platform
                for platform, recs in result["officeholder_platform_records"].items():
                    prev_ids_for_platform = set(prev_oh_platform_ids.get(platform, []))
                    for rec in recs:
                        oid = rec.get("office_id")
                        rec["repeat"] = bool(oid) and oid in prev_ids_for_platform
            else:
                for rec in result["person_records"]:
                    rec["repeat"] = False
                for rec in result["officeholder_records"]:
                    rec["repeat"] = False
                for recs in result["person_platform_records"].values():
                    for rec in recs:
                        rec["repeat"] = False
                for recs in result["officeholder_platform_records"].values():
                    for rec in recs:
                        rec["repeat"] = False

            return result

        if key == "missing_dob":
            state_to_tl = _state_to_tl_map(db)
            missing_records = result.get("records", [])
            partial_records = result.get("partial_records", [])
            result["by_tl_missing"] = _by_tl_counts(missing_records, state_to_tl)
            result["by_tl_partial"] = _by_tl_counts(partial_records, state_to_tl)
            result["records"] = (
                _tag_with_tl_and_pm(missing_records, state_to_tl, "M")
                + _tag_with_tl_and_pm(partial_records, state_to_tl, "P")
            )

            prev_date, prev = database.get_previous_check_snapshot_with_date(db, "missing_dob", date.today().isoformat())
            if prev:
                result["prev_total_count"] = prev.get("total_count")
                result["prev_flagged_count"] = prev.get("flagged_count")
                result["prev_partial_count"] = prev.get("partial_count")
                result["prev_by_tl_missing"] = prev.get("by_tl_missing", {})
                result["prev_by_tl_partial"] = prev.get("by_tl_partial", {})

                if "missing_person_ids" not in prev or "partial_person_ids" not in prev:
                    backfill_upload_id = database.find_latest_upload_id_on_date(db, prev_date)
                    if backfill_upload_id:
                        backfill_df = database.load_records(db, backfill_upload_id)
                        if backfill_df is not None:
                            backfill_result = validations.check_missing_dob(backfill_df, detail=True)
                            prev["missing_person_ids"] = [
                                r.get("person_id") for r in backfill_result.get("records", []) if r.get("person_id")
                            ]
                            prev["partial_person_ids"] = [
                                r.get("person_id") for r in backfill_result.get("partial_records", []) if r.get("person_id")
                            ]
                            database.save_daily_check_snapshot(db, prev_date, "missing_dob", prev)

                prev_missing_ids = set(prev.get("missing_person_ids", []))
                prev_partial_ids = set(prev.get("partial_person_ids", []))
                for rec in result["records"]:
                    pid = rec.get("person_id")
                    if rec.get("pm") == "M":
                        rec["repeat"] = bool(pid) and pid in prev_missing_ids
                    elif rec.get("pm") == "P":
                        rec["repeat"] = bool(pid) and pid in prev_partial_ids
                    else:
                        rec["repeat"] = False
            else:
                for rec in result["records"]:
                    rec["repeat"] = False

        if key == "partial_dates":
            state_to_tl = _state_to_tl_map(db)
            blank_start_records = result.get("blank_start_records", [])
            blank_end_records = result.get("blank_end_records", [])
            partial_records = result.get("partial_records", [])

            result["by_tl_blank_start"] = _by_tl_counts(blank_start_records, state_to_tl)
            result["by_tl_blank_end"] = _by_tl_counts(blank_end_records, state_to_tl)
            result["by_tl_partial"] = _by_tl_counts(partial_records, state_to_tl)

            tagged_blank_start = _tag_with_tl_and_pm(blank_start_records, state_to_tl, "blank_start")
            tagged_blank_end = _tag_with_tl_and_pm(blank_end_records, state_to_tl, "blank_end")
            tagged_partial = _tag_with_tl_and_pm(partial_records, state_to_tl, "partial")
            for rec in tagged_blank_start + tagged_blank_end + tagged_partial:
                rec["issue_type"] = rec.pop("pm")
            result["records"] = tagged_blank_start + tagged_blank_end + tagged_partial

            prev_date, prev = database.get_previous_check_snapshot_with_date(db, "partial_dates", date.today().isoformat())
            if prev:
                result["prev_total_count"] = prev.get("total_count")
                result["prev_blank_start"] = prev.get("blank_start")
                result["prev_blank_end"] = prev.get("blank_end")
                result["prev_partial_count"] = prev.get("partial_count")
                result["prev_by_tl_blank_start"] = prev.get("by_tl_blank_start", {})
                result["prev_by_tl_blank_end"] = prev.get("by_tl_blank_end", {})
                result["prev_by_tl_partial"] = prev.get("by_tl_partial", {})

                prev_bs_ids = set(prev.get("blank_start_office_ids", []))
                prev_be_ids = set(prev.get("blank_end_office_ids", []))
                prev_p_ids = set(prev.get("partial_office_ids", []))
                for rec in result["records"]:
                    oid = rec.get("office_id")
                    if rec.get("issue_type") == "blank_start":
                        rec["repeat"] = bool(oid) and oid in prev_bs_ids
                    elif rec.get("issue_type") == "blank_end":
                        rec["repeat"] = bool(oid) and oid in prev_be_ids
                    elif rec.get("issue_type") == "partial":
                        rec["repeat"] = bool(oid) and oid in prev_p_ids
                    else:
                        rec["repeat"] = False
            else:
                for rec in result["records"]:
                    rec["repeat"] = False

        return result
    finally:
        db.close()


# ==========================================================================
# Deep Dive — generic, calendar-aligned bar builder shared by ALL checks
# ==========================================================================

DEEP_DIVE_BAR_COUNTS = {"1w": 5, "2w": 2, "3w": 3, "4w": 4, "month": 12, "quarter": 4}

DEEP_DIVE_CHECK_KEYS = {
    "missing_dob", "partial_dates", "prefix", "full_name", "naming_convention",
    "spelling", "selection_method", "social_media", "overlapping_tenures",
    "lookalike_parties", "multi_party", "upcoming_deadlines",
}


def _add_months(d: date, n: int) -> date:
    month_index = d.month - 1 + n
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def _snap_to_weekday(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _last_n_weekdays(end_date: date, n: int) -> list:
    end_date = _snap_to_weekday(end_date)
    dates = []
    d = end_date
    while len(dates) < n:
        if d.weekday() < 5:
            dates.append(d)
        d -= timedelta(days=1)
    return list(reversed(dates))


def _week_bounds(end_date: date, i: int):
    this_week_start = end_date - timedelta(days=end_date.weekday())
    week_start = this_week_start - timedelta(weeks=i)
    week_end = min(week_start + timedelta(days=6), end_date)
    return week_start, week_end


def _month_bounds(end_date: date, i: int):
    first_of_this_month = end_date.replace(day=1)
    month_start = _add_months(first_of_this_month, -i)
    next_month_start = _add_months(month_start, 1)
    month_end = min(next_month_start - timedelta(days=1), end_date)
    return month_start, month_end


def _quarter_bounds(end_date: date, i: int):
    q_start_month = 3 * ((end_date.month - 1) // 3) + 1
    this_q_start = date(end_date.year, q_start_month, 1)
    q_start = _add_months(this_q_start, -3 * i)
    q_end = min(_add_months(q_start, 3) - timedelta(days=1), end_date)
    return q_start, q_end


def _deep_dive_periods_for_range(range_key: str, today: date) -> list:
    n = DEEP_DIVE_BAR_COUNTS.get(range_key, 12)
    if range_key in ("2w", "3w", "4w"):
        return [_week_bounds(today, i) for i in range(n - 1, -1, -1)]
    if range_key == "quarter":
        return [_quarter_bounds(today, i) for i in range(n - 1, -1, -1)]
    return [_month_bounds(today, i) for i in range(n - 1, -1, -1)]


@app.get("/deep-dive/{check_key}")
def get_check_deep_dive(check_key: str, range: str = "month"):
    if check_key not in DEEP_DIVE_CHECK_KEYS:
        raise HTTPException(status_code=404, detail=f"No Deep Dive available for '{check_key}'")

    today = date.today()
    db = database.SessionLocal()
    try:
        points = []
        if range == "1w":
            dates = _last_n_weekdays(today, DEEP_DIVE_BAR_COUNTS["1w"])
            for d in dates:
                snap = database.get_snapshot_exact(db, check_key, d.isoformat())
                point = {"date": d.isoformat(), "has_data": snap is not None}
                if snap:
                    point.update(snap)
                points.append(point)
        else:
            periods = _deep_dive_periods_for_range(range, today)
            for start, end in periods:
                snap = database.get_latest_snapshot_in_range(db, check_key, start.isoformat(), end.isoformat())
                point = {
                    "date": end.isoformat(),
                    "period_start": start.isoformat(),
                    "period_end": end.isoformat(),
                    "has_data": snap is not None,
                }
                if snap:
                    point.update(snap)
                points.append(point)
        return {"check_key": check_key, "range": range, "points": points}
    finally:
        db.close()


@app.get("/missing-dob/deep-dive")
def get_missing_dob_deep_dive(range: str = "month"):
    return get_check_deep_dive("missing_dob", range)


@app.delete("/missing-dob/snapshot/{date_str}")
def delete_missing_dob_snapshot(date_str: str):
    db = database.SessionLocal()
    try:
        deleted = database.delete_check_snapshot(db, "missing_dob", date_str)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"No snapshot found for {date_str}")
        return {"deleted": date_str}
    finally:
        db.close()


# ---------- Spelling allowlist: self-service, persists across uploads ----------
@app.get("/spelling-allowlist")
def list_spelling_allowlist():
    db = database.SessionLocal()
    try:
        return {"words": sorted(database.get_spelling_allowlist(db))}
    finally:
        db.close()


@app.post("/spelling-allowlist")
def add_spelling_allowlist_word(word: str, note: str | None = None):
    if not word or not word.strip():
        raise HTTPException(status_code=400, detail="word is required")
    db = database.SessionLocal()
    try:
        database.add_to_spelling_allowlist(db, word, note)
        return {"added": word.strip().lower()}
    finally:
        db.close()


@app.delete("/spelling-allowlist/{word}")
def delete_spelling_allowlist_word(word: str):
    db = database.SessionLocal()
    try:
        database.remove_from_spelling_allowlist(db, word)
        return {"removed": word.strip().lower()}
    finally:
        db.close()


# ---------- Govt Body Unverified Status: two-file upload flow ----------
@app.post("/govt-body-check/upload-govt-body")
async def upload_govt_body_file(file: UploadFile = File(...)):
    contents = await file.read()
    raw = pd.read_excel(io.BytesIO(contents), header=0)
    df = validations.parse_govt_body_export(raw)
    upload_id = str(uuid.uuid4())
    db = database.SessionLocal()
    try:
        database.save_generic_upload(db, upload_id, "govt_body", file.filename, df)
    finally:
        db.close()
    return {"upload_id": upload_id, "records_loaded": len(df)}


@app.post("/govt-body-check/upload-office-details")
async def upload_office_details_file(file: UploadFile = File(...)):
    contents = await file.read()
    raw = pd.read_excel(io.BytesIO(contents), header=0)
    df = validations.parse_office_details_export(raw)
    upload_id = str(uuid.uuid4())
    db = database.SessionLocal()
    try:
        database.save_generic_upload(db, upload_id, "office_details", file.filename, df)
    finally:
        db.close()
    return {"upload_id": upload_id, "records_loaded": len(df)}


@app.get("/govt-body-check/result")
def get_govt_body_check_result(govt_body_upload_id: str, office_upload_id: str):
    db = database.SessionLocal()
    try:
        govt_df = database.load_generic_upload(db, govt_body_upload_id)
        office_df = database.load_generic_upload(db, office_upload_id)
        if govt_df is None or office_df is None:
            raise HTTPException(status_code=404, detail="One or both uploads not found")
        return validations.check_govt_body_unverified_v2(govt_df, office_df)
    finally:
        db.close()


# ---------- OH / PE / VIF pending translations ----------
TRANSLATION_CATEGORIES = {"oh", "pe", "vif"}


@app.post("/translations/upload/{category}")
async def upload_translation_file(category: str, file: UploadFile = File(...)):
    category = category.lower()
    if category not in TRANSLATION_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category '{category}', expected one of {sorted(TRANSLATION_CATEGORIES)}")
    contents = await file.read()
    raw = pd.read_excel(io.BytesIO(contents), header=0)
    df = validations.parse_translation_export(raw, category.upper())
    upload_id = str(uuid.uuid4())
    db = database.SessionLocal()
    try:
        database.save_generic_upload(db, upload_id, f"translation_{category}", file.filename, df)
    finally:
        db.close()
    return {"upload_id": upload_id, "records_loaded": int(df["id"].nunique()) if len(df) else 0}


@app.get("/translations/result")
def get_translations_result(oh_upload_id: str | None = None, pe_upload_id: str | None = None, vif_upload_id: str | None = None):
    ids = [oh_upload_id, pe_upload_id, vif_upload_id]
    if not any(ids):
        raise HTTPException(status_code=400, detail="Provide at least one of oh_upload_id, pe_upload_id, vif_upload_id")
    db = database.SessionLocal()
    try:
        frames = []
        for uid in ids:
            if uid:
                frame = database.load_generic_upload(db, uid)
                if frame is None:
                    raise HTTPException(status_code=404, detail=f"Upload '{uid}' not found")
                frames.append(frame)
        combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        return validations.check_translation_pending(combined)
    finally:
        db.close()

# ==========================================================================
# TL QC workflow: auth, per-record review actions
# ==========================================================================
from pydantic import BaseModel


class LoginBody(BaseModel):
    username: str
    password: str


class ActionBody(BaseModel):
    token: str
    check_key: str
    record_id: str
    state: str | None = None
    action: str
    note: str | None = None


class CreateTLBody(BaseModel):
    username: str
    name: str
    password: str
    states: list[str] = []
    constituencies: list[str] = []
    role: str = "tl"


class UpdateStatesBody(BaseModel):
    states: list[str] = []
    constituencies: list[str] = []


def _get_latest_upload_id(db):
    row = db.query(database.Upload).order_by(database.Upload.uploaded_at.desc()).first()
    return row.id if row else None


def _dedupe_records(records: list) -> list:
    seen = set()
    out = []
    for r in records:
        rid = validations.record_id_for(r)
        if rid in seen:
            continue
        seen.add(rid)
        out.append(r)
    return out


@app.post("/auth/login")
def login(body: LoginBody):
    db = database.SessionLocal()
    try:
        result = database.authenticate(db, body.username, body.password)
        if result is None:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        return result
    finally:
        db.close()


@app.get("/auth/me")
def me(token: str):
    db = database.SessionLocal()
    try:
        tl = database.get_session_tl(db, token)
        if tl is None:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        return tl
    finally:
        db.close()


@app.post("/team-leads")
def create_team_lead(body: CreateTLBody):
    db = database.SessionLocal()
    try:
        existing = [t for t in database.list_team_leads(db) if t["username"] == body.username.strip().lower()]
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")
        tl = database.create_team_lead(db, body.username, body.name, body.password, body.states, body.role, body.constituencies)
        return {"id": tl.id, "username": tl.username, "name": tl.name, "role": tl.role, "states": tl.states, "constituencies": tl.constituencies}
    finally:
        db.close()


@app.get("/team-leads")
def get_team_leads():
    db = database.SessionLocal()
    try:
        return database.list_team_leads(db)
    finally:
        db.close()


@app.put("/team-leads/{tl_id}/states")
def update_team_lead_states(tl_id: str, body: UpdateStatesBody):
    db = database.SessionLocal()
    try:
        tl = database.update_team_lead_scope(db, tl_id, body.states, body.constituencies)
        if tl is None:
            raise HTTPException(status_code=404, detail="Team lead not found")
        return {"id": tl.id, "username": tl.username, "name": tl.name, "role": tl.role, "states": tl.states, "constituencies": tl.constituencies}
    finally:
        db.close()


@app.delete("/team-leads/{tl_id}")
def delete_team_lead(tl_id: str):
    db = database.SessionLocal()
    try:
        ok = database.delete_team_lead(db, tl_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Team lead not found")
        return {"deleted": tl_id}
    finally:
        db.close()


@app.get("/tl/worklist")
def get_tl_worklist(token: str, check_key: str):
    db = database.SessionLocal()
    try:
        tl = database.get_session_tl(db, token)
        if tl is None:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        if check_key not in validations.REGISTRY:
            raise HTTPException(status_code=404, detail=f"Unknown validation '{check_key}'")

        upload_id = _get_latest_upload_id(db)
        if upload_id is None:
            return {
                "records": [], "progress": {"total": 0, "actioned": 0, "pending": 0},
                "action_breakdown": {"reviewed": 0, "fixed": 0, "escalated": 0, "not_impacted": 0},
                "states": tl["states"],
            }
        df = database.load_records(db, upload_id)

        if tl["states"]:
            df = df[df["state"].isin(tl["states"])] if "state" in df.columns else df
        if tl.get("constituencies"):
            df = df[df["tenure_constituency"].isin(tl["constituencies"])] if "tenure_constituency" in df.columns else df

        if check_key == "spelling":
            allowlist = database.get_spelling_allowlist(db)
            result = validations.check_spelling_errors(df, detail=True, extra_allowlist=allowlist)
            all_records = result.get("records", []) + result.get("unrecognized_records", [])
        else:
            result = validations.REGISTRY[check_key](df, detail=True)
            all_records = result.get("records", [])
        all_records = _dedupe_records(all_records)

        latest_actions = database.get_latest_actions(db, check_key)

        breakdown = {"reviewed": 0, "fixed": 0, "escalated": 0}
        visible, actioned_count, not_impacted_count = [], 0, 0
        for r in all_records:
            rid = validations.record_id_for(r)
            latest = latest_actions.get(rid)
            if latest and latest["action"] in breakdown:
                breakdown[latest["action"]] += 1
            if latest and latest["action"] in database.SUPPRESSING_ACTIONS:
                actioned_count += 1
            if latest is None:
                not_impacted_count += 1
            rec = dict(r)
            rec["record_id"] = rid
            rec["latest_action"] = latest
            visible.append(rec)

        total = len(all_records)
        breakdown["not_impacted"] = not_impacted_count
        return {
            "records": visible,
            "progress": {"total": total, "actioned": actioned_count, "pending": total - actioned_count},
            "action_breakdown": breakdown,
            "states": tl["states"],
        }
    finally:
        db.close()


@app.post("/tl/action")
def post_tl_action(body: ActionBody):
    db = database.SessionLocal()
    try:
        tl = database.get_session_tl(db, body.token)
        if tl is None:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        if body.action not in {"reviewed", "fixed", "escalated", "reopened"}:
            raise HTTPException(status_code=400, detail="Invalid action")
        database.record_action(
            db, check_key=body.check_key, record_id=body.record_id, state=body.state or "",
            tl_id=tl["tl_id"], tl_name=tl["name"], action=body.action, note=body.note,
        )
        return {"ok": True}
    finally:
        db.close()


@app.get("/tl/progress-by-check")
def get_tl_progress_by_check(token: str):
    db = database.SessionLocal()
    try:
        tl = database.get_session_tl(db, token)
        if tl is None:
            raise HTTPException(status_code=401, detail="Invalid or expired session")
        upload_id = _get_latest_upload_id(db)
        if upload_id is None:
            return {"checks": []}
        df = database.load_records(db, upload_id)
        if tl["states"] and "state" in df.columns:
            df = df[df["state"].isin(tl["states"])]
        if tl.get("constituencies") and "tenure_constituency" in df.columns:
            df = df[df["tenure_constituency"].isin(tl["constituencies"])]

        out = []
        for key, fn in validations.REGISTRY.items():
            if key == "spelling":
                allowlist = database.get_spelling_allowlist(db)
                result = validations.check_spelling_errors(df, detail=True, extra_allowlist=allowlist)
                all_records = result.get("records", []) + result.get("unrecognized_records", [])
            else:
                result = fn(df, detail=True)
                all_records = result.get("records", [])
            all_records = _dedupe_records(all_records)
            latest_actions = database.get_latest_actions(db, key)
            actioned = sum(
                1 for r in all_records
                if (latest_actions.get(validations.record_id_for(r)) or {}).get("action") in database.SUPPRESSING_ACTIONS
            )
            total = len(all_records)
            out.append({"check_key": key, "total": total, "actioned": actioned, "pending": total - actioned})
        return {"checks": out}
    finally:
        db.close()


@app.get("/activity-log")
def get_activity_log_endpoint(
    tl_id: str | None = None, state: str | None = None, check_key: str | None = None,
    action: str | None = None, date_from: str | None = None, date_to: str | None = None,
    limit: int = 200,
):
    db = database.SessionLocal()
    try:
        return {"entries": database.get_activity_log(
            db, tl_id=tl_id, state=state, check_key=check_key, action=action,
            date_from=date_from, date_to=date_to, limit=limit,
        )}
    finally:
        db.close()


@app.get("/activity-log/summary")
def get_activity_log_summary_endpoint():
    db = database.SessionLocal()
    try:
        return {"summary": database.get_activity_log_summary(db)}
    finally:
        db.close()


@app.get("/activity-log/overview")
def get_activity_log_overview_endpoint():
    db = database.SessionLocal()
    try:
        upload_id = _get_latest_upload_id(db)
        by_check = []
        total_flagged = 0
        total_fixed = 0
        total_not_impacted = 0
        if upload_id is not None:
            df = database.load_records(db, upload_id)
            for key, fn in validations.REGISTRY.items():
                if key == "spelling":
                    allowlist = database.get_spelling_allowlist(db)
                    result = validations.check_spelling_errors(df, detail=True, extra_allowlist=allowlist)
                    all_records = result.get("records", []) + result.get("unrecognized_records", [])
                else:
                    result = fn(df, detail=True)
                    all_records = result.get("records", [])
                all_records = _dedupe_records(all_records)
                latest_actions = database.get_latest_actions(db, key)
                fixed = 0
                not_impacted = 0
                for r in all_records:
                    latest = latest_actions.get(validations.record_id_for(r))
                    if latest is None:
                        not_impacted += 1
                    elif latest.get("action") == "fixed":
                        fixed += 1
                total = len(all_records)
                total_flagged += total
                total_fixed += fixed
                total_not_impacted += not_impacted
                by_check.append({"check_key": key, "total": total, "fixed": fixed, "not_impacted": not_impacted})
        total_pending = total_flagged - total_fixed
        return {
            "total_flagged": total_flagged,
            "total_fixed": total_fixed,
            "total_pending": total_pending,
            "total_not_impacted": total_not_impacted,
            "by_check": by_check,
        }
    finally:
        db.close()