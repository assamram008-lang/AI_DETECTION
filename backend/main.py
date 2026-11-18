import hashlib
import hmac
import json
import os
import secrets
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import database
from .scanner import InvalidImageError, MAX_IMAGE_BYTES, detect_pose, validate_image


load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="AI Body Scan API", version="1.0.0")
allowed_origins = [
    origin.strip() for origin in os.environ.get(
        "FRONTEND_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500",
    ).split(",") if origin.strip()
]
if "*" in allowed_origins:
    raise RuntimeError("FRONTEND_ORIGINS must contain exact origins and cannot include '*'.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

DATA_DIR = Path(os.environ.get(
    "AI_BODY_SCAN_DATA_DIR",
    Path(__file__).parent / "data" / "private",
)).resolve()
VALID_VIEWS = {"front", "back", "left", "right", "upload"}
VALID_OBSERVATIONS = {"cuts", "bruises", "swelling", "abrasions", "redness", "other"}
VALID_REGIONS = {
    "head", "neck", "chest", "abdomen", "pelvis", "left_shoulder",
    "right_shoulder", "left_arm", "right_arm", "left_hand", "right_hand",
    "left_thigh", "right_thigh", "left_knee", "right_knee",
    "left_lower_leg", "right_lower_leg", "left_foot", "right_foot", "back",
}


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class ReviewRequest(BaseModel):
    status: str
    comments: str = Field(default="", max_length=4000)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def secret_key() -> bytes:
    key = os.environ.get("APP_SECRET_KEY", "")
    if len(key) < 32:
        raise HTTPException(
            status_code=503,
            detail="Server authentication is not configured. Set APP_SECRET_KEY to at least 32 characters.",
        )
    return key.encode("utf-8")


def token_for_doctor(username: str) -> str:
    payload = json.dumps(
        {"sub": username, "role": "doctor", "exp": int(time.time()) + 8 * 60 * 60},
        separators=(",", ":"),
    ).encode()
    encoded = __import__("base64").urlsafe_b64encode(payload).decode().rstrip("=")
    signature = hmac.new(secret_key(), encoded.encode(), hashlib.sha256).hexdigest()
    return f"doc.{encoded}.{signature}"


def actor_for_token(token: str | None) -> dict[str, str] | None:
    if not token:
        return None
    if token.startswith("doc."):
        try:
            _, payload, signature = token.split(".", 2)
            expected = hmac.new(secret_key(), payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                return None
            raw = __import__("base64").urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
            parsed = json.loads(raw)
            if parsed.get("role") != "doctor" or parsed.get("exp", 0) < time.time():
                return None
            return {"role": "doctor", "username": parsed["sub"]}
        except (ValueError, KeyError, json.JSONDecodeError, HTTPException):
            return None
    if token.startswith("pat."):
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with database.connect() as connection:
            record = connection.execute(
                "SELECT id FROM scans WHERE access_token_hash = ?", (token_hash,)
            ).fetchone()
        if record:
            return {"role": "patient", "scan_id": record["id"]}
    return None


def require_doctor(authorization: str | None = Header(default=None)) -> dict[str, str]:
    actor = actor_for_token(authorization.removeprefix("Bearer ").strip() if authorization else None)
    if not actor or actor["role"] != "doctor":
        raise HTTPException(status_code=401, detail="Doctor authentication is required.")
    return actor


def authorize_scan(scan_id: str, authorization: str | None) -> dict[str, str]:
    actor = actor_for_token(authorization.removeprefix("Bearer ").strip() if authorization else None)
    if not actor or (
        actor["role"] == "patient" and actor.get("scan_id") != scan_id
    ):
        raise HTTPException(status_code=401, detail="A valid scan access token is required.")
    return actor


def public_scan(record: dict[str, Any], include_paths: bool = False) -> dict[str, Any]:
    return {
        "id": record["id"],
        "created_at": record["created_at"],
        "observations": json.loads(record["observations"]),
        "regions": json.loads(record["regions"]),
        "notes": record["notes"],
        "status": record["status"],
        "doctor_comments": record["doctor_comments"],
        "injury_analysis": {
            "available": False,
            "message": "AI injury analysis is unavailable. No injury model is configured.",
        },
        "images": [
            {
                "view": image["view"],
                "media_type": image["media_type"],
                "landmarks": json.loads(image["landmarks"]),
                **({"image_id": image["id"]} if include_paths else {}),
            }
            for image in record["images"]
        ],
    }


def initialize() -> None:
    database.initialize_database()


def remove_expired_images() -> None:
    try:
        retention_days = int(os.environ.get("IMAGE_RETENTION_DAYS", "0"))
    except ValueError as error:
        raise RuntimeError("IMAGE_RETENTION_DAYS must be a non-negative integer.") from error
    if retention_days < 0:
        raise RuntimeError("IMAGE_RETENTION_DAYS must be a non-negative integer.")
    if retention_days == 0:
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    with database.connect() as connection:
        scan_rows = connection.execute("SELECT id, created_at FROM scans").fetchall()
    for row in scan_rows:
        if datetime.fromisoformat(row["created_at"]) >= cutoff:
            continue
        record = database.get_scan(row["id"])
        if not record or not record["images"]:
            continue
        for image in record["images"]:
            Path(image["file_path"]).unlink(missing_ok=True)
        with database.connect() as connection:
            connection.execute("DELETE FROM scan_images WHERE scan_id = ?", (row["id"],))
        database.audit(row["id"], "images_expired", "system", utc_now())
        folder = DATA_DIR / row["id"]
        if folder.is_dir():
            folder.rmdir()


@app.on_event("startup")
def startup() -> None:
    initialize()
    remove_expired_images()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/doctor/login")
def doctor_login(request: LoginRequest) -> dict[str, str]:
    configured_username = os.environ.get("DOCTOR_USERNAME", "")
    configured_password = os.environ.get("DOCTOR_PASSWORD", "")
    if not configured_username or not configured_password:
        raise HTTPException(status_code=503, detail="Doctor credentials are not configured on this server.")
    if not (
        hmac.compare_digest(request.username, configured_username)
        and hmac.compare_digest(request.password, configured_password)
    ):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    database.audit(None, "doctor_login", "doctor", utc_now())
    return {"access_token": token_for_doctor(request.username), "token_type": "bearer"}


@app.post("/api/scans", status_code=201)
async def create_scan(
    consent: bool = Form(...),
    observations: str = Form(default="[]"),
    regions: str = Form(default="[]"),
    notes: str = Form(default=""),
    views: list[str] = Form(default=[]),
    images: list[UploadFile] = File(default=[]),
) -> dict[str, Any]:
    if not consent:
        raise HTTPException(status_code=403, detail="Explicit image-processing consent is required.")
    if not images:
        raise HTTPException(status_code=422, detail="Add at least one image to create a scan.")
    if len(images) > 16 or len(images) != len(views):
        raise HTTPException(status_code=422, detail="Provide matching image and view entries (up to 16 images).")
    try:
        observation_values = json.loads(observations)
        region_values = json.loads(regions)
        if (
            not isinstance(observation_values, list)
            or not isinstance(region_values, list)
            or any(value not in VALID_OBSERVATIONS for value in observation_values)
            or any(value not in VALID_REGIONS for value in region_values)
        ):
            raise ValueError
    except (json.JSONDecodeError, ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Observations or body regions are invalid.")
    if any(view not in VALID_VIEWS for view in views):
        raise HTTPException(status_code=422, detail="An image view is invalid.")
    if len(notes) > 1000:
        raise HTTPException(status_code=422, detail="Notes must be 1,000 characters or fewer.")

    scan_id = str(uuid4())
    access_token = f"pat.{secrets.token_urlsafe(32)}"
    access_hash = hashlib.sha256(access_token.encode()).hexdigest()
    folder = DATA_DIR / scan_id
    folder.mkdir(parents=True, exist_ok=False)
    saved: list[tuple[str, str, str, str]] = []
    try:
        for upload, view in zip(images, views):
            content = await upload.read(MAX_IMAGE_BYTES + 1)
            media_type = (upload.content_type or "").lower()
            validate_image(content, media_type)
            pose_data = detect_pose(content)
            suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[media_type]
            image_path = folder / f"{uuid4().hex}{suffix}"
            image_path.write_bytes(content)
            saved.append((view, str(image_path), media_type, json.dumps(pose_data)))
        created_at = utc_now()
        with database.connect() as connection:
            connection.execute(
                "INSERT INTO scans (id, access_token_hash, created_at, observations, regions, notes) VALUES (?, ?, ?, ?, ?, ?)",
                (scan_id, access_hash, created_at, json.dumps(observation_values), json.dumps(region_values), notes.strip()),
            )
            connection.executemany(
                "INSERT INTO scan_images (scan_id, view, file_path, media_type, landmarks) VALUES (?, ?, ?, ?, ?)",
                [(scan_id, *image) for image in saved],
            )
            connection.execute(
                "INSERT INTO audit_log (scan_id, action, actor_role, created_at) VALUES (?, ?, ?, ?)",
                (scan_id, "scan_submitted", "patient", created_at),
            )
    except InvalidImageError as error:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(error))
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return {
        **public_scan(database.get_scan(scan_id) or {}, include_paths=True),
        "access_token": access_token,
    }


@app.get("/api/scans/{scan_id}")
def get_patient_scan(scan_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    actor = authorize_scan(scan_id, authorization)
    record = database.get_scan(scan_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Scan not found.")
    database.audit(scan_id, "scan_viewed", actor["role"], utc_now())
    return public_scan(record, include_paths=True)


@app.get("/api/scans/{scan_id}/images/{image_id}")
def get_image(
    scan_id: str,
    image_id: int,
    authorization: str | None = Header(default=None),
) -> FileResponse:
    actor = authorize_scan(scan_id, authorization)
    with database.connect() as connection:
        image = connection.execute(
            "SELECT file_path, media_type FROM scan_images WHERE id = ? AND scan_id = ?",
            (image_id, scan_id),
        ).fetchone()
    if image is None or not Path(image["file_path"]).is_file():
        raise HTTPException(status_code=404, detail="Image not found.")
    database.audit(scan_id, "image_viewed", actor["role"], utc_now())
    return FileResponse(
        image["file_path"],
        media_type=image["media_type"],
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.delete("/api/scans/{scan_id}/images")
def delete_images(scan_id: str, authorization: str | None = Header(default=None)) -> dict[str, str]:
    actor = authorize_scan(scan_id, authorization)
    record = database.get_scan(scan_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Scan not found.")
    for image in record["images"]:
        Path(image["file_path"]).unlink(missing_ok=True)
    with database.connect() as connection:
        connection.execute("DELETE FROM scan_images WHERE scan_id = ?", (scan_id,))
    database.audit(scan_id, "images_deleted", actor["role"], utc_now())
    return {"status": "images_deleted"}


@app.get("/api/doctor/scans")
def list_doctor_scans(actor: dict[str, str] = Depends(require_doctor)) -> list[dict[str, Any]]:
    with database.connect() as connection:
        ids = connection.execute("SELECT id FROM scans ORDER BY created_at DESC LIMIT 200").fetchall()
    results = []
    for item in ids:
        record = database.get_scan(item["id"])
        if record:
            results.append(public_scan(record, include_paths=True))
    database.audit(None, "doctor_scan_list_viewed", actor["role"], utc_now())
    return results


@app.post("/api/doctor/scans/{scan_id}/review")
def review_scan(
    scan_id: str,
    request: ReviewRequest,
    actor: dict[str, str] = Depends(require_doctor),
) -> dict[str, str]:
    if request.status not in {"approved", "rejected"}:
        raise HTTPException(status_code=422, detail="Status must be approved or rejected.")
    with database.connect() as connection:
        updated = connection.execute(
            "UPDATE scans SET status = ?, doctor_comments = ? WHERE id = ?",
            (request.status, request.comments.strip(), scan_id),
        ).rowcount
    if not updated:
        raise HTTPException(status_code=404, detail="Scan not found.")
    database.audit(scan_id, f"report_{request.status}", actor["role"], utc_now())
    return {"status": request.status, "message": "Review saved."}
