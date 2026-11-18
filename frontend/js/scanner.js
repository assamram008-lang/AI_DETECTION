(function () {
  const api = window.BodyScan;
  const $ = (selector) => document.querySelector(selector);
  const message = $("#scanner-message");
  const consent = $("#consent-check");
  const video = $("#camera-preview");
  const cameraPlaceholder = $("#camera-placeholder");
  const cameraSelect = $("#camera-select");
  const cameraState = $("#camera-state");
  const gallery = $("#photo-gallery");
  const submitButton = $("#submit-scan");
  const files = [];
  const selectedRegions = new Set();
  let stream = null;
  let cameras = [];
  let facing = "environment";
  let currentView = "front";

  const regionData = [
    { id: "head", label: "Head", view: "both", x: 50, y: 12 },
    { id: "neck", label: "Neck", view: "both", x: 50, y: 23 },
    { id: "chest", label: "Chest", view: "front", x: 50, y: 34 },
    { id: "abdomen", label: "Abdomen", view: "front", x: 50, y: 46 },
    { id: "pelvis", label: "Pelvis", view: "front", x: 50, y: 57 },
    { id: "back", label: "Back", view: "back", x: 50, y: 40 },
    { id: "left_shoulder", label: "Left shoulder", view: "both", x: 35, y: 30 },
    { id: "right_shoulder", label: "Right shoulder", view: "both", x: 65, y: 30 },
    { id: "left_arm", label: "Left arm", view: "both", x: 29, y: 43 },
    { id: "right_arm", label: "Right arm", view: "both", x: 71, y: 43 },
    { id: "left_hand", label: "Left hand", view: "both", x: 22, y: 60 },
    { id: "right_hand", label: "Right hand", view: "both", x: 78, y: 60 },
    { id: "left_thigh", label: "Left thigh", view: "both", x: 42, y: 68 },
    { id: "right_thigh", label: "Right thigh", view: "both", x: 58, y: 68 },
    { id: "left_knee", label: "Left knee", view: "both", x: 42, y: 79 },
    { id: "right_knee", label: "Right knee", view: "both", x: 58, y: 79 },
    { id: "left_lower_leg", label: "Left lower leg", view: "both", x: 43, y: 89 },
    { id: "right_lower_leg", label: "Right lower leg", view: "both", x: 57, y: 89 },
    { id: "left_foot", label: "Left foot", view: "both", x: 40, y: 97 },
    { id: "right_foot", label: "Right foot", view: "both", x: 60, y: 97 }
  ];

  function updateConsentControls() {
    const granted = consent.checked;
    $("#start-camera").disabled = !granted;
    $("#switch-camera").disabled = !granted || !stream;
    $("#stop-camera").disabled = !stream;
    $("#capture-photo").disabled = !granted || !stream;
    $("#photo-upload").disabled = !granted;
    submitButton.disabled = !granted || files.length === 0;
  }

  function requireConsent() {
    if (consent.checked) return true;
    api.setMessage(message, "Please read and check the consent box before using the camera or selecting photos.", "error");
    consent.focus();
    return false;
  }

  function cameraError(error) {
    const name = error && error.name;
    const messages = {
      NotAllowedError: "Camera permission was denied. Allow camera access in your browser settings, then try again.",
      SecurityError: "Camera access requires HTTPS or localhost. Open this site over a secure connection.",
      NotFoundError: "No camera was found. Connect a camera or choose photos from this device.",
      DevicesNotFoundError: "No camera was found. Connect a camera or choose photos from this device.",
      NotReadableError: "The camera is busy or unavailable. Close other camera apps or browser tabs and try again.",
      TrackStartError: "The camera could not start. Close other camera apps and try again.",
      OverconstrainedError: "That camera is unavailable. Choose another camera or use the default.",
      TypeError: "This browser does not support camera access. Try a current version of Chrome or Safari."
    };
    api.setMessage(message, messages[name] || "The camera could not start. Check browser permissions and try another camera or upload photos.", "error");
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    cameraPlaceholder.hidden = false;
    cameraState.textContent = "Camera off";
    updateConsentControls();
  }

  async function refreshCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
    const selected = cameraSelect.value;
    const activeId = stream && stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().deviceId;
    cameraSelect.replaceChildren();
    cameras.forEach((camera, index) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      cameraSelect.append(option);
    });
    if (!cameras.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Default camera";
      cameraSelect.append(option);
    }
    if (activeId && cameras.some((camera) => camera.deviceId === activeId)) cameraSelect.value = activeId;
    else if (selected && cameras.some((camera) => camera.deviceId === selected)) cameraSelect.value = selected;
    cameraSelect.disabled = cameras.length < 2;
  }

  async function startCamera() {
    if (!requireConsent()) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      cameraError({ name: "TypeError" });
      return;
    }
    stopCamera();
    try {
      const selectedId = cameraSelect.value;
      const videoConstraints = selectedId
        ? { deviceId: { exact: selectedId } }
        : { facingMode: { ideal: facing } };
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...videoConstraints, width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      cameraPlaceholder.hidden = true;
      cameraState.textContent = "Camera active";
      await refreshCameras();
      updateConsentControls();
      api.clearMessage(message);
    } catch (error) {
      stopCamera();
      cameraError(error);
    }
  }

  function renderGallery() {
    $("#photo-count").textContent = `${files.length} / 16`;
    if (!files.length) {
      gallery.innerHTML = '<div class="empty-gallery">No photos added yet.</div>';
      updateConsentControls();
      return;
    }
    gallery.innerHTML = files.map((item, index) => `
      <article class="photo-card">
        <img src="${item.url}" alt="${api.escape(item.viewLabel)} view preview">
        <div class="photo-meta"><span>${api.escape(item.viewLabel)} · ${api.escape(item.file.name)}</span><button class="photo-delete" type="button" data-remove="${index}" aria-label="Remove ${api.escape(item.file.name)}">×</button></div>
      </article>`).join("");
    gallery.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => removePhoto(Number(button.dataset.remove)));
    });
    updateConsentControls();
  }

  function removePhoto(index) {
    const removed = files.splice(index, 1)[0];
    if (removed) URL.revokeObjectURL(removed.url);
    renderGallery();
  }

  function addPhoto(file, view, viewLabel) {
    if (files.length >= 16) throw new Error("You can add up to 16 photos.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error(`${file.name}: choose a JPEG, PNG, or WebP image.`);
    }
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name}: image must be 8 MB or smaller.`);
    if (file.size === 0) throw new Error(`${file.name}: this image is empty.`);
    files.push({ file, view, viewLabel, url: URL.createObjectURL(file) });
  }

  function capturePhoto() {
    if (!requireConsent() || !stream) return;
    if (!video.videoWidth || !video.videoHeight) {
      api.setMessage(message, "The camera is still adjusting. Wait a moment and capture again.", "error");
      return;
    }
    if (files.length >= 16) {
      api.setMessage(message, "You can add up to 16 photos. Remove a photo to continue.", "error");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      api.setMessage(message, "This browser could not prepare the image. Please try uploading a photo instead.", "error");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        api.setMessage(message, "The photo could not be captured. Please try again.", "error");
        return;
      }
      const view = $("#view-select").value;
      const label = { front: "Front", back: "Back", left: "Left side", right: "Right side" }[view];
      const file = new File([blob], `${view}-${Date.now()}.jpg`, { type: "image/jpeg" });
      addPhoto(file, view, label);
      renderGallery();
      api.setMessage(message, `${label} view added. Review it below before submitting.`, "success");
    }, "image/jpeg", 0.9);
  }

  function displayRegions(view) {
    currentView = view;
    $("#body-diagram").dataset.view = view;
    document.querySelectorAll(".map-view").forEach((button) => {
      button.classList.toggle("active", button.dataset.mapView === view);
      button.setAttribute("aria-pressed", String(button.dataset.mapView === view));
    });
    const available = regionData.filter((region) => region.view === view || region.view === "both");
    $("#region-buttons").innerHTML = available.map((region) => `
      <button class="region-button${selectedRegions.has(region.id) ? " selected" : ""}" type="button" data-region="${region.id}" aria-pressed="${selectedRegions.has(region.id)}">${region.label}</button>`).join("");
    $("#region-pins").innerHTML = available.map((region) => `
      <button class="region-pin${selectedRegions.has(region.id) ? " selected" : ""}" type="button" style="left:${region.x}%;top:${region.y}%" data-region="${region.id}" aria-label="${region.label}" aria-pressed="${selectedRegions.has(region.id)}"></button>`).join("");
    document.querySelectorAll("[data-region]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.region;
        if (selectedRegions.has(id)) selectedRegions.delete(id);
        else selectedRegions.add(id);
        displayRegions(currentView);
      });
    });
    const labels = regionData.filter((region) => selectedRegions.has(region.id)).map((region) => region.label);
    $("#selected-regions").textContent = labels.length ? `Selected: ${labels.join(", ")}` : "No body areas selected.";
  }

  function getSavedReports() {
    try {
      const value = JSON.parse(localStorage.getItem("bodyScanReports") || "[]");
      return Array.isArray(value) ? value.filter((item) => item && item.id && item.token) : [];
    } catch {
      return [];
    }
  }

  function showSubmissionResult(report) {
    const section = $("#submission-result");
    section.hidden = false;
    section.innerHTML = `
      <p class="eyebrow">SCAN SUBMITTED</p><h2>Your private report access code</h2>
      <p>This code is shown only once. Anyone with it can access this report and its images. Save it somewhere secure or save it on this device. No account recovery is available.</p>
      <label class="field-label" for="report-access-code">Access code</label>
      <input id="report-access-code" readonly value="${api.escape(report.token)}" aria-label="Private report access code">
      <div class="result-actions"><button id="copy-access-code" class="button button-outline" type="button">Copy code</button><button id="save-report" class="button button-primary" type="button">Save report on this device</button><a class="button button-quiet" href="reports.html">View reports</a></div>
      <p id="save-report-state" class="fine-print" aria-live="polite">Saving stores this secret in this browser's local storage. Do not do this on a shared device.</p>`;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
    $("#copy-access-code").addEventListener("click", async () => {
      const input = $("#report-access-code");
      input.select();
      try {
        await navigator.clipboard.writeText(report.token);
        $("#copy-access-code").textContent = "Copied";
      } catch {
        $("#save-report-state").textContent = "Select and copy the access code manually. Clipboard access was unavailable.";
      }
    });
    $("#save-report").addEventListener("click", () => {
      try {
        const reports = getSavedReports().filter((item) => item.id !== report.id);
        reports.unshift(report);
        localStorage.setItem("bodyScanReports", JSON.stringify(reports.slice(0, 50)));
        $("#save-report-state").textContent = "Saved on this device. Keep the access code private.";
      } catch {
        $("#save-report-state").textContent = "Could not save this report in browser storage. Copy the access code and keep it securely.";
      }
    });
  }

  async function submitScan() {
    if (!requireConsent()) return;
    if (!files.length) {
      api.setMessage(message, "Add at least one photo before submitting the scan.", "error");
      return;
    }
    const form = new FormData();
    form.append("consent", "true");
    form.append("observations", JSON.stringify(
      Array.from(document.querySelectorAll('input[name="observation"]:checked')).map((input) => input.value)
    ));
    form.append("regions", JSON.stringify(Array.from(selectedRegions)));
    form.append("notes", $("#observation-note").value.trim());
    files.forEach((item) => {
      form.append("images", item.file, item.file.name);
      form.append("views", item.view);
    });
    submitButton.disabled = true;
    submitButton.textContent = "Submitting securely…";
    api.clearMessage(message);
    try {
      const result = await api.request("/api/scans", { method: "POST", body: form });
      if (!result.access_token || !result.id) throw new Error("The server response did not include secure report access. Contact the server administrator.");
      files.forEach((item) => URL.revokeObjectURL(item.url));
      files.length = 0;
      renderGallery();
      stopCamera();
      showSubmissionResult({ id: result.id, token: result.access_token, createdAt: result.created_at });
      api.setMessage(message, "Your scan was submitted. AI injury analysis is unavailable; this report contains only your observations and any available body landmarks.", "success");
    } catch (error) {
      api.setMessage(message, error.message, "error");
    } finally {
      submitButton.textContent = "Submit scan →";
      updateConsentControls();
    }
  }

  consent.addEventListener("change", () => {
    if (!consent.checked) stopCamera();
    else updateConsentControls();
  });
  $("#start-camera").addEventListener("click", startCamera);
  $("#stop-camera").addEventListener("click", stopCamera);
  $("#switch-camera").addEventListener("click", async () => {
    if (!requireConsent()) return;
    if (cameras.length > 1) {
      const currentIndex = cameras.findIndex((camera) => camera.deviceId === cameraSelect.value);
      const next = cameras[(currentIndex + 1 + cameras.length) % cameras.length];
      cameraSelect.value = next.deviceId;
      facing = /front|user|facetime/i.test(next.label) ? "user" : "environment";
    } else {
      facing = facing === "environment" ? "user" : "environment";
      cameraSelect.value = "";
    }
    await startCamera();
  });
  cameraSelect.addEventListener("change", startCamera);
  $("#capture-photo").addEventListener("click", capturePhoto);
  $("#photo-upload").addEventListener("change", (event) => {
    if (!requireConsent()) {
      event.target.value = "";
      return;
    }
    const view = $("#view-select").value;
    const label = { front: "Front", back: "Back", left: "Left side", right: "Right side" }[view];
    try {
      Array.from(event.target.files || []).forEach((file) => addPhoto(file, view, label));
      renderGallery();
      api.clearMessage(message);
    } catch (error) {
      renderGallery();
      api.setMessage(message, error.message, "error");
    }
    event.target.value = "";
  });
  document.querySelectorAll(".map-view").forEach((button) => {
    button.addEventListener("click", () => displayRegions(button.dataset.mapView));
  });
  submitButton.addEventListener("click", submitScan);
  window.addEventListener("pagehide", () => {
    stopCamera();
    files.forEach((item) => URL.revokeObjectURL(item.url));
  });

  displayRegions("front");
  updateConsentControls();
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    api.setMessage(message, "Camera access on this device requires HTTPS. Localhost is secure only on the same device; for a phone, open this app through an HTTPS tunnel or deployment.", "info");
  }
})();
