(function () {
  const api = window.BodyScan;
  const message = document.querySelector("#doctor-message");
  const loginPanel = document.querySelector("#doctor-login-panel");
  const workspace = document.querySelector("#doctor-workspace");
  const scanList = document.querySelector("#doctor-scan-list");
  const imageUrls = [];
  let token = sessionStorage.getItem("bodyScanDoctorToken") || "";

  async function secureImage(scanId, imageId) {
    const response = await fetch(`${api.apiBase}/api/scans/${encodeURIComponent(scanId)}/images/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("An image could not be loaded.");
    const url = URL.createObjectURL(await response.blob());
    imageUrls.push(url);
    return url;
  }

  function observationLabel(value) {
    return ({
      cuts: "Cuts", bruises: "Bruises", swelling: "Swelling",
      abrasions: "Abrasions", redness: "Redness", other: "Other visible finding"
    })[value] || value;
  }

  function regionLabel(value) {
    return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  async function renderScan(scan) {
    const card = document.createElement("article");
    card.className = "doctor-card";
    card.innerHTML = `
      <div class="doctor-card-top"><div><p class="eyebrow">SUBMITTED ${api.escape(new Date(scan.created_at).toLocaleString())}</p><h3>Scan ${api.escape(scan.id)}</h3></div><span class="report-status">${api.escape(scan.status)}</span></div>
      <p><b>Patient-selected areas:</b> ${scan.regions.length ? api.escape(scan.regions.map(regionLabel).join(", ")) : "None selected"}<br><b>Patient-entered observations:</b> ${scan.observations.length ? api.escape(scan.observations.map(observationLabel).join(", ")) : "None selected"}</p>
      <h4>Patient-selected body map</h4>${api.bodyMapHtml(scan.regions)}
      ${scan.notes ? `<p><b>Patient note:</b> ${api.escape(scan.notes)}</p>` : ""}
      <div class="doctor-gallery" aria-label="Submitted photos"></div>
      <p class="landmark-summary"><b>Pose landmarks only:</b> ${api.escape(scan.images.map((image) => {
        if (!image.landmarks.available) return `${image.view}: processing unavailable`;
        if (!image.landmarks.detected) return `${image.view}: no landmarks detected`;
        return `${image.view}: ${image.landmarks.landmarks.filter((point) => point.visibility >= 0.5).length} visible landmarks`;
      }).join("; ") || "No images attached." )}<br><b>AI injury analysis unavailable.</b> Landmark processing does not detect injuries.</p>
      <form class="doctor-review-form"><label><span class="field-label">Clinician comments</span><textarea maxlength="4000" aria-label="Clinician comments" placeholder="Enter review comments…">${api.escape(scan.doctor_comments || "")}</textarea></label><div class="review-actions"><button class="button button-primary" type="submit" data-status="approved">Approve report</button><button class="button button-outline" type="submit" data-status="rejected">Reject report</button></div></form>`;
    scanList.append(card);
    const gallery = card.querySelector(".doctor-gallery");
    for (const image of scan.images) {
      try {
        const url = await secureImage(scan.id, image.image_id);
        const img = document.createElement("img");
        img.src = url;
        img.alt = `${image.view} view submitted for review`;
        gallery.append(img);
      } catch (error) {
        api.setMessage(message, error.message, "error");
      }
    }
    card.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const status = button && button.dataset.status;
      if (!status) return;
      button.disabled = true;
      try {
        await api.request(`/api/doctor/scans/${encodeURIComponent(scan.id)}/review`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status, comments: card.querySelector("textarea").value })
        });
        api.setMessage(message, `Report ${status} and clinician comments saved.`, "success");
        await loadQueue();
      } catch (error) {
        api.setMessage(message, error.message, "error");
        button.disabled = false;
      }
    });
  }

  async function loadQueue() {
    imageUrls.forEach((url) => URL.revokeObjectURL(url));
    imageUrls.length = 0;
    scanList.replaceChildren();
    const scans = await api.request("/api/doctor/scans", {
      headers: { Authorization: `Bearer ${token}` }
    });
    loginPanel.hidden = true;
    workspace.hidden = false;
    if (!scans.length) {
      scanList.innerHTML = '<div class="empty-state panel"><span class="empty-icon">✓</span><h2>No submitted scans</h2><p>New reports will appear here after submission.</p></div>';
      return;
    }
    for (const scan of scans) await renderScan(scan);
  }

  document.querySelector("#doctor-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Signing in…";
    try {
      const result = await api.request("/api/doctor/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") })
      });
      token = result.access_token;
      sessionStorage.setItem("bodyScanDoctorToken", token);
      await loadQueue();
      api.clearMessage(message);
    } catch (error) {
      token = "";
      sessionStorage.removeItem("bodyScanDoctorToken");
      api.setMessage(message, error.message, "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in securely";
    }
  });

  document.querySelector("#doctor-logout").addEventListener("click", () => {
    sessionStorage.removeItem("bodyScanDoctorToken");
    token = "";
    imageUrls.forEach((url) => URL.revokeObjectURL(url));
    imageUrls.length = 0;
    scanList.replaceChildren();
    workspace.hidden = true;
    loginPanel.hidden = false;
    api.setMessage(message, "You have signed out.", "info");
  });

  if (token) {
    loadQueue().catch((error) => {
      token = "";
      sessionStorage.removeItem("bodyScanDoctorToken");
      api.setMessage(message, `Your session expired or could not be restored. ${error.message}`, "error");
      loginPanel.hidden = false;
    });
  }
})();
