import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend import database, main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "scans.sqlite3")
    monkeypatch.setattr(main, "DATA_DIR", tmp_path / "private")
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret-key-with-at-least-32-characters")
    monkeypatch.setenv("DOCTOR_USERNAME", "test-doctor")
    monkeypatch.setenv("DOCTOR_PASSWORD", "test-password")
    monkeypatch.setattr(main, "detect_pose", lambda _: {
        "available": True, "detected": False, "landmarks": []
    })
    with TestClient(main.app) as test_client:
        yield test_client


def image_bytes() -> bytes:
    data = io.BytesIO()
    Image.new("RGB", (32, 48), "white").save(data, format="PNG")
    return data.getvalue()


def submit(client: TestClient, consent: str = "true"):
    return client.post(
        "/api/scans",
        data={
            "consent": consent,
            "observations": json.dumps(["bruises"]),
            "regions": json.dumps(["left_arm"]),
            "notes": "Synthetic test note",
            "views": "front",
        },
        files=[("images", ("front.png", image_bytes(), "image/png"))],
    )


def doctor_token(client: TestClient) -> str:
    response = client.post(
        "/api/doctor/login",
        json={"username": "test-doctor", "password": "test-password"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_health_and_consent_gate(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    denied = submit(client, consent="false")
    assert denied.status_code == 403
    assert "consent" in denied.json()["detail"].lower()


def test_private_scan_review_and_image_deletion(client):
    created = submit(client)
    assert created.status_code == 201
    scan = created.json()
    assert scan["injury_analysis"]["available"] is False
    assert scan["observations"] == ["bruises"]
    assert scan["regions"] == ["left_arm"]
    assert scan["notes"] == "Synthetic test note"
    assert scan["images"][0]["landmarks"]["available"] is True
    assert scan["access_token"].startswith("pat.")

    scan_url = f"/api/scans/{scan['id']}"
    assert client.get(scan_url).status_code == 401
    wrong_token = {"Authorization": "Bearer pat.not-the-right-token"}
    assert client.get(scan_url, headers=wrong_token).status_code == 401
    patient_auth = {"Authorization": f"Bearer {scan['access_token']}"}
    assert client.get(scan_url, headers=patient_auth).status_code == 200

    image = scan["images"][0]
    downloaded = client.get(
        f"/api/scans/{scan['id']}/images/{image['image_id']}",
        headers=patient_auth,
    )
    assert downloaded.status_code == 200
    assert downloaded.content == image_bytes()
    assert downloaded.headers["cache-control"] == "no-store"

    doctor_auth = {"Authorization": f"Bearer {doctor_token(client)}"}
    queue = client.get("/api/doctor/scans", headers=doctor_auth)
    assert queue.status_code == 200
    assert len(queue.json()) == 1
    review = client.post(
        f"/api/doctor/scans/{scan['id']}/review",
        headers=doctor_auth,
        json={"status": "approved", "comments": "Clinician review recorded."},
    )
    assert review.status_code == 200
    reviewed = client.get(scan_url, headers=patient_auth).json()
    assert reviewed["status"] == "approved"
    assert reviewed["doctor_comments"] == "Clinician review recorded."

    deleted = client.delete(f"{scan_url}/images", headers=patient_auth)
    assert deleted.status_code == 200
    assert client.get(
        f"/api/scans/{scan['id']}/images/{image['image_id']}",
        headers=patient_auth,
    ).status_code == 404


def test_upload_content_type_is_validated(client):
    response = client.post(
        "/api/scans",
        data={"consent": "true", "observations": "[]", "regions": "[]", "views": "front"},
        files=[("images", ("not-a-png.png", b"not an image", "image/png"))],
    )
    assert response.status_code == 422
    assert "image" in response.json()["detail"].lower()
