/* NCPD Database: a wanted board of rap sheets. GM can drop an Actor to prefill
 * a record, set a status, bounty, threat level and a list of crimes. */

import { loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

/* Case statuses — each drives the poster's frame colour + banner label. */
export const STATUSES = [
  { id: "wanted",   color: "#ff2b55", icon: "fa-triangle-exclamation" },
  { id: "missing",  color: "#38b6ff", icon: "fa-magnifying-glass" },
  { id: "poi",      color: "#ffd23f", icon: "fa-user-secret" },
  { id: "detained", color: "#9d7bff", icon: "fa-handcuffs" },
  { id: "cleared",  color: "#3df58a", icon: "fa-circle-check" }
];
const THREATS = ["low", "medium", "high", "psycho"];

function statusMeta(id) {
  const s = STATUSES.find(x => x.id === id) || STATUSES[0];
  return { id: s.id, color: s.color, icon: s.icon, label: loc(`AGENTOS.Ncpd.Status.${s.id}`) };
}

/** Decorate a raw record with the display metadata the template needs. */
function decorate(r) {
  const s = statusMeta(r.status || "wanted");
  const threat = THREATS.includes(r.threat) ? r.threat : "low";
  return {
    ...r,
    status: s.id,
    statusLabel: s.label,
    statusColor: s.color,
    statusIcon: s.icon,
    threat,
    threatLabel: loc(`AGENTOS.Ncpd.Threat.${threat}`),
    threatLevel: THREATS.indexOf(threat) + 1,           // 1..4 for the pip meter
    bounty: Number(r.bounty || 0),
    bountyFmt: Number(r.bounty || 0).toLocaleString(),
    crimes: Array.isArray(r.crimes) ? r.crimes : [],
    crimeCount: (Array.isArray(r.crimes) ? r.crimes : []).length,
    hidden: !!r.hidden
  };
}

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const records = (Data.getWorld("ncpdRecords") || []).slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(decorate);

  const allFolders = Data.getWorld("ncpdFolders") || [];
  const folderById = new Map(allFolders.map(f => [f.id, f]));
  // True if the record sits inside a classified folder (any ancestor secret).
  const inSecret = (r) => {
    let cur = r.folderId ? folderById.get(r.folderId) : null;
    while (cur) { if (cur.secret) return true; cur = cur.parentId ? folderById.get(cur.parentId) : null; }
    return false;
  };
  // Players never receive hidden records, nor records locked inside a
  // classified folder — not in the board, search, or the detail view.
  const visible = records.filter(r => isGM || (!r.hidden && !inSecret(r)));

  if (st.recordId) {
    const record = visible.find(r => r.id === st.recordId);
    if (!record) { app.state = {}; return getData(app); }
    return { viewing: true, isGM, record };
  }

  // The edit form works on a plain draft; give it the crimes as a textarea blob
  // and the status option list.
  const editing = st.editing ? {
    ...st.editing,
    status: st.editing.status || "wanted",
    threat: st.editing.threat || "low",
    crimesText: Array.isArray(st.editing.crimes) ? st.editing.crimes.join("\n") : (st.editing.crimesText || "")
  } : null;

  const term = (st.search || "").toLowerCase();
  const filtered = term
    ? visible.filter(r =>
        r.name.toLowerCase().includes(term) ||
        (r.faction || "").toLowerCase().includes(term) ||
        (r.alias || "").toLowerCase().includes(term) ||
        r.statusLabel.toLowerCase().includes(term))
    : visible;

  // Folder tree (GM organisation). When searching we show a flat result list.
  const collapsed = st.collapsed || {};
  const buildFolder = (folder) => {
    // Classified folder for a player: show the folder shell (locked), no
    // contents. The GM sees it normally, flagged as secret.
    const locked = folder.secret && !isGM;
    const subfolders = locked ? [] : allFolders
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(buildFolder);
    const cards = locked ? [] : visible.filter(r => (r.folderId || null) === folder.id);
    return {
      id: folder.id, name: folder.name,
      secret: !!folder.secret, locked,
      collapsed: locked ? true : !!collapsed[folder.id],
      subfolders, cards,
      count: cards.length + subfolders.reduce((n, s) => n + s.count, 0)
    };
  };
  const rootFolders = allFolders.filter(f => !f.parentId)
    .sort((a, b) => a.name.localeCompare(b.name)).map(buildFolder);
  const rootCards = visible.filter(r => !r.folderId);

  return {
    viewing: false,
    isGM,
    records: visible,
    editing,
    statusOptions: STATUSES.map(s => ({ id: s.id, label: loc(`AGENTOS.Ncpd.Status.${s.id}`), active: editing?.status === s.id })),
    threatOptions: THREATS.map(t => ({ id: t, label: loc(`AGENTOS.Ncpd.Threat.${t}`), active: editing?.threat === t })),
    search: st.search || "",
    searching: !!term,
    filtered,
    hasAny: visible.length > 0 || rootFolders.length > 0,
    folders: rootFolders,
    rootCards
  };
}

function readDraft(html, st) {
  const d = st.editing || {};
  const val = (sel, cur) => { const v = html.find(sel).val(); return v === undefined ? (cur ?? "") : String(v); };
  d.name = val("[name='ncpd-name']", d.name);
  d.alias = val("[name='ncpd-alias']", d.alias);
  d.faction = val("[name='ncpd-faction']", d.faction);
  d.lastSeen = val("[name='ncpd-lastseen']", d.lastSeen);
  d.bounty = val("[name='ncpd-bounty']", d.bounty);
  d.description = val("[name='ncpd-desc']", d.description);
  const crimesText = html.find("[name='ncpd-crimes']").val();
  if (crimesText !== undefined) d.crimes = String(crimesText).split("\n").map(s => s.trim()).filter(Boolean);
  // status / threat come from clickable chips; hidden from a checkbox
  d.status = d.status || "wanted";
  d.threat = d.threat || "low";
  const vis = html.find("[name='ncpd-hidden']");
  if (vis.length) d.hidden = !vis.prop("checked");
  return d;
}

export function activateListeners(app, html) {
  const st = app.state;

  html.on("input", "[name='ncpd-search']", foundry.utils.debounce((ev) => {
    st.search = ev.target.value;
    st.focusSearch = true;
    app.render(false);
  }, 250));
  html.find("[name='ncpd-search']").on("blur", () => { st.focusSearch = false; });
  if (st.focusSearch) {
    const inp = html.find("[name='ncpd-search']")[0];
    if (inp) {
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* noop */ }
    }
  }

  html.on("click", "[data-action='ncpd-open']", (ev) => {
    app.state = { recordId: ev.currentTarget.dataset.recordId };
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-back']", () => {
    app.state = {};
    app.render(false);
  });

  /* ---- folders (GM) ---- */

  html.on("click", "[data-action='ncpd-folder-toggle']", (ev) => {
    ev.stopPropagation();
    const id = ev.currentTarget.dataset.folderId;
    st.collapsed = st.collapsed || {};
    st.collapsed[id] = !st.collapsed[id];
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-folder-new']", async (ev) => {
    ev.stopPropagation();
    const parentId = ev.currentTarget.dataset.parentId || null;
    const name = await app.promptText(loc("AGENTOS.Ncpd.NewFolder"), "", loc("AGENTOS.Ncpd.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    if (parentId) { st.collapsed = st.collapsed || {}; st.collapsed[parentId] = false; }
    await app.mutate("ncpdFolder.create", { name: name.trim(), parentId });
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-folder-rename']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    const cur = (Data.getWorld("ncpdFolders") || []).find(f => f.id === folderId);
    const name = await app.promptText(loc("AGENTOS.Ncpd.RenameFolder"), cur?.name || "", loc("AGENTOS.Ncpd.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    await app.mutate("ncpdFolder.rename", { folderId, name: name.trim() });
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-folder-delete']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    if (!(await app.confirm(loc("AGENTOS.Ncpd.DeleteFolderConfirm")))) return;
    AgentAudio.play("tap");
    await app.mutate("ncpdFolder.delete", { folderId });
    app.render(false);
  });

  /* Drag a record card or a folder onto a folder header (or the board root). */
  html.on("dragstart", "[data-ncpd-drag], [data-ncpdfolder-drag]", (ev) => {
    ev.stopPropagation();
    const el = ev.currentTarget;
    const payload = el.dataset.ncpdDrag ? { record: el.dataset.ncpdDrag } : { folder: el.dataset.ncpdfolderDrag };
    ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(payload));
    ev.originalEvent.dataTransfer.effectAllowed = "move";
  });
  const drops = html.find("[data-ncpd-drop]");
  drops.on("dragover", (ev) => { ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.classList.add("drop-over"); });
  drops.on("dragleave", (ev) => ev.currentTarget.classList.remove("drop-over"));
  drops.on("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.remove("drop-over");
    let data;
    try { data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain")); } catch (e) { return; }
    const targetId = ev.currentTarget.dataset.ncpdDrop || null;   // "" = root
    AgentAudio.play("tap");
    if (data.record) await app.mutate("ncpd.move", { recordId: data.record, folderId: targetId });
    else if (data.folder && data.folder !== targetId) await app.mutate("ncpdFolder.move", { folderId: data.folder, parentId: targetId });
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-new']", () => {
    st.editing = { name: "", img: "", faction: "", alias: "", lastSeen: "",
      status: "wanted", threat: "low", bounty: 0, crimes: [], description: "", hidden: true };
    app.render(false);
  });

  /* Toggle a record's player visibility (edit form checkbox). */
  html.on("change", "[name='ncpd-hidden']", (ev) => {
    st.editing = readDraft(html, st);
    st.editing.hidden = !ev.currentTarget.checked;   // checkbox = "visible to players"
  });

  /* Toggle a folder's "classified" state. */
  html.on("click", "[data-action='ncpd-folder-secret']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    const cur = (Data.getWorld("ncpdFolders") || []).find(f => f.id === folderId);
    AgentAudio.play("tap");
    await app.mutate("ncpdFolder.setSecret", { folderId, secret: !cur?.secret });
    app.render(false);
  });

  /* Status / threat chip pickers — save the choice on the draft, re-render. */
  html.on("click", "[data-action='ncpd-status']", (ev) => {
    st.editing = readDraft(html, st);
    st.editing.status = ev.currentTarget.dataset.status;
    AgentAudio.play("tap");
    app.render(false);
  });
  html.on("click", "[data-action='ncpd-threat']", (ev) => {
    st.editing = readDraft(html, st);
    st.editing.threat = ev.currentTarget.dataset.threat;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-edit']", (ev) => {
    ev.stopPropagation();
    const r = (Data.getWorld("ncpdRecords") || []).find(x => x.id === ev.currentTarget.dataset.recordId);
    if (!r) return;
    app.state = { editing: foundry.utils.deepClone(r) };
    app.render(false);
  });

  html.on("input", ".agentos-ncpd-form input, .agentos-ncpd-form textarea", () => {
    st.editing = readDraft(html, st);
  });

  html.on("click", "[data-action='ncpd-cancel']", () => {
    st.editing = null;
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-img']", async () => {
    st.editing = readDraft(html, st);
    const path = await app.pickFile("image");
    if (path) st.editing.img = path;
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-save']", (ev) => {
    ev.preventDefault();
    const draft = readDraft(html, st);
    if (!draft.name.trim()) return AgentAudio.play("error");
    st.editing = null;
    AgentAudio.play("tap");
    app.render(false);                      // optimistic: close the form now
    app.mutate("ncpd.save", { record: draft });
  });

  html.on("click", "[data-action='ncpd-delete']", async (ev) => {
    ev.stopPropagation();
    if (!(await app.confirm(loc("AGENTOS.Ncpd.DeleteConfirm")))) return;
    const recordId = ev.currentTarget.dataset.recordId || st.recordId;
    if (st.recordId) app.state = {};
    await app.mutate("ncpd.delete", { recordId });
  });

  /* Actor drag & drop onto the edit form prefills image + name. */
  const dropzone = html.find(".agentos-ncpd-drop")[0];
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
        if (!st.editing.name) st.editing.name = actor.name;
        AgentAudio.play("tap");
        app.render(false);
      } catch (e) { /* not an actor drop */ }
    });
  }
}
