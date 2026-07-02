/* Night City map: contact pins, GM markers, panning and zooming.
 * Rendering follows the classic scheme: a fixed-width container centred in
 * the viewport via translate(-50%,-50%), then pan offsets + scale. */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

/** Stable per-owner pin colour so the GM can tell creators apart at a glance. */
export function ownerColor(ownerUserId, isOwn) {
  if (isOwn) return "#2ff5d0";
  let h = 0;
  for (const ch of String(ownerUserId)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 90%, 62%)`;
}

/** Marker glyph choices (like the previous build's pin types). */
export const MARKER_ICONS = [
  "fa-location-dot", "fa-skull", "fa-house", "fa-briefcase",
  "fa-martini-glass", "fa-crosshairs", "fa-triangle-exclamation",
  "fa-star", "fa-heart", "fa-bolt", "fa-car", "fa-user-secret"
];

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const pins = Data.contactsForUser(game.user.id, isGM)
    .filter(c => c.hasPin)
    .map(c => ({
      id: c.id,
      name: c.name,
      address: c.address,
      mapX: c.mapX,
      mapY: c.mapY,
      ownerName: isGM ? c.ownerName : "",
      color: ownerColor(c.ownerUserId, c.ownerUserId === game.user.id)
    }));
  const editMarker = st.editMarker || null;
  const allMarkers = Data.getWorld("mapMarkers") || [];
  return {
    isGM,
    mapImage: game.settings.get(MODULE_ID, "mapImagePath"),
    pins,
    // Players only see revealed markers; the GM sees hidden ones dimmed.
    markers: (isGM ? allMarkers : allMarkers.filter(m => !m.hidden)),
    pinMode: !!st.pinMode,
    editMarker,
    markerIcons: editMarker ? MARKER_ICONS.map(i => ({
      id: i, active: i === (editMarker.icon || "fa-location-dot")
    })) : []
  };
}

function applyTransform(st, container) {
  if (!container) return;
  container.style.transform =
    `translate(-50%, -50%) translate(${st.mapX || 0}px, ${st.mapY || 0}px) scale(${st.mapZoom || 1})`;
}

/** Shared pan/zoom wiring for a map viewport. onClick(pctX, pctY) fires only
 *  for non-drag clicks on the map image itself (not on pins/markers). */
export function wireMapViewport(st, viewport, container, onClick) {
  if (!viewport || !container) return;
  applyTransform(st, container);

  viewport.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    st.mapZoom = Math.min(6, Math.max(0.4, (st.mapZoom || 1) * factor));
    applyTransform(st, container);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest(".agentos-map-pin") || ev.target.closest(".agentos-map-marker")) return;
    ev.preventDefault();
    const startPageX = ev.clientX, startPageY = ev.clientY;
    const baseX = st.mapX || 0, baseY = st.mapY || 0;
    let moved = false;
    const move = (e) => {
      const dx = e.clientX - startPageX, dy = e.clientY - startPageY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      st.mapX = baseX + dx;
      st.mapY = baseY + dy;
      applyTransform(st, container);
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved && onClick) {
        const img = container.querySelector("img");
        if (img && (e.target === img || img.contains(e.target))) {
          const rect = img.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;
          if (x >= 0 && x <= 100 && y >= 0 && y <= 100) onClick(x, y);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

export function activateListeners(app, html) {
  const st = app.state;
  const isGM = game.user.isGM;
  if (st.mapZoom === undefined) { st.mapZoom = 1; st.mapX = 0; st.mapY = 0; }

  const viewport = html.find(".agentos-map-viewport")[0];
  const container = html.find(".agentos-map-container")[0];
  wireMapViewport(st, viewport, container, (x, y) => {
    if (!isGM || !st.pinMode) return;
    st.editMarker = {
      label: "",
      color: "#ffcc00",
      icon: "fa-location-dot",
      hidden: true,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10
    };
    st.pinMode = false;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='map-zoom-in']", () => {
    st.mapZoom = Math.min(6, (st.mapZoom || 1) * 1.3);
    applyTransform(st, container);
  });
  html.on("click", "[data-action='map-zoom-out']", () => {
    st.mapZoom = Math.max(0.4, (st.mapZoom || 1) / 1.3);
    applyTransform(st, container);
  });
  html.on("click", "[data-action='map-reset']", () => {
    st.mapZoom = 1; st.mapX = 0; st.mapY = 0;
    applyTransform(st, container);
  });

  /* ---- GM markers ---- */

  html.on("click", "[data-action='map-pin-mode']", () => {
    st.pinMode = !st.pinMode;
    AgentAudio.play("tap");
    app.render(false);
  });

  /* Double-clicking a contact pin jumps to that contact in the Contacts app. */
  html.on("dblclick", ".agentos-map-pin[data-contact-id]", (ev) => {
    ev.stopPropagation();
    const contactId = ev.currentTarget.dataset.contactId;
    app.currentApp = "contacts";
    app.state = { focusContactId: contactId };
    AgentAudio.play("tap");
    app.render(false);
  });

  /* Clicking an existing marker (GM) opens its editor. */
  html.on("click", ".agentos-map-marker", (ev) => {
    if (!isGM) return;
    ev.stopPropagation();
    const id = ev.currentTarget.dataset.markerId;
    const m = (Data.getWorld("mapMarkers") || []).find(x => x.id === id);
    if (!m) return;
    st.editMarker = foundry.utils.deepClone(m);
    app.render(false);
  });

  html.on("click", "[data-action='marker-cancel']", () => {
    st.editMarker = null;
    app.render(false);
  });

  html.on("input", "[name='marker-label'], [name='marker-color']", () => {
    if (!st.editMarker) return;
    st.editMarker.label = String(html.find("[name='marker-label']").val() ?? st.editMarker.label);
    st.editMarker.color = String(html.find("[name='marker-color']").val() ?? st.editMarker.color);
  });

  html.on("click", "[data-action='marker-icon']", (ev) => {
    if (!st.editMarker) return;
    st.editMarker.label = String(html.find("[name='marker-label']").val() ?? st.editMarker.label);
    st.editMarker.color = String(html.find("[name='marker-color']").val() ?? st.editMarker.color);
    st.editMarker.icon = ev.currentTarget.dataset.icon;
    app.render(false);
  });

  html.on("click", "[data-action='marker-save']", (ev) => {
    ev.preventDefault();
    if (!st.editMarker) return;
    const marker = {
      ...st.editMarker,
      label: String(html.find("[name='marker-label']").val() || "").trim(),
      color: String(html.find("[name='marker-color']").val() || "#ffcc00"),
      hidden: !html.find("[name='marker-visible']").prop("checked")
    };
    if (!marker.label) return AgentAudio.play("error");
    st.editMarker = null;
    AgentAudio.play("tap");
    app.render(false);
    app.mutate("marker.save", { marker });
  });

  html.on("click", "[data-action='marker-delete']", async (ev) => {
    ev.preventDefault();
    const markerId = st.editMarker?.id;
    if (!markerId) { st.editMarker = null; return app.render(false); }
    if (!(await app.confirm(loc("AGENTOS.Map.DeleteMarker")))) return;
    st.editMarker = null;
    app.render(false);
    app.mutate("marker.delete", { markerId });
  });
}
