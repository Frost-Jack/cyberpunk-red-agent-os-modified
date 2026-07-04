/* Contact book: personal contacts with optional map pins and sharing.
 * Contacts are grouped into folders by creator (GM sees everyone's). */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";
import { wireMapViewport, ownerColor } from "./map.js";

/** Folder display name — the auto "from map" folder stores an i18n key. */
function folderName(folder) {
  const n = folder?.name || "";
  return n.startsWith("AGENTOS.") ? loc(n) : n;
}

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
      color: c.color || ownerColor(c.ownerUserId, c.ownerUserId === game.user.id)
    }));

  /* Top level = owner folders (Mine / players / GM). Inside each owner, a
   * nested folder tree from contactFolders + contacts filed into them. */
  const allFolders = Data.getWorld("contactFolders") || [];
  const collapsed = st.collapsed || {};
  const focusId = st.focusContactId || null;

  const byOwner = new Map();
  for (const c of list) {
    if (!byOwner.has(c.ownerUserId)) byOwner.set(c.ownerUserId, []);
    byOwner.get(c.ownerUserId).push(c);
  }

  const contactNode = (c) => ({ ...c, focused: c.id === focusId });

  // Recursively build a folder and its subtree for one owner. Returns null when
  // it should be hidden: a player never sees a folder that holds no contact
  // visible to them (own or shared) — only the GM (and the folder's owner for
  // their own tree) keeps empty folders as organisation.
  const buildFolder = (folder, ownerFolders, ownerContacts, isOwn) => {
    const subfolders = ownerFolders
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => folderName(a).localeCompare(folderName(b)))
      .map(f => buildFolder(f, ownerFolders, ownerContacts, isOwn))
      .filter(Boolean);
    const contacts = ownerContacts.filter(c => (c.folderId || null) === folder.id).map(contactNode);
    // Hide empty folders from other players' shared trees (keep own + GM view).
    if (!isGM && !isOwn && contacts.length === 0 && subfolders.length === 0) return null;
    const descHasFocus = subfolders.some(s => s.hasFocus) || contacts.some(c => c.focused);
    return {
      id: folder.id,
      name: folderName(folder),
      isMapFolder: folder.system === "map",
      canEdit: isOwn || isGM,
      collapsed: descHasFocus ? false : !!collapsed[folder.id],
      subfolders,
      contacts,
      count: contacts.length + subfolders.reduce((n, s) => n + s.count, 0),
      hasFocus: descHasFocus
    };
  };

  const groups = [...byOwner.entries()].map(([ownerId, contacts]) => {
    const owner = game.users.get(ownerId);
    const isOwn = ownerId === game.user.id;
    const ownerFolders = allFolders.filter(f => f.ownerUserId === ownerId);
    const rootFolders = ownerFolders
      .filter(f => !f.parentId)
      .sort((a, b) => folderName(a).localeCompare(folderName(b)))
      .map(f => buildFolder(f, ownerFolders, contacts, isOwn))
      .filter(Boolean);
    const rootContacts = contacts.filter(c => !c.folderId).map(contactNode);
    const hasFocus = rootFolders.some(f => f.hasFocus) || rootContacts.some(c => c.focused);
    return {
      ownerId,
      ownerName: isOwn ? loc("AGENTOS.Contacts.MyFolder") : (owner?.name || contacts[0]?.ownerName || "?"),
      isGmOwner: owner?.isGM ?? false,
      isOwn,
      canEdit: isOwn || isGM,
      collapsed: hasFocus ? false : !!collapsed[ownerId],
      count: contacts.length,
      folders: rootFolders,
      contacts: rootContacts
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

  /* ---- nested folders ---- */

  html.on("click", "[data-action='folder-toggle']", (ev) => {
    ev.stopPropagation();
    const id = ev.currentTarget.dataset.folderId;
    st.collapsed = st.collapsed || {};
    st.collapsed[id] = !st.collapsed[id];
    app.render(false);
  });

  html.on("click", "[data-action='folder-new']", async (ev) => {
    ev.stopPropagation();
    const parentId = ev.currentTarget.dataset.parentId || null;
    const name = await app.promptText(loc("AGENTOS.Contacts.NewFolder"), "", loc("AGENTOS.Contacts.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    if (parentId) { st.collapsed = st.collapsed || {}; st.collapsed[parentId] = false; }
    await app.mutate("folder.create", { name: name.trim(), parentId });
    app.render(false);
  });

  html.on("click", "[data-action='folder-rename']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    const cur = (Data.getWorld("contactFolders") || []).find(f => f.id === folderId);
    const name = await app.promptText(loc("AGENTOS.Contacts.RenameFolder"), cur?.name || "", loc("AGENTOS.Contacts.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    await app.mutate("folder.rename", { folderId, name: name.trim() });
    app.render(false);
  });

  html.on("click", "[data-action='folder-delete']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    if (!(await app.confirm(loc("AGENTOS.Contacts.DeleteFolderConfirm")))) return;
    AgentAudio.play("tap");
    await app.mutate("folder.delete", { folderId });
    app.render(false);
  });

  /* Drag a contact or a folder onto a folder header (or an owner root) to file
   * it there. */
  html.on("dragstart", "[data-contact-drag], [data-folder-drag]", (ev) => {
    const el = ev.currentTarget;
    ev.stopPropagation();
    const payload = el.dataset.contactDrag
      ? { contact: el.dataset.contactDrag }
      : { folder: el.dataset.folderDrag };
    ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(payload));
    ev.originalEvent.dataTransfer.effectAllowed = "move";
  });

  const dropTargets = html.find("[data-folder-drop]");
  dropTargets.on("dragover", (ev) => { ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.classList.add("drop-over"); });
  dropTargets.on("dragleave", (ev) => ev.currentTarget.classList.remove("drop-over"));
  dropTargets.on("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.remove("drop-over");
    let data;
    try { data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain")); }
    catch (e) { return; }
    const targetFolderId = ev.currentTarget.dataset.folderDrop || null;   // "" = owner root
    AgentAudio.play("tap");
    if (data.contact) {
      await app.mutate("contact.move", { contactId: data.contact, folderId: targetFolderId });
    } else if (data.folder && data.folder !== targetFolderId) {
      await app.mutate("folder.move", { folderId: data.folder, parentId: targetFolderId });
    }
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
    const contactId = ev.currentTarget.dataset.contactId;
    st.sharing = contactId;
    // Pre-select who it's already shared with, so unchecking removes them.
    const c = Data.contactsForUser(game.user.id, game.user.isGM).find(x => x.id === contactId);
    st.shareTo = [...(c?.sharedWith || [])];
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
    const userIds = st.shareTo || [];   // exact set — empty means "shared with nobody"
    st.sharing = null;
    st.shareTo = [];
    AgentAudio.play("tap");
    app.render(false);
    app.mutate("contact.share", { contactId, userIds });
  });
}
