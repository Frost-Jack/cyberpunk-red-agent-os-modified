/* Tools — "Дэймоны" (daemons): a launcher for macros, backed by real Foundry
 * Macro documents.
 *
 * World setting `toolMacros` = [{ uuid, visible, ownerUserId }]:
 *   - GM entries (ownerUserId "") — visible to players when `visible`.
 *   - Player entries (ownerUserId = that user) — that player's own daemons,
 *     always visible to them; the GM sees them grouped in per-player folders.
 *
 * GM: create/edit/delete/toggle-visibility, import/export, and every player's
 * daemons in folders. Players: the GM's revealed daemons + their own, plus
 * they can drag a macro in to add their own.
 */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

const OWNERSHIP = CONST.DOCUMENT_OWNERSHIP_LEVELS;

/* ------------------------------------------------------------------ */
/* getData                                                            */
/* ------------------------------------------------------------------ */

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const list = Data.getWorld("toolMacros") || [];

  const resolve = async (e) => {
    const macro = await fromUuid(e.uuid).catch(() => null);
    if (!macro) return null;
    return {
      uuid: e.uuid,
      name: macro.name,
      img: macro.img || "icons/svg/dice-target.svg",
      visible: !!e.visible,
      ownerUserId: e.ownerUserId || ""
    };
  };

  const mine = [];      // current user's own daemons
  const gmShared = [];  // GM daemons (players see the revealed ones)
  const byPlayer = new Map();

  for (const e of list) {
    const owner = e.ownerUserId || "";
    const entry = await resolve(e);
    if (!entry) continue;

    if (owner === "") {
      // GM-owned: GM manages it; players just run revealed ones
      if (isGM) gmShared.push({ ...entry, own: true, showVisible: true });
      else if (entry.visible) gmShared.push({ ...entry, own: false });
    } else if (owner === game.user.id) {
      mine.push({ ...entry, own: true });
    } else if (isGM) {
      if (!byPlayer.has(owner)) byPlayer.set(owner, []);
      byPlayer.get(owner).push({ ...entry, own: true });   // GM can manage players' too
    }
  }

  const collapsed = st.collapsed || {};
  const playerFolders = [...byPlayer.entries()].map(([uid, items]) => ({
    id: uid,
    name: game.users.get(uid)?.name || "?",
    collapsed: !!collapsed[uid],
    count: items.length,
    macros: items
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    isGM,
    gmShared,
    hasGmShared: gmShared.length > 0,
    mine,
    hasMine: mine.length > 0,
    playerFolders,
    empty: !gmShared.length && !mine.length && !playerFolders.length
  };
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function macroList() {
  return foundry.utils.deepClone(Data.getWorld("toolMacros") || []);
}

async function applyOwnership(macro, visible) {
  const level = visible ? OWNERSHIP.OBSERVER : OWNERSHIP.NONE;
  if ((macro.ownership?.default ?? OWNERSHIP.NONE) === level) return;
  try { await macro.update({ "ownership.default": level }); } catch (e) { /* noop */ }
}

/* ------------------------------------------------------------------ */
/* listeners                                                          */
/* ------------------------------------------------------------------ */

export function activateListeners(app, html) {
  const isGM = game.user.isGM;
  const st = app.state;

  html.on("click", "[data-action='tool-run']", async (ev) => {
    const macro = await fromUuid(ev.currentTarget.dataset.uuid).catch(() => null);
    if (!macro) return AgentAudio.play("error");
    AgentAudio.play("tap");
    try { macro.execute(); } catch (e) { console.warn(`${MODULE_ID} | daemon failed`, e); }
  });

  html.on("click", "[data-action='tool-folder-toggle']", (ev) => {
    const id = ev.currentTarget.dataset.folderId;
    st.collapsed = st.collapsed || {};
    st.collapsed[id] = !st.collapsed[id];
    app.render(false);
  });

  /* Add an existing macro by dropping it into the app (GM & players). */
  const dropzone = html.find(".agentos-tools")[0];
  if (dropzone) {
    dropzone.addEventListener("dragover", (ev) => {
      if (ev.dataTransfer?.types?.includes("text/plain")) { ev.preventDefault(); dropzone.classList.add("drop-over"); }
    });
    dropzone.addEventListener("dragleave", (ev) => { if (ev.target === dropzone) dropzone.classList.remove("drop-over"); });
    dropzone.addEventListener("drop", async (ev) => {
      dropzone.classList.remove("drop-over");
      let data;
      try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (e) { return; }
      if (data?.type !== "Macro") return;
      ev.preventDefault();
      ev.stopPropagation();
      const uuid = data.uuid || (data.pack ? null : `Macro.${data.id}`);
      if (!uuid) return;
      const macro = await fromUuid(uuid).catch(() => null);
      if (!macro) return AgentAudio.play("error");
      const list = macroList();
      if (list.some(e => e.uuid === macro.uuid)) return AgentAudio.play("error");   // already listed
      const owner = isGM ? "" : game.user.id;
      const visible = isGM ? false : true;   // players' own daemons are theirs
      if (isGM) await applyOwnership(macro, false);
      list.push({ uuid: macro.uuid, visible, ownerUserId: owner });
      AgentAudio.play("tap");
      await app.mutate("tools.setList", { list });
      app.render(false);
    });
  }

  /* ---- player: create / edit / delete their OWN daemons ---- */

  const ownsEntry = (uuid) => {
    const e = macroList().find(x => x.uuid === uuid);
    return e && (isGM || e.ownerUserId === game.user.id);
  };

  html.on("click", "[data-action='tool-create']", async (ev) => {
    const asPlayer = !isGM;
    const name = await app.promptText(loc("AGENTOS.Tools.NewName"), "");
    if (name === null || !name.trim()) return;
    const macro = await Macro.create({
      name: name.trim(),
      type: "script",
      scope: "global",
      command: "\n",
      img: "icons/svg/dice-target.svg",
      "ownership.default": OWNERSHIP.NONE
    });
    if (!macro) return AgentAudio.play("error");
    const list = macroList();
    list.push({ uuid: macro.uuid, visible: false, ownerUserId: asPlayer ? game.user.id : "" });
    await app.mutate("tools.setList", { list });
    app.render(false);                        // guarantee the new card shows
    AgentAudio.play("tap");
    macro.sheet?.render(true);
  });

  html.on("click", "[data-action='tool-edit']", async (ev) => {
    if (!ownsEntry(ev.currentTarget.dataset.uuid)) return;
    const macro = await fromUuid(ev.currentTarget.dataset.uuid).catch(() => null);
    if (macro) macro.sheet?.render(true);
  });

  html.on("click", "[data-action='tool-delete']", async (ev) => {
    const uuid = ev.currentTarget.dataset.uuid;
    if (!ownsEntry(uuid)) return;
    if (!(await app.confirm(loc("AGENTOS.Tools.DeleteConfirm")))) return;
    const macro = await fromUuid(uuid).catch(() => null);
    try { await macro?.delete(); } catch (e) { /* noop */ }
    await app.mutate("tools.setList", { list: macroList().filter(e => e.uuid !== uuid) });
    app.render(false);
    AgentAudio.play("tap");
  });

  if (!isGM) return;

  /* ---- GM-only: visibility, import, export ---- */

  html.on("click", "[data-action='tool-toggle']", async (ev) => {
    const uuid = ev.currentTarget.dataset.uuid;
    const list = macroList();
    const entry = list.find(e => e.uuid === uuid);
    if (!entry) return;
    entry.visible = !entry.visible;
    const macro = await fromUuid(uuid).catch(() => null);
    if (macro) await applyOwnership(macro, entry.visible);
    await app.mutate("tools.setList", { list });
    app.render(false);
    AgentAudio.play("tap");
  });

  html.on("click", "[data-action='tool-export']", async () => {
    const out = [];
    for (const e of macroList()) {
      if (e.ownerUserId) continue;            // export GM daemons only
      const m = await fromUuid(e.uuid).catch(() => null);
      if (!m) continue;
      out.push({ name: m.name, img: m.img, type: m.type, scope: m.scope, command: m.command, visible: !!e.visible });
    }
    const data = JSON.stringify({ module: MODULE_ID, kind: "toolMacros", version: 1, macros: out }, null, 2);
    saveDataToFile(data, "application/json", `agent-daemons-${out.length}.json`);
    AgentAudio.play("cash");
  });

  html.on("click", "[data-action='tool-import']", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const incoming = Array.isArray(parsed) ? parsed : (parsed.macros || []);
        if (!Array.isArray(incoming) || !incoming.length) throw new Error("empty");
        const list = macroList();
        let added = 0;
        for (const spec of incoming) {
          if (!spec || typeof spec.command !== "string") continue;
          const visible = !!spec.visible;
          const macro = await Macro.create({
            name: String(spec.name || "Daemon"),
            type: ["script", "chat"].includes(spec.type) ? spec.type : "script",
            scope: spec.scope || "global",
            command: spec.command,
            img: spec.img || "icons/svg/dice-target.svg",
            "ownership.default": visible ? OWNERSHIP.OBSERVER : OWNERSHIP.NONE
          });
          if (macro) { list.push({ uuid: macro.uuid, visible, ownerUserId: "" }); added++; }
        }
        await app.mutate("tools.setList", { list });
        app.render(false);
        ui.notifications.info(loc("AGENTOS.Tools.Imported", { added }));
        AgentAudio.play("cash");
      } catch (e) {
        console.warn(`${MODULE_ID} | daemon import failed`, e);
        ui.notifications.error(loc("AGENTOS.Tools.ImportFailed"));
        AgentAudio.play("error");
      }
    });
    input.click();
  });
}
