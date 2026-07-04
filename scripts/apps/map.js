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

/**
 * Pointer position inside `el`'s content box as fractions 0..1, robust to the
 * chassis CSS `zoom`.
 *
 * In this Chromium build, `zoom` scales getBoundingClientRect() but NOT
 * event.clientX/Y, so `(clientX - rect.left) / rect.width` mixes two spaces and
 * lands the cursor "right and low". `offsetWidth/Height` are always unzoomed
 * layout px, so `z = rect.width / offsetWidth` recovers the baked-in zoom; we
 * divide the rect back into layout space (where clientX/Y already live). When a
 * future build stops scaling the rect, z ≈ 1 and this reduces to the plain
 * ratio, so it is correct either way.
 */
export function pointerFraction(ev, el) {
  const rect = el.getBoundingClientRect();
  const ow = el.offsetWidth || rect.width;
  const oh = el.offsetHeight || rect.height;
  const zx = rect.width / ow || 1;
  const zy = rect.height / oh || 1;
  return {
    fx: (ev.clientX - rect.left / zx) / ow,
    fy: (ev.clientY - rect.top / zy) / oh
  };
}

/** Zoom toward an anchor point so it stays fixed under the pointer (like
 *  Google Maps). The container is centred in the viewport, then panned by
 *  (mapX, mapY) and scaled about its centre. Anchor (ax, ay) is measured from
 *  the viewport centre; keeping the world point under it invariant means
 *  new pan = anchor - (anchor - pan) * (newZoom / oldZoom). Passing (0, 0)
 *  anchors on the centre (used by the +/- buttons). */
function zoomAt(st, container, factor, ax = 0, ay = 0) {
  const z = st.mapZoom || 1;
  const nz = Math.min(6, Math.max(0.4, z * factor));
  if (nz === z) return;
  const ratio = nz / z;
  st.mapX = ax - (ax - (st.mapX || 0)) * ratio;
  st.mapY = ay - (ay - (st.mapY || 0)) * ratio;
  st.mapZoom = nz;
  applyTransform(st, container);
}

/** Shared pan/zoom wiring for a map viewport. onClick(pctX, pctY) fires only
 *  for non-drag clicks on the map image itself (not on pins/markers). */
export function wireMapViewport(st, viewport, container, onClick) {
  if (!viewport || !container) return;
  applyTransform(st, container);

  viewport.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    // Anchor the zoom on the cursor: offset of the pointer from the viewport
    // centre (the container's centred origin), so that spot stays put. clientX/Y
    // are in unzoomed layout px; the rect is zoom-scaled, so convert the rect
    // centre back to layout px before taking the offset.
    const rect = viewport.getBoundingClientRect();
    const sx = viewport.offsetWidth ? rect.width / viewport.offsetWidth : 1;
    const sy = viewport.offsetHeight ? rect.height / viewport.offsetHeight : 1;
    const ax = ev.clientX - (rect.left + rect.width / 2) / (sx || 1);
    const ay = ev.clientY - (rect.top + rect.height / 2) / (sy || 1);
    zoomAt(st, container, factor, ax, ay);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest(".agentos-map-pin") || ev.target.closest(".agentos-map-marker")) return;
    ev.preventDefault();
    const startPageX = ev.clientX, startPageY = ev.clientY;
    const baseX = st.mapX || 0, baseY = st.mapY || 0;
    // clientX/Y are unzoomed layout px, and the container's translate is in that
    // same local space, so the drag delta maps 1:1 — no scale conversion needed.
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
          const { fx, fy } = pointerFraction(e, img);
          const x = fx * 100, y = fy * 100;
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

  html.on("click", "[data-action='map-zoom-in']", () => zoomAt(st, container, 1.3));
  html.on("click", "[data-action='map-zoom-out']", () => zoomAt(st, container, 1 / 1.3));
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
