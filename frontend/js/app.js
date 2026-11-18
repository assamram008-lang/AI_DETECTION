(function () {
  const apiBase = (window.AI_BODY_SCAN_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
  window.BodyScan = {
    apiBase,
    bodyMapHtml(regions) {
      const positions = {
        head: [50, 11], neck: [50, 22], chest: [50, 33], abdomen: [50, 45], pelvis: [50, 56], back: [50, 40],
        left_shoulder: [35, 29], right_shoulder: [65, 29], left_arm: [28, 43], right_arm: [72, 43],
        left_hand: [21, 60], right_hand: [79, 60], left_thigh: [42, 68], right_thigh: [58, 68],
        left_knee: [42, 79], right_knee: [58, 79], left_lower_leg: [43, 89], right_lower_leg: [57, 89],
        left_foot: [40, 97], right_foot: [60, 97]
      };
      const selected = new Set(regions);
      function figure(view) {
        const frontOnly = new Set(["chest", "abdomen", "pelvis"]);
        const points = Object.keys(positions).filter((region) => (
          view === "back" ? !frontOnly.has(region) : region !== "back"
        ));
        return `<div class="report-map-figure"><span>${view === "front" ? "Front" : "Back"}</span><svg viewBox="0 0 180 360" role="img" aria-label="${view} body map; selected regions shown in cyan"><circle cx="90" cy="35" r="23"/><path d="M72 65Q90 57 108 65L125 80 144 150 131 155 116 111 120 186 112 202 121 278 108 284 90 220 72 284 59 278 68 202 60 186 64 111 49 155 36 150 55 80Z"/>${points.map((region) => {
          const point = positions[region];
          return `<circle class="${selected.has(region) ? "map-point selected" : "map-point"}" cx="${point[0] * 1.8}" cy="${point[1] * 3.6}" r="4"/>`;
        }).join("")}</svg></div>`;
      }
      const labels = {
        head: "Head", neck: "Neck", chest: "Chest", abdomen: "Abdomen", pelvis: "Pelvis", back: "Back",
        left_shoulder: "Left shoulder", right_shoulder: "Right shoulder", left_arm: "Left arm",
        right_arm: "Right arm", left_hand: "Left hand", right_hand: "Right hand",
        left_thigh: "Left thigh", right_thigh: "Right thigh", left_knee: "Left knee",
        right_knee: "Right knee", left_lower_leg: "Left lower leg", right_lower_leg: "Right lower leg",
        left_foot: "Left foot", right_foot: "Right foot"
      };
      const tags = Array.from(selected).filter((region) => labels[region])
        .map((region) => `<span>${labels[region]}</span>`).join("");
      return `<div class="report-bodymap">${figure("front")}${figure("back")}<div class="report-map-legend"><b>Patient-selected areas:</b>${tags || "<span>None selected</span>"}</div></div>`;
    },
    async request(path, options) {
      let response;
      try {
        response = await fetch(apiBase + path, options);
      } catch (error) {
        throw new Error("Could not reach the API. Check that the backend is running and the API URL is correct.");
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail || `The request failed (${response.status}).`);
      }
      return body;
    },
    escape(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[character]);
    },
    setMessage(element, message, kind) {
      if (!element) return;
      element.textContent = message;
      element.className = `notice ${kind || "info"}`;
      element.hidden = false;
    },
    clearMessage(element) {
      if (element) element.hidden = true;
    }
  };

  document.querySelectorAll("[data-year]").forEach((element) => {
    element.textContent = new Date().getFullYear();
  });
  document.querySelectorAll(".nav-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const nav = document.getElementById(button.getAttribute("aria-controls"));
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      if (nav) nav.classList.toggle("is-open", !expanded);
    });
  });
})();
