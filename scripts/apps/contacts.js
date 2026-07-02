/* Contact book: personal contacts with optional map pins and sharing.
 * Contacts are grouped into folders by creator (GM sees everyone's). */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";
import { wireMapViewport, ownerColor } from "./map.js";

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const list = Data.contactsForUser(game.user.id, isGM)
    .slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(c => ({
      ...c,
      isOwn: c.ownerUserId === game.user.id,
      canEdit: isGM || c.ownerUserId === game.user.id,
      sharedCount: (c.sharedWith || []).length,
      color: ownerColor(c.ownerUserId, c.ownerUserId === game.user.id)
    }));

  /* Group by creator: own folder first, then the rest alphabetically. */
  const byOwner = new Map();
  for (const c of list) {
    if (!byOwner.has(c.ownerUserId)) byOwner.set(c.ownerUserId, []);
    byOwner.get(c.ownerUserId).push(c);
  }
  const collapsed = st.collapsed || {};
  const focusId = st.focusContactId || null;
  const groups = [...byOwner.entries()].map(([ownerId, contacts]) => {
    const owner = game.users.get(ownerId);
    const hasFocus = focusId ? contacts.some(c => c.id === focusId) : false;
    if (hasFocus) contacts = contacts.map(c => ({ ...c, focused: c.id === focusId }));
    return {
      ownerId,
      ownerName: ownerId === game.user.id
        ? loc("AGENTOS.Contacts.MyFolder")
        : (owner?.name || contacts[0]?.ownerName || "?"),
      isGmOwner: owner?.isGM ?? false,
      isOwn: ownerId === game.user.id,
      collapsed: hasFocus ? false : !!collapsed[ownerId],   // auto-expand the focused folder
      count: contacts.length,
      contacts
    };
  }).sort((a, b) => (b.isOwn - a.isOwn) || a.ownerName.localeCompare(b.ownerName));

  /* While picking a spot, show the existing contact pins and revealed
   * GM markers for orientation (the edited contact's own pin is drawn
   * separately as the draggable "current" pin). */
  const allMarkers = Data.getWorld("mapMarkers") || [];
  const pickPins = st.picking ? list
    .filter(c => c.hasPin && c.id !== st.editing?.id)
    .map(c => ({ name: c.name, mapX: c.mapX, mapY: c.mapY, color: c.color })) : [];
  const pickMarkers = st.picking
    ? (isGM ? allMarkers : allMarkers.filter(m => !m.hidden))
    : [];

  return {
    isGM,
    groups,
    hasContacts: list.length > 0,
    editing: st.editing || null,
    picking: !!st.picking,
    pickPins,
    pickMarkers,
    mapImage: game.settings.get(MODULE_ID, "mapImagePath"),
    sharing: st.sharing ? {
      contactId: st.sharing,
      users: game.users.filter(u => !u.isGM && u.id !== game.user.id).map(u => ({
        id: u.id, name: u.name, online: u.active,
        selected: (st.shareTo || []).includes(u.id)
      }))
    } : null
  };
}

function readDraft(html, st) {
  const d = st.editing || {};
  const get = (sel) => { const v = html.find(sel).val(); return v === undefined ? undefined : String(v); };
  d.name = get("[name='contact-name']") ?? d.name ?? "";
  d.note = get("[name='contact-note']") ?? d.note ?? "";
  d.address = get("[name='contact-address']") ?? d.address ?? "";
  return d;
}

export function activateListeners(app, html) {
  const st = app.state;

  /* Arrived via a map-pin double-click: scroll the contact into view. */
  if (st.focusContactId) {
    const row = html.find(".agentos-list-row.focused")[0];
    if (row) row.scrollIntoView({ block: "center" });
    delete st.focusContactId;
  }

  html.on("click", "[data-action='contact-folder-toggle']", (ev) => {
    const ownerId = ev.currentTarget.dataset.ownerId;
    st.collapsed = st.collapsed || {};
    st.collapsed[ownerId] = !st.collapsed[ownerId];
    app.render(false);
  });

  html.on("click", "[data-action='contact-new']", () => {
    st.editing = { name: "", note: "", address: "", hasPin: false, mapX: 50, mapY: 50 };
    app.render(false);
  });

  html.on("click", "[data-action='contact-edit']", (ev) => {
    const id = ev.currentTarget.dataset.contactId;
    const c = Data.contactsForUser(game.user.id, game.user.isGM).find(x => x.id === id);
    if (!c) return;
    st.editing = foundry.utils.deepClone(c);
    app.render(false);
  });

  /* Keep the draft in sync on every keystroke so a background re-render
   * (any world-data change) never wipes what the user typed. */
  html.on("input", ".agentos-contact-form input, .agentos-contact-form textarea", () => {
    st.editing = readDraft(html, st);
  });

  html.on("click", "[data-action='contact-cancel']", () => {
    st.editing = null;
    st.picking = false;
    app.render(false);
  });

  html.on("click", "[data-action='contact-save']", (ev) => {
    ev.preventDefault();
    const draft = readDraft(html, st);
    if (!draft.name.trim()) return AgentAudio.play("error");
    st.editing = null;
    st.picking = false;
    AgentAudio.play("tap");
    app.render(false);                      // optimistic: close the form now
    app.mutate("contact.save", { contact: draft });
  });

  html.on("click", "[data-action='contact-delete']", async (ev) => {
    ev.stopPropagation();
    const contactId = ev.currentTarget.dataset.contactId;
    if (!(await app.confirm(loc("AGENTOS.Contacts.DeleteConfirm")))) return;
    app.mutate("contact.delete", { contactId });
  });

  /* ---- map pin picking (full pan & zoom like the Map app) ---- */

  html.on("click", "[data-action='contact-pick-pin']", () => {
    st.editing = readDraft(html, st);
    st.picking = true;
    st.pick = { mapZoom: 1, mapX: 0, mapY: 0 };
    app.render(false);
  });

  html.on("click", "[data-action='contact-pin-clear']", () => {
    st.editing = readDraft(html, st);
    st.editing.hasPin = false;
    app.render(false);
  });

  html.on("click", "[data-action='contact-pick-cancel']", () => {
    st.picking = false;
    app.render(false);
  });

  if (st.picking) {
    st.pick = st.pick || { mapZoom: 1, mapX: 0, mapY: 0 };
    const viewport = html.find(".agentos-pickmap .agentos-map-viewport")[0];
    const container = html.find(".agentos-pickmap .agentos-map-container")[0];
    wireMapViewport(st.pick, viewport, container, (x, y) => {
      st.editing = st.editing || {};
      st.editing.mapX = Math.round(x * 10) / 10;
      st.editing.mapY = Math.round(y * 10) / 10;
      st.editing.hasPin = true;
      st.picking = false;
      AgentAudio.play("tap");
      app.render(false);
    });
    html.on("click", "[data-action='pick-zoom-in']", () => {
      st.pick.mapZoom = Math.min(6, st.pick.mapZoom * 1.3);
      container.style.transform = `translate(-50%, -50%) translate(${st.pick.mapX}px, ${st.pick.mapY}px) scale(${st.pick.mapZoom})`;
    });
    html.on("click", "[data-action='pick-zoom-out']", () => {
      st.pick.mapZoom = Math.max(0.4, st.pick.mapZoom / 1.3);
      container.style.transform = `translate(-50%, -50%) translate(${st.pick.mapX}px, ${st.pick.mapY}px) scale(${st.pick.mapZoom})`;
    });
  }

  /* ---- sharing ---- */

  html.on("click", "[data-action='contact-share-open']", (ev) => {
    ev.stopPropagation();
    st.sharing = ev.currentTarget.dataset.contactId;
    st.shareTo = [];
    app.render(false);
  });

  html.on("click", "[data-action='contact-share-cancel']", () => {
    st.sharing = null;
    app.render(false);
  });

  html.on("click", "[data-action='contact-share-toggle']", (ev) => {
    const id = ev.currentTarget.dataset.userId;
    st.shareTo = st.shareTo || [];
    if (st.shareTo.includes(id)) st.shareTo = st.shareTo.filter(x => x !== id);
    else st.shareTo.push(id);
    app.render(false);
  });

  html.on("click", "[data-action='contact-share']", (ev) => {
    ev.preventDefault();
    const contactId = st.sharing;
    const userIds = st.shareTo || [];
    if (!userIds.length) return AgentAudio.play("error");
    st.sharing = null;
    st.shareTo = [];
    AgentAudio.play("tap");
    app.render(false);
    app.mutate("contact.share", { contactId, userIds });
  });
}
