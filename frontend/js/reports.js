(function () {
  const api = window.BodyScan;
  const list = document.querySelector("#reports-list");
  const message = document.querySelector("#reports-message");
  const objectUrls = [];
  const observationLabels = {
    cuts: "Cuts", bruises: "Bruises", swelling: "Swelling",
    abrasions: "Abrasions", redness: "Redness", other: "Other visible finding"
  };
  const regionLabels = {
    head: "Head", neck: "Neck", chest: "Chest", abdomen: "Abdomen", pelvis: "Pelvis", back: "Back",
    left_shoulder: "Left shoulder", right_shoulder: "Right shoulder", left_arm: "Left arm", right_arm: "Right arm",
    left_hand: "Left hand", right_hand: "Right hand", left_thigh: "Left thigh", right_thigh: "Right thigh",
    left_knee: "Left knee", right_knee: "Right knee", left_lower_leg: "Left lower leg",
    right_lower_leg: "Right lower leg", left_foot: "Left foot", right_foot: "Right foot"
  };

  function savedReports() {
    try {
      const reports = JSON.parse(localStorage.getItem("bodyScanReports") || "[]");
      return Array.isArray(reports) ? reports.filter((report) => report && report.id && report.token) : [];
    } catch {
      return [];
    }
  }

  async function secureImage(scanId, imageId, token) {
    const response = await fetch(`${api.apiBase}/api/scans/${encodeURIComponent(scanId)}/images/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("An image could not be loaded. Check the report access code.");
    const url = URL.createObjectURL(await response.blob());
    objectUrls.push(url);
    return url;
  }

  async function loadReport(id, token) {
    const report = await api.request(`/api/scans/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const imageUrls = await Promise.all(report.images.map((image) =>
      secureImage(report.id, image.image_id, token).then((url) => ({ ...image, url }))
    ));
    renderReport({ ...report, imageUrls, token });
  }

  async function renderReport(report) {
    const existing = Array.from(list.querySelectorAll("[data-report-id]"))
      .find((card) => card.dataset.reportId === report.id);
    if (existing) existing.remove();
    const emptyState = list.querySelector(".empty-state");
    if (emptyState) emptyState.remove();
    const observations = report.observations.map((item) => observationLabels[item] || item);
    const regions = report.regions.map((item) => regionLabels[item] || item);
    const landmarks = report.images.map((image) => {
      const data = image.landmarks || {};
      if (!data.available) return `${image.view}: landmark processing unavailable`;
      if (!data.detected) return `${image.view}: no pose landmarks detected`;
      const visible = data.landmarks.filter((point) => point.visibility >= 0.5).length;
      return `${image.view}: ${visible} visible pose landmarks`;
    });
    const imagesHtml = report.imageUrls.length
      ? `<div class="report-images">${report.imageUrls.map((image) => `<img src="${image.url}" alt="${api.escape(image.view)} view" loading="lazy">`).join("")}</div>`
      : '<p>No images are stored for this report.</p>';
    const card = document.createElement("article");
    card.className = "report-card";
    card.dataset.reportId = report.id;
    card.innerHTML = `
      <div class="report-card-head"><h2>Visual documentation</h2><span class="report-status">${api.escape(report.status)}</span></div>
      <p>Scan ID: <code>${api.escape(report.id)}</code><br>Submitted: ${api.escape(new Date(report.created_at).toLocaleString())}</p>
      <h3>Images</h3>${imagesHtml}
      <h3>Body map</h3>${api.bodyMapHtml(report.regions)}
      <div class="landmark-summary"><b>Body landmarks (not injury analysis)</b><br>${landmarks.map(api.escape).join("<br>")}<br><br><b>AI injury analysis:</b> unavailable; no validated injury model is configured.</div>
      <p><b>Your selected body areas:</b> ${regions.length ? api.escape(regions.join(", ")) : "None selected"}</p>
      <p><b>Your observations:</b> ${observations.length ? api.escape(observations.join(", ")) : "None selected"}</p>
      ${report.notes ? `<p><b>Your note:</b> ${api.escape(report.notes)}</p>` : ""}
      ${report.doctor_comments ? `<p class="doctor-comment"><b>Clinician comments:</b> ${api.escape(report.doctor_comments)}</p>` : ""}
      <p class="fine-print">A camera image cannot detect or rule out fractures, internal bleeding, or internal organ damage. Do not treat this report as medical clearance or delay care.</p>
      <div class="report-actions"><button class="button button-outline" type="button" data-print>Print / save PDF</button><button class="button button-outline" type="button" data-save>Save access on this device</button><button class="button button-quiet" type="button" data-delete-images>Delete images</button><button class="button button-quiet" type="button" data-forget>Forget access on this device</button></div>`;
    list.prepend(card);
    card.querySelector("[data-print]").addEventListener("click", () => {
      document.querySelectorAll(".report-card").forEach((item) => item.classList.toggle("print-target", item === card));
      window.print();
      document.querySelectorAll(".report-card").forEach((item) => item.classList.remove("print-target"));
    });
    card.querySelector("[data-save]").addEventListener("click", () => {
      try {
        const reports = savedReports().filter((item) => item.id !== report.id);
        reports.unshift({ id: report.id, token: report.token });
        localStorage.setItem("bodyScanReports", JSON.stringify(reports.slice(0, 50)));
        api.setMessage(message, "This report's access code is saved in this browser. Anyone using this device may be able to access it.", "success");
      } catch {
        api.setMessage(message, "Browser storage is unavailable. Keep the report ID and access code somewhere secure.", "error");
      }
    });
    card.querySelector("[data-forget]").addEventListener("click", () => {
      localStorage.setItem("bodyScanReports", JSON.stringify(savedReports().filter((item) => item.id !== report.id)));
      card.remove();
      api.setMessage(message, "Saved access was removed from this device. A copy of the access code may still exist elsewhere.", "info");
    });
    card.querySelector("[data-delete-images]").addEventListener("click", async () => {
      if (!window.confirm("Permanently delete all images for this report from the server? This cannot be undone.")) return;
      try {
        await api.request(`/api/scans/${encodeURIComponent(report.id)}/images`, {
          method: "DELETE", headers: { Authorization: `Bearer ${report.token}` }
        });
        api.setMessage(message, "Images deleted from the server. Report notes and metadata remain.", "success");
        card.remove();
        await loadReport(report.id, report.token);
      } catch (error) {
        api.setMessage(message, error.message, "error");
      }
    });
  }

  document.querySelector("#access-report-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get("scanId") || "").trim();
    const token = String(form.get("accessCode") || "").trim();
    if (!id || !token) {
      api.setMessage(message, "Enter both the scan ID and private access code.", "error");
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Opening report…";
    try {
      await loadReport(id, token);
      api.setMessage(message, "Private report opened. The access code is not saved unless you choose to save it.", "success");
    } catch (error) {
      api.setMessage(message, error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Open report";
    }
  });

  (async function loadSaved() {
    const reports = savedReports();
    if (!reports.length) return;
    const empty = list.querySelector(".empty-state");
    if (empty) empty.remove();
    for (const report of reports) {
      try {
        await loadReport(report.id, report.token);
      } catch (error) {
        api.setMessage(message, `A saved report could not be opened: ${error.message}`, "error");
      }
    }
  })();

  window.addEventListener("pagehide", () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
})();
