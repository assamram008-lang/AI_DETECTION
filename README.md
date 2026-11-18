# AI Body Scan

An experimental, consent-first visual documentation app. It can store user-selected observations and body regions and, when its optional server dependencies are installed, report MediaPipe Pose landmarks. **It does not detect injuries, diagnose conditions, or establish that a person is medically safe.**

## What is implemented

- Responsive home, scanner, private reports, and clinician portal pages using HTML, CSS, and vanilla JavaScript.
- Consent-required mobile/desktop camera access, rear-camera preference, camera enumeration/switching, four guided views, local previews, retake/removal, and JPEG/PNG/WebP upload validation.
- SQLite scan records, private image storage outside the static frontend, per-report random access codes, and authenticated image/report routes.
- Server-side MediaPipe Pose landmark processing. Each image states whether pose processing was available and whether landmarks were found. Landmark coordinates and visibility are not injury findings.
- User-selected body regions, observations, and optional notes; none are represented as AI findings.
- Separate clinician sign-in using server-configured credentials, signed expiring doctor tokens, report review, comments, and role checks.
- Image deletion from an authorized report, an audit log, and optional age-based image deletion at server startup.
- Print / Save as PDF from an authenticated report in the browser. The browser’s print dialog handles the PDF; there is no separate PDF service.
- API and image-validation tests with synthetic images.

There is **no clinically validated injury model** in this project. The interface and API report “AI injury analysis unavailable”; no confidence scores or simulated injury results are generated. Do not rely on this tool for diagnosis, triage, or treatment decisions.

## Requirements

- Windows 10/11 and Python 3.11.
- A current Chrome, Edge, or Safari browser.
- Camera access is available only in a secure context: HTTPS, or `localhost` on the same device.
- MediaPipe/OpenCV are optional for running the server but required for real pose-landmark processing. If not installed, scans are still documented and explicitly report that landmark processing is unavailable.

## Windows setup (PowerShell)

Run these commands from the **opened project folder**:

```powershell
py -3.11 --version
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
Copy-Item .env.example .env
notepad .env
```

In `.env`, replace the example `APP_SECRET_KEY` with a unique random value of at least 32 characters and set a strong, unique `DOCTOR_PASSWORD`. Generate a secret with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Keep `.env` private; it is excluded by `.gitignore`. Do not reuse the example credentials or publish your server URL and access codes.

Start the backend in one PowerShell terminal:

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Start the static frontend in a second terminal, from the project folder:

```powershell
python -m http.server 5500 --bind 127.0.0.1 --directory frontend
```

Open [http://127.0.0.1:5500](http://127.0.0.1:5500). Check the API with:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

For development, you can instead run Uvicorn with `--reload`. Do not expose a development server publicly.

## Android Chrome and iPhone Safari

On a phone, `localhost` means the phone itself, not your Windows computer. Opening `http://<computer-ip>` is not a secure context and usually cannot access the camera. Use HTTPS for **both** the frontend and API when testing from a phone.

One tunnel setup (install `cloudflared` separately):

1. Keep the frontend server and backend running on the Windows computer.
2. In two additional terminals, create temporary HTTPS tunnels:

   ```powershell
   cloudflared tunnel --url http://127.0.0.1:5500
   cloudflared tunnel --url http://127.0.0.1:8000
   ```

3. Copy the exact HTTPS frontend and API URLs printed by the tunnel tool. In `frontend\js\config.js`, set `window.AI_BODY_SCAN_API_URL` to the API tunnel URL.
4. In `.env`, set `FRONTEND_ORIGINS` to the exact frontend origin (scheme and host only, no path), for example `https://your-frontend.trycloudflare.com`. Restart the backend after changing this setting.
5. Open the frontend HTTPS URL on the phone and grant camera permission. Use **Switch camera** to change between available cameras. Keep the API URL on HTTPS too, or the browser will block the request as mixed content.

Tunnel URLs can change; update both settings when they do. Treat temporary tunnel URLs as public endpoints: use a strong doctor password, do not share access codes, and stop the tunnels when testing is finished. A production deployment should use stable HTTPS, a reverse proxy, secrets management, rate limiting, backups, and a reviewed privacy/security policy. CORS is restricted to the configured exact frontend origins; do not set it to `*`.

## Configuration and privacy

- `APP_SECRET_KEY`: signing secret for doctor sessions; at least 32 characters.
- `DOCTOR_USERNAME` and `DOCTOR_PASSWORD`: clinician credentials held only by the backend environment.
- `FRONTEND_ORIGINS`: comma-separated exact browser origins; no wildcard.
- `AI_BODY_SCAN_DATABASE`: SQLite file path (default `backend/data/scans.sqlite3`).
- `AI_BODY_SCAN_DATA_DIR`: private image storage path (default `backend/data/private`).
- `IMAGE_RETENTION_DAYS`: `0` disables automatic deletion; a positive integer removes images older than that many days during startup. Scan notes and metadata remain. Patients can also delete a report’s images from its authenticated report page.

No patient name, email, date of birth, or account is requested. A scan is accessible with its random report access code; it is a bearer secret, so anyone holding it can view that report and its private images. The code is shown once after submission. Save it only on a trusted device or keep it securely elsewhere. The clinician portal uses a separate role and server-side credentials. Audit entries track report submissions, authorized views, image deletion, doctor sign-in, and review actions.

Images are uploaded only after the user checks consent and presses **Submit scan**. Camera access and local image previews do not upload photos. The server verifies image format, declared MIME type, file size, and dimensions. Private photos are served only through authorization-protected endpoints. This local starter app is not a certified medical device and does not by itself provide HIPAA/GDPR compliance or production-grade account recovery, abuse protection, or key rotation.

## Test

From the project folder with the virtual environment active:

```powershell
python -m pytest -q
```

The API tests use temporary SQLite storage and synthetic images. Browser camera access and switching require a real device and user permission; automated API tests cannot verify physical camera hardware. No Android/iPhone device is assumed to be attached.

## API outline

- `GET /api/health`
- `POST /api/scans` — multipart consent, image files, view labels, observations, body regions, and notes
- `GET /api/scans/{scan_id}` and `GET /api/scans/{scan_id}/images/{image_id}` — bearer access code required
- `DELETE /api/scans/{scan_id}/images` — report access code required
- `POST /api/doctor/login`, `GET /api/doctor/scans`, and `POST /api/doctor/scans/{scan_id}/review` — doctor role required

Interactive API documentation is available at `http://127.0.0.1:8000/docs` during local development.
