/* Garden: the GM's NPC contact roster. Players see contacts the GM has
 * revealed and can jump into a chat with them from the profile. */

import { loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const contacts = Data.visibleGardenContacts(isGM)
    .slice().sort((a, b) => a.name.localeCompare(b.name));

  if (st.gardenId) {
    const contact = contacts.find(c => c.id === st.gardenId);
    if (!contact) { app.state = {}; return getData(app); }
    return {
      viewing: true,
      isGM,
      contact,
      canChat: isGM || !!game.user.character
    };
  }

  /* Group into collapsible folders; contacts without a folder go first. */
  const noFolder = loc("AGENTOS.Garden.NoFolder");
  const byFolder = new Map();
  for (const c of contacts) {
    const key = (c.folder || "").trim() || noFolder;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(c);
  }
  const collapsed = st.collapsed || {};
  const groups = [...byFolder.entries()]
    .sort((a, b) => (a[0] === noFolder ? -1 : b[0] === noFolder ? 1 : a[0].localeCompare(b[0])))
    .map(([name, items]) => ({
      name,
      raw: name === noFolder ? "" : name,   // actual stored folder value
      collapsed: !!collapsed[name],
      count: items.length,
      contacts: items
    }));

  return {
    viewing: false,
    isGM,
    hasContacts: contacts.length > 0,
    groups,
    folders: [...new Set(contacts.map(c => (c.folder || "").trim()).filter(Boolean))].sort(),
    editing: st.editing || null
  };
}

function readDraft(html, st) {
  const d = st.editing || {};
  d.name = String(html.find("[name='garden-name']").val() ?? d.name ?? "");
  d.note = String(html.find("[name='garden-note']").val() ?? d.note ?? "");
  d.folder = String(html.find("[name='garden-folder']").val() ?? d.folder ?? "");
  return d;
}

export function activateListeners(app, html) {
  const st = app.state;

  html.on("click", "[data-action='garden-open']", (ev) => {
    app.state = { gardenId: ev.currentTarget.dataset.gardenId };
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='garden-back']", () => {
    app.state = {};
    app.render(false);
  });

  /* Open (or create) a 1:1 chat with this contact. */
  html.on("click", "[data-action='garden-chat']", async (ev) => {
    const gardenId = ev.currentTarget.dataset.gardenId;
    const gardenKey = `garden:${gardenId}`;
    const myKey = Data.participantKeyForUser(game.user.id);
    const chats = game.user.isGM ? Data.allChats() : Data.chatsForUser(game.user.id);
    const existing = chats.find(c =>
      c.participants.length === 2 &&
      c.participants.some(p => p.key === gardenKey) &&
      (game.user.isGM || c.participants.some(p => p.key === myKey))
    );
    if (existing) {
      app.openChatThread(existing.id);
      app.render(false);
      return;
    }
    const keys = game.user.isGM ? [gardenKey] : [myKey, gardenKey];
    const result = await app.mutate("chat.create", { participantKeys: keys, name: "" });
    if (typeof result === "string") {
      // The chat id arrives via the GM's socket reply; the thread opens as
      // soon as the settings sync lands (chat.js keeps chatId until then).
      app.openChatThread(result);
    } else {
      app.openApp("chat");
      return;
    }
    app.render(false);
  });

  /* ---- GM management ---- */

  html.on("click", "[data-action='garden-folder-toggle']", (ev) => {
    const name = ev.currentTarget.dataset.folder;
    st.collapsed = st.collapsed || {};
    st.collapsed[name] = !st.collapsed[name];
    app.render(false);
  });

  html.on("click", "[data-action='garden-new']", () => {
    st.editing = { name: "", img: "", note: "", folder: "", actorUuid: "" };
    app.render(false);
  });

  /* "+" on a folder header: new contact with that folder preset. */
  html.on("click", "[data-action='garden-folder-add']", (ev) => {
    ev.stopPropagation();
    st.editing = { name: "", img: "", note: "", folder: ev.currentTarget.dataset.folderRaw || "", actorUuid: "" };
    app.render(false);
  });

  html.on("click", "[data-action='garden-folder-rename']", async (ev) => {
    ev.stopPropagation();
    const from = ev.currentTarget.dataset.folderRaw || "";
    const current = ev.currentTarget.dataset.folderName || "";
    const to = await app.promptText(loc("AGENTOS.Garden.RenameFolder"), from || current);
    if (to === null || to.trim() === from) return;
    await app.mutate("garden.renameFolder", { from, to: to.trim() });
  });

  html.on("click", "[data-action='garden-edit']", (ev) => {
    ev.stopPropagation();
    const c = Data.visibleGardenContacts(true).find(x => x.id === ev.currentTarget.dataset.gardenId);
    if (!c) return;
    st.editing = foundry.utils.deepClone(c);
    app.render(false);
  });

  /* Keep the draft synced on every keystroke so background re-renders
   * never wipe typed text. */
  html.on("input", ".agentos-garden-form input, .agentos-garden-form textarea", () => {
    st.editing = readDraft(html, st);
  });

  html.on("click", "[data-action='garden-cancel']", () => {
    st.editing = null;
    app.render(false);
  });

  html.on("click", "[data-action='garden-img']", async () => {
    st.editing = readDraft(html, st);
    const path = await app.pickFile("image");
    if (path) st.editing.img = path;
    app.render(false);
  });

  html.on("click", "[data-action='garden-save']", (ev) => {
    ev.preventDefault();
    const draft = readDraft(html, st);
    if (!draft.name.trim()) return AgentAudio.play("error");
    st.editing = null;
    AgentAudio.play("tap");
    app.render(false);                      // optimistic: close the form now
    app.mutate("garden.save", { contact: draft });
  });

  html.on("click", "[data-action='garden-toggle-visible']", async (ev) => {
    ev.stopPropagation();
    await app.mutate("garden.toggleVisible", { gardenId: ev.currentTarget.dataset.gardenId });
  });

  html.on("click", "[data-action='garden-delete']", async (ev) => {
    ev.stopPropagation();
    if (!(await app.confirm(loc("AGENTOS.Garden.DeleteConfirm")))) return;
    await app.mutate("garden.delete", { gardenId: ev.currentTarget.dataset.gardenId });
  });

  /* Actor drag & drop prefills the edit form. */
  const dropzone = html.find(".agentos-garden-drop")[0];
  if (dropzone) {
    dropzone.addEventListener("dragover", (ev) => { ev.preventDefault(); dropzone.classList.add("over"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
    dropzone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      dropzone.classList.remove("over");
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "Actor") return;
        const actor = await fromUuid(data.uuid);
        if (!actor) return;
        st.editing = readDraft(html, st);
        st.editing.name = st.editing.name || actor.name;
        st.editing.img = actor.img || st.editing.img;
        st.editing.actorUuid = actor.uuid;
        AgentAudio.play("tap");
        app.render(false);
      } catch (e) { /* not an actor drop */ }
    });
  }
}
