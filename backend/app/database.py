import json
import io
import hashlib
import os
import secrets
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, String, Integer, Text, DateTime, JSON
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timedelta
import pandas as pd

load_dotenv()  # picks up backend/.env if present; no-op if it doesn't exist

# Reads DATABASE_URL from the environment so the same code runs against
# SQLite locally and Postgres in production — no code changes needed,
# just set the env var. Falls back to local SQLite if unset.
#
# Postgres URLs must use the "postgresql://" scheme for SQLAlchemy (some
# hosts, e.g. Supabase/Heroku, hand you "postgres://" — normalize it).
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./oh_dashboard.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class Upload(Base):
    __tablename__ = "uploads"
    id = Column(String, primary_key=True)
    filename = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    record_count = Column(Integer)
    # Full parsed dataset stored as JSON for simplicity in this MVP.
    # For large-scale use, move this to a proper `records` table with real columns.
    data_json = Column(Text)

class ProcessedFile(Base):
    __tablename__ = "processed_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_key = Column(String, unique=True, index=True)
    filename = Column(String)
    status = Column(String, index=True)
    detected_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)


class ValidationResult(Base):
    __tablename__ = "validation_results"
    id = Column(Integer, primary_key=True, autoincrement=True)
    upload_id = Column(String, index=True)
    validation_key = Column(String, index=True)
    flagged_count = Column(Integer)
    total_count = Column(Integer)


def save_upload(
    db,
    upload_id: str,
    filename: str,
    df: pd.DataFrame,
    commit: bool = True,
):
    record = Upload(
        id=upload_id,
        filename=filename,
        record_count=len(df),
        data_json=df.to_json(orient="records"),
    )
    db.add(record)

    if commit:
        db.commit()

def find_latest_upload_id_on_date(db, date_str: str):
    """Finds the most recent Upload whose uploaded_at falls on the given
    calendar date (YYYY-MM-DD). Used to backfill an old-format daily
    snapshot (saved before Person-ID tracking existed) by recomputing
    that day's flagged Person IDs straight from the original file's
    stored records, rather than losing repeat-offender detection for
    any day uploaded before that feature existed."""
    day_start = datetime.strptime(date_str, "%Y-%m-%d")
    day_end = day_start + timedelta(days=1)
    row = (
        db.query(Upload)
        .filter(Upload.uploaded_at >= day_start, Upload.uploaded_at < day_end)
        .order_by(Upload.uploaded_at.desc())
        .first()
    )
    return row.id if row else None


def save_results(
    db,
    upload_id: str,
    results: dict,
    commit: bool = True,
):
    for key, summary in results.items():
        db.add(ValidationResult(
            upload_id=upload_id,
            validation_key=key,
            flagged_count=summary.get("flagged_count", 0),
            total_count=summary.get("total_count", 0),
        ))

    if commit:
        db.commit()


def load_records(db, upload_id: str):
    row = db.query(Upload).filter(Upload.id == upload_id).first()
    if row is None:
        return None
    return pd.read_json(io.StringIO(row.data_json), orient="records")


class GenericUpload(Base):
    """
    Separate from the main combined-OH-Excel Upload table. Used for the
    Govt Body Unverified Status page, which takes two independent uploads
    (Government Body export + Office Details export) and cross-references
    them by Government Body ID.
    """
    __tablename__ = "generic_uploads"
    id = Column(String, primary_key=True)
    kind = Column(String, index=True)  # "govt_body" or "office_details"
    filename = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    data_json = Column(Text)


def save_generic_upload(db, upload_id: str, kind: str, filename: str, df: pd.DataFrame):
    db.add(GenericUpload(id=upload_id, kind=kind, filename=filename, data_json=df.to_json(orient="records")))
    db.commit()


def load_generic_upload(db, upload_id: str):
    row = db.query(GenericUpload).filter(GenericUpload.id == upload_id).first()
    if row is None:
        return None
    return pd.read_json(io.StringIO(row.data_json), orient="records")


class SpellingAllowlist(Base):
    """
    Self-service, persistent allowlist for the Spelling errors check.
    Whenever someone reviews an "unrecognized word" and confirms it's
    correct (a Hindi/regional admin term, an Indian proper noun, etc.),
    it's added here ONCE and then permanently skipped on every future
    upload — no need to keep telling the assistant/code each time.
    """
    __tablename__ = "spelling_allowlist"
    word = Column(String, primary_key=True)  # stored lowercase
    added_at = Column(DateTime, default=datetime.utcnow)
    note = Column(String, nullable=True)


def add_to_spelling_allowlist(db, word: str, note: str | None = None):
    wl = word.strip().lower()
    if not wl:
        return
    existing = db.query(SpellingAllowlist).filter(SpellingAllowlist.word == wl).first()
    if existing is None:
        db.add(SpellingAllowlist(word=wl, note=note))
        db.commit()


def get_spelling_allowlist(db) -> set:
    return {row.word for row in db.query(SpellingAllowlist).all()}


def remove_from_spelling_allowlist(db, word: str):
    wl = word.strip().lower()
    db.query(SpellingAllowlist).filter(SpellingAllowlist.word == wl).delete()
    db.commit()


# ==========================================================================
# TL QC workflow: auth, per-record review actions, and daily snapshots
# ==========================================================================

def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((salt + password).encode()).hexdigest()


class TeamLead(Base):
    """
    One row per TL (or manager). `role` is 'tl' or 'manager'. `states` is
    a JSON list of state names this person is scoped to — empty/null for
    managers, who see every state (rollup only, no state-locked worklist).
    """
    __tablename__ = "team_leads"
    id = Column(String, primary_key=True)
    username = Column(String, unique=True, index=True)
    name = Column(String)
    role = Column(String, default="tl")  # "tl" or "manager"
    states = Column(JSON, default=list)
    constituencies = Column(JSON, default=list)  # optional finer-grained scope within `states`
    password_salt = Column(String)
    password_hash = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class Session(Base):
    __tablename__ = "sessions"
    token = Column(String, primary_key=True)
    tl_id = Column(String, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)


def create_team_lead(db, username: str, name: str, password: str, states: list, role: str = "tl", constituencies: list = None):
    salt = secrets.token_hex(8)
    tl = TeamLead(
        id=secrets.token_hex(8),
        username=username.strip().lower(),
        name=name.strip(),
        role=role,
        states=states or [],
        constituencies=constituencies or [],
        password_salt=salt,
        password_hash=_hash_password(password, salt),
    )
    db.add(tl)
    db.commit()
    return tl


def seed_default_manager(db):
    """
    Runs once at startup. Creates a manager login (username: manager) if — and
    only if — no manager account exists yet, so there's always at least one
    way in to Manage TLs & Rights / History & Logs without a chicken-and-egg
    bootstrap problem. Safe to call every startup: no-ops once a manager exists.
    """
    has_manager = db.query(TeamLead).filter(TeamLead.role == "manager").first()
    if has_manager:
        return
    create_team_lead(db, username="manager", name="Manager", password="changeme123", states=[], role="manager")


# The 4 standing TL accounts. Hardcoded on purpose so nobody has to recreate
# them by hand after every fresh deploy/DB reset — seeded once, then left
# alone. States/constituencies start empty (meaning "unscoped, sees
# everything") and are meant to be narrowed per TL from Manage TLs & Rights;
# reseeding never touches states on an existing account, only creates
# accounts that are missing.
DEFAULT_TLS = [
    {"username": "deepak", "name": "Deepak", "password": "deepak123"},
    {"username": "rituraj", "name": "Rituraj", "password": "rituraj123"},
    {"username": "divya", "name": "Divya", "password": "divya123"},
    {"username": "gaurav", "name": "Gaurav", "password": "gaurav123"},
]


def seed_default_team_leads(db):
    """Runs once at startup. Creates any of the 4 standing TL accounts that
    don't exist yet — skips ones that are already there (e.g. someone renamed
    or reconfigured them), so this is always safe to re-run on every boot."""
    existing_usernames = {t.username for t in db.query(TeamLead).all()}
    for tl_def in DEFAULT_TLS:
        if tl_def["username"] in existing_usernames:
            continue
        create_team_lead(
            db, username=tl_def["username"], name=tl_def["name"],
            password=tl_def["password"], states=[], role="tl",
        )


def authenticate(db, username: str, password: str):
    tl = db.query(TeamLead).filter(TeamLead.username == username.strip().lower()).first()
    if tl is None:
        return None
    if _hash_password(password, tl.password_salt) != tl.password_hash:
        return None
    token = secrets.token_hex(24)
    db.add(Session(token=token, tl_id=tl.id, expires_at=datetime.utcnow() + timedelta(days=14)))
    db.commit()
    return {"token": token, "tl_id": tl.id, "name": tl.name, "role": tl.role, "states": tl.states, "constituencies": tl.constituencies or []}


def get_session_tl(db, token: str):
    if not token:
        return None
    session = db.query(Session).filter(Session.token == token).first()
    if session is None or session.expires_at < datetime.utcnow():
        return None
    tl = db.query(TeamLead).filter(TeamLead.id == session.tl_id).first()
    if tl is None:
        return None
    return {"tl_id": tl.id, "name": tl.name, "role": tl.role, "states": tl.states, "constituencies": tl.constituencies or []}


def update_team_lead_scope(db, tl_id: str, states: list, constituencies: list = None):
    tl = db.query(TeamLead).filter(TeamLead.id == tl_id).first()
    if tl is None:
        return None
    tl.states = states or []
    tl.constituencies = constituencies if constituencies is not None else (tl.constituencies or [])
    db.commit()
    db.refresh(tl)
    return tl


def delete_team_lead(db, tl_id: str) -> bool:
    tl = db.query(TeamLead).filter(TeamLead.id == tl_id).first()
    if tl is None:
        return False
    db.delete(tl)
    db.query(Session).filter(Session.tl_id == tl_id).delete()
    db.commit()
    return True


def list_team_leads(db):
    return [
        {"id": t.id, "username": t.username, "name": t.name, "role": t.role, "states": t.states, "constituencies": t.constituencies or []}
        for t in db.query(TeamLead).all()
    ]


class ReviewAction(Base):
    """
    One row per review action taken on a flagged record. The LATEST action
    for a given (check_key, record_id) is what determines current status:
    "fixed" suppresses the record from future Pending counts (even across
    re-uploads, since record_id is the source data's own stable
    Person/Office ID) until explicitly un-dismissed. "reviewed" and
    "escalated" do NOT suppress — they just annotate the record and keep
    it in Pending. A record with no action at all is passively treated as
    "Not Impacted" — there's no stored action for that state; it's simply
    the absence of any ReviewAction row for that record_id.
    """
    __tablename__ = "review_actions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    check_key = Column(String, index=True)
    record_id = Column(String, index=True)
    state = Column(String, index=True)
    tl_id = Column(String, index=True)
    tl_name = Column(String)
    action = Column(String)  # "reviewed" | "fixed" | "escalated" | "reopened"
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


SUPPRESSING_ACTIONS = {"fixed"}


def record_action(db, check_key: str, record_id: str, state: str, tl_id: str, tl_name: str, action: str, note: str | None = None):
    db.add(ReviewAction(
        check_key=check_key, record_id=record_id, state=state or "",
        tl_id=tl_id, tl_name=tl_name, action=action, note=note,
    ))
    db.commit()


def get_latest_actions(db, check_key: str) -> dict:
    """Returns {record_id: {action, tl_name, note, created_at}} — latest action per record for this check."""
    rows = (
        db.query(ReviewAction)
        .filter(ReviewAction.check_key == check_key)
        .order_by(ReviewAction.created_at.asc())
        .all()
    )
    latest = {}
    for r in rows:
        latest[r.record_id] = {
            "action": r.action, "tl_name": r.tl_name, "note": r.note,
            "created_at": r.created_at.isoformat(),
        }
    return latest


def get_activity_log(
    db, tl_id: str = None, state: str = None, check_key: str = None, action: str = None,
    date_from: str = None, date_to: str = None, limit: int = 200,
):
    q = db.query(ReviewAction).order_by(ReviewAction.created_at.desc())
    if tl_id:
        q = q.filter(ReviewAction.tl_id == tl_id)
    if state:
        q = q.filter(ReviewAction.state == state)
    if check_key:
        q = q.filter(ReviewAction.check_key == check_key)
    if action:
        q = q.filter(ReviewAction.action == action)
    if date_from:
        q = q.filter(ReviewAction.created_at >= date_from)
    if date_to:
        # inclusive of the whole end day when only a date (no time) is given
        q = q.filter(ReviewAction.created_at <= (date_to if len(date_to) > 10 else f"{date_to} 23:59:59"))
    rows = q.limit(limit).all()
    return [
        {
            "check_key": r.check_key, "record_id": r.record_id, "state": r.state,
            "tl_id": r.tl_id, "tl_name": r.tl_name, "action": r.action, "note": r.note,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


def get_activity_log_summary(db):
    """Per-TL rollup: total actions, breakdown by action type, checks touched, last active — powers the manager-only Logs dashboard header cards.

    by_action is computed on the LATEST action per (tl, check_key, record_id) —
    not raw row count — so re-saving a note on an already-Fixed record (which
    inserts another 'fixed' row into review_actions) doesn't inflate the
    Fixed count. last_active is still computed from every row, since that
    should reflect the most recent activity of any kind."""
    rows = db.query(ReviewAction).order_by(ReviewAction.created_at.asc()).all()

    # Keep only the latest row per (tl_key, check_key, record_id) — since rows
    # are processed oldest-first, later rows simply overwrite earlier ones.
    latest_by_key = {}
    for r in rows:
        tl_key = r.tl_id or r.tl_name or "unknown"
        latest_by_key[(tl_key, r.check_key, r.record_id)] = r

    by_tl = {}
    for (tl_key, check_key, record_id), r in latest_by_key.items():
        entry = by_tl.setdefault(tl_key, {
            "tl_id": r.tl_id, "tl_name": r.tl_name, "total": 0,
            "by_action": {"reviewed": 0, "fixed": 0, "escalated": 0, "reopened": 0},
            "checks": set(), "states": set(), "last_active": None,
        })
        entry["total"] += 1
        if r.action in entry["by_action"]:
            entry["by_action"][r.action] += 1
        if r.check_key:
            entry["checks"].add(r.check_key)
        if r.state:
            entry["states"].add(r.state)

    # last_active reflects the most recent activity of ANY kind (including
    # note-only re-saves), so recompute it from the full unfiltered row set.
    for r in rows:
        tl_key = r.tl_id or r.tl_name or "unknown"
        if tl_key not in by_tl:
            continue
        if by_tl[tl_key]["last_active"] is None or r.created_at > by_tl[tl_key]["last_active"]:
            by_tl[tl_key]["last_active"] = r.created_at

    out = []
    for entry in by_tl.values():
        out.append({
            "tl_id": entry["tl_id"], "tl_name": entry["tl_name"], "total": entry["total"],
            "by_action": entry["by_action"], "checks_touched": len(entry["checks"]),
            "states_touched": len(entry["states"]),
            "last_active": entry["last_active"].isoformat() if entry["last_active"] else None,
        })
    out.sort(key=lambda e: e["total"], reverse=True)
    return out


class DailySnapshot(Base):
    """One row per (date, check_key, state) — flagged_count at that point,
    for computing "vs yesterday" trend."""
    __tablename__ = "daily_snapshots"
    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String, index=True)  # YYYY-MM-DD
    check_key = Column(String, index=True)
    state = Column(String, index=True)
    flagged_count = Column(Integer)


def save_daily_snapshot(db, date_str: str, check_key: str, state_counts: dict):
    for state, count in state_counts.items():
        existing = (
            db.query(DailySnapshot)
            .filter(DailySnapshot.date == date_str, DailySnapshot.check_key == check_key, DailySnapshot.state == state)
            .first()
        )
        if existing:
            existing.flagged_count = count
        else:
            db.add(DailySnapshot(date=date_str, check_key=check_key, state=state, flagged_count=count))
    db.commit()


def get_snapshot(db, date_str: str, check_key: str) -> dict:
    rows = db.query(DailySnapshot).filter(DailySnapshot.date == date_str, DailySnapshot.check_key == check_key).all()
    return {r.state: r.flagged_count for r in rows}


# ==========================================================================
# Daily Check Snapshot: full JSON payload per (date, check_key) — powers
# "vs yesterday" comparison cards and the Missing DOB Deep Dive trend page.
# Separate from DailySnapshot above (which only stores a flat per-state
# count) because Missing DOB needs missing/partial/TL breakdowns, not just
# one number.
# ==========================================================================

class DailyCheckSnapshot(Base):
    """
    One row per (date, check_key) — the full validation payload for that
    check as of that day's upload, stored as JSON. `date` is the calendar
    date (YYYY-MM-DD) of the upload that produced this snapshot; if more
    than one file is uploaded on the same day, that day's row is simply
    overwritten, so "today's snapshot" always reflects the latest upload
    of the day.
    """
    __tablename__ = "daily_check_snapshots"
    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String, index=True)  # YYYY-MM-DD
    check_key = Column(String, index=True)
    payload_json = Column(Text)


def save_daily_check_snapshot(
    db,
    date_str: str,
    check_key: str,
    payload: dict,
    commit: bool = True,
):
    existing = (
        db.query(DailyCheckSnapshot)
        .filter(
            DailyCheckSnapshot.date == date_str,
            DailyCheckSnapshot.check_key == check_key,
        )
        .first()
    )

    payload_json = json.dumps(payload)

    if existing:
        existing.payload_json = payload_json
    else:
        db.add(
            DailyCheckSnapshot(
                date=date_str,
                check_key=check_key,
                payload_json=payload_json,
            )
        )

    if commit:
        db.commit()

def get_previous_check_snapshot(db, check_key: str, before_date: str):
    """Latest snapshot for this check strictly before `before_date`
    (YYYY-MM-DD). Used for "vs yesterday" — if a day was skipped (no
    upload happened), this still finds the most recent one available
    rather than showing nothing."""
    row = (
        db.query(DailyCheckSnapshot)
        .filter(DailyCheckSnapshot.check_key == check_key, DailyCheckSnapshot.date < before_date)
        .order_by(DailyCheckSnapshot.date.desc())
        .first()
    )
    if row is None:
        return None
    return json.loads(row.payload_json)


def get_previous_check_snapshot_with_date(db, check_key: str, before_date: str):
    """Same lookup as get_previous_check_snapshot, but also returns the
    snapshot's own date string alongside the payload — needed to look up
    that day's original Upload when backfilling an old-format snapshot
    that predates Person-ID tracking. Returns (date_str, payload) or
    (None, None) if no snapshot exists."""
    row = (
        db.query(DailyCheckSnapshot)
        .filter(DailyCheckSnapshot.check_key == check_key, DailyCheckSnapshot.date < before_date)
        .order_by(DailyCheckSnapshot.date.desc())
        .first()
    )
    if row is None:
        return None, None
    return row.date, json.loads(row.payload_json)


def get_snapshot_as_of(db, check_key: str, as_of_date: str):
    """Latest snapshot for this check on or before as_of_date (YYYY-MM-DD) —
    i.e. carry-forward semantics. Kept for any future use case that wants
    carry-forward; not used by the Deep Dive bar builder itself (which uses
    either an exact-date lookup or an in-range lookup, depending on the
    selected range)."""
    row = (
        db.query(DailyCheckSnapshot)
        .filter(DailyCheckSnapshot.check_key == check_key, DailyCheckSnapshot.date <= as_of_date)
        .order_by(DailyCheckSnapshot.date.desc())
        .first()
    )
    if row is None:
        return None
    return json.loads(row.payload_json)


def get_snapshot_exact(db, check_key: str, date_str: str):
    """Snapshot for this exact calendar date only — no carry-forward.
    Returns None if no Excel was uploaded (and therefore no snapshot
    saved) on that specific date. Used for the '1 Week' Deep Dive range,
    where each bar is an individual weekday and should render blank
    rather than repeating a previous day's number."""
    row = (
        db.query(DailyCheckSnapshot)
        .filter(DailyCheckSnapshot.check_key == check_key, DailyCheckSnapshot.date == date_str)
        .first()
    )
    if row is None:
        return None
    return json.loads(row.payload_json)


def get_latest_snapshot_in_range(db, check_key: str, start_date: str, end_date: str):
    """Latest snapshot for this check with date in [start_date, end_date]
    inclusive — used for week/month/quarter Deep Dive bars, where the bar
    represents "as of the most recent upload within this period" rather
    than one exact calendar day. Returns None only if NO upload happened
    anywhere in the period."""
    row = (
        db.query(DailyCheckSnapshot)
        .filter(
            DailyCheckSnapshot.check_key == check_key,
            DailyCheckSnapshot.date >= start_date,
            DailyCheckSnapshot.date <= end_date,
        )
        .order_by(DailyCheckSnapshot.date.desc())
        .first()
    )
    if row is None:
        return None
    return json.loads(row.payload_json)


def get_check_snapshot_range(db, check_key: str, date_from: str):
    """All snapshots for this check on/after `date_from`, oldest first — powers the Deep Dive trend."""
    rows = (
        db.query(DailyCheckSnapshot)
        .filter(DailyCheckSnapshot.check_key == check_key, DailyCheckSnapshot.date >= date_from)
        .order_by(DailyCheckSnapshot.date.asc())
        .all()
    )
    return [{"date": r.date, **json.loads(r.payload_json)} for r in rows]


def delete_check_snapshot(db, check_key: str, date_str: str) -> bool:
    """Removes a single day's snapshot for a check — used when a bad/wrong
    file was uploaded on that date and its numbers shouldn't count toward
    any trend or 'vs yesterday' comparison. Returns True if a row was
    actually deleted."""
    row = (
        db.query(DailyCheckSnapshot)
        .filter(DailyCheckSnapshot.check_key == check_key, DailyCheckSnapshot.date == date_str)
        .first()
    )
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True

def get_processed_file(db, file_key: str):
    return (
        db.query(ProcessedFile)
        .filter(ProcessedFile.file_key == file_key)
        .first()
    )


def create_processed_file(db, file_key: str, filename: str):
    record = ProcessedFile(
        file_key=file_key,
        filename=filename,
        status="processing",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def mark_processed_file_success(db, file_key: str):
    record = get_processed_file(db, file_key)
    if record is None:
        return

    record.status = "success"
    record.processed_at = datetime.utcnow()
    record.error_message = None
    db.commit()


def mark_processed_file_failed(db, file_key: str, error_message: str):
    record = get_processed_file(db, file_key)
    if record is None:
        return

    record.status = "failed"
    record.processed_at = None
    record.error_message = error_message
    db.commit()
