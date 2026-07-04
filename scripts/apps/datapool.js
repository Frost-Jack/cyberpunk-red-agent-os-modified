/* Datapool: mail-like data shards with plain / markdown / html bodies. */

import { loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

/* ---- body rendering (scoped, style-bleed safe) ---- */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function sanitizeHtml(html) {
  let out = String(html);
  out = out.replace(/<\s*(script|style|link|iframe|object|embed|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  out = out.replace(/<\s*(script|style|link|iframe|object|embed|meta)[^>]*\/?\s*>/gi, "");
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, "");
  return out;
}

function renderMarkdown(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inList = false, inCode = false;
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(raw)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(raw.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (/^\s*---+\s*$/.test(raw)) { out.push("<hr>"); continue; }
    if (raw.trim() === "") { out.push("<br>"); continue; }
    out.push(`<p>${inline(raw)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</pre>");
  return out.join("\n");
}

export function renderShardBody(shard) {
  if (shard.format === "html") return sanitizeHtml(shard.body);
  if (shard.format === "markdown") return renderMarkdown(shard.body);
  return escapeHtml(shard.body).replace(/\r?\n/g, "<br>");
}

/* ---- recipients ---- */

function recipientCandidates(isGM, excludeUserId) {
  const players = game.users.filter(u => !u.isGM && u.id !== excludeUserId).map(u => ({
    id: `user:${u.id}`,
    name: Data.playerIdentity(u.id).name,
    sub: u.name,
    img: Data.playerIdentity(u.id).img,
    online: u.active
  }));
  const garden = Data.visibleGardenContacts(isGM).map(g => ({
    id: `garden:${g.id}`,
    name: g.name,
    sub: "Garden",
    img: g.img || "icons/svg/mystery-man.svg",
    online: false
  }));
  return [...players, ...garden];
}

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const uid = game.user.id;
  const shards = Data.shardsForUser(uid, isGM)
    .slice().sort((a, b) => b.ts - a.ts);

  /* Whether this shard is one the viewer OWNS (authored original) vs a copy
   * they RECEIVED. Owned shards file via s.folderId; received via
   * recipientFolderIds[uid]. Received copies with no folder = the Inbox. */
  const isOwned = (s) => !s.isCopy && (isGM || s.createdBy === uid);
  const folderIdOf = (s) => isOwned(s)
    ? (s.folderId || null)
    : ((s.recipientFolderIds || {})[uid] || null);
  const isReceived = (s) => !isOwned(s);

  /* This viewer's folders, and a display name for a folderId. */
  const myFolders = (Data.getWorld("datapoolFolders") || []).filter(f => f.ownerUserId === uid);
  const folderNameById = (id) => myFolders.find(f => f.id === id)?.name || "";

  if (st.shardId) {
    const shard = shards.find(s => s.id === st.shardId);
    if (!shard) { app.state = {}; return getData(app); }

    /* GM sees WHO got a copy and WHEN (recipients keyed by userId → ts). */
    let recipients = [];
    if (isGM) {
      recipients = Object.entries(shard.recipients || {}).map(([rid, ts]) => ({
        name: Data.playerIdentity(rid).name,
        userName: game.users.get(rid)?.name || "?",
        ts
      })).sort((a, b) => a.ts - b.ts);
      for (const gid of (shard.gardenRecipients || [])) {
        const g = Data.gardenContact(gid);
        recipients.push({ name: g?.name || "Garden", userName: "Garden", ts: shard.ts });
      }
    }

    const curFid = folderIdOf(shard);
    return {
      viewing: true,
      shard,
      bodyHtml: renderShardBody(shard),
      isAuthored: shard.createdBy === game.user.id,
      canDelete: isGM || shard.createdBy === game.user.id,
      canSend: !shard.isCopy && (isGM || shard.createdBy === game.user.id),
      canEdit: !shard.isCopy && (isGM || shard.createdBy === game.user.id),
      currentFolder: curFid ? folderNameById(curFid) : (isReceived(shard) ? loc("AGENTOS.Data.Inbox") : ""),
      recipients,
      hasRecipients: recipients.length > 0,
      sending: !!st.sending,
      candidates: st.sending ? recipientCandidates(isGM, shard.createdBy).map(c => ({
        ...c, selected: (st.sendTo || []).includes(c.id)
      })) : []
    };
  }

  const mapShard = (s) => ({
    id: s.id,
    title: s.title,
    authorName: s.authorName,
    ts: s.ts,
    isCopy: !!s.isCopy,
    isAuthored: s.createdBy === game.user.id && !s.isCopy,
    creatorName: isGM ? (game.users.get(s.createdBy)?.name || "?") : "",
    recipientCount: Object.keys(s.recipients || {}).length + (s.gardenRecipients || []).length
  });

  const collapsed = st.collapsed || {};

  /* Received copies with no personal folder live in the virtual Inbox — which
   * never holds subfolders (messages only arrive there). Everything else is
   * placed by its viewer folderId; unfiled owned shards sit at root. */
  const inboxShards = shards.filter(s => isReceived(s) && !folderIdOf(s)).map(mapShard);
  const rootShards = shards.filter(s => isOwned(s) && !folderIdOf(s)).map(mapShard);

  const buildFolder = (folder) => {
    const subfolders = myFolders
      .filter(f => f.parentId === folder.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(buildFolder);
    const items = shards.filter(s => folderIdOf(s) === folder.id).map(mapShard);
    return {
      id: folder.id, name: folder.name,
      collapsed: !!collapsed[folder.id],
      subfolders, shards: items,
      count: items.length + subfolders.reduce((n, f) => n + f.count, 0)
    };
  };
  const rootFolders = myFolders.filter(f => !f.parentId)
    .sort((a, b) => a.name.localeCompare(b.name)).map(buildFolder);

  return {
    viewing: false,
    composing: !!st.composing,
    isEditing: !!st.editShardId,
    compose: st.compose || { title: "", body: "", format: "plain", authorName: "" },
    isGM,
    gardenAuthors: isGM ? Data.visibleGardenContacts(true) : [],
    hasShards: shards.length > 0,
    inbox: { shards: inboxShards, count: inboxShards.length, collapsed: !!collapsed["__inbox"] },
    folders: rootFolders,
    rootShards
  };
}

export function activateListeners(app, html) {
  const st = app.state;

  html.on("click", "[data-action='shard-open']", (ev) => {
    app.state = { shardId: ev.currentTarget.dataset.shardId };
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='shard-back']", () => {
    app.state = {};
    app.render(false);
  });

  /* ---- folders ---- */

  html.on("click", "[data-action='shard-folder-toggle']", (ev) => {
    ev.stopPropagation();
    const id = ev.currentTarget.dataset.folderId;
    st.collapsed = st.collapsed || {};
    st.collapsed[id] = !st.collapsed[id];
    app.render(false);
  });

  /* Detail-view "move" — pick a destination folder from a dialog. */
  html.on("click", "[data-action='shard-move']", async () => {
    const mine = (Data.getWorld("datapoolFolders") || []).filter(f => f.ownerUserId === game.user.id);
    const shard = Data.shardsForUser(game.user.id, game.user.isGM).find(s => s.id === st.shardId);
    const received = shard && !(!shard.isCopy && (game.user.isGM || shard.createdBy === game.user.id));
    const esc = Handlebars.escapeExpression;
    const opts = [
      received
        ? `<button type="button" class="agentos-btn block" data-fid="">${esc(loc("AGENTOS.Data.Inbox"))}</button>`
        : `<button type="button" class="agentos-btn block" data-fid="">${esc(loc("AGENTOS.Data.RootLevel"))}</button>`,
      ...mine.map(f => `<button type="button" class="agentos-btn block" data-fid="${f.id}">${esc(f.name)}</button>`)
    ].join("");
    const content = `<div class="agentos-move-picker" style="display:flex;flex-direction:column;gap:4px;">${opts}</div>`;
    const dlg = new Dialog({
      title: loc("AGENTOS.Data.MoveToFolder"),
      content,
      buttons: { cancel: { label: loc("AGENTOS.Common.Cancel") } },
      render: (h) => h.find("[data-fid]").on("click", async (ev) => {
        const fid = ev.currentTarget.dataset.fid;
        dlg.close();
        await app.mutate("shard.setFolder", { shardId: st.shardId, folderId: fid });
      })
    });
    dlg.render(true);
  });

  html.on("click", "[data-action='datapool-folder-new']", async (ev) => {
    ev.stopPropagation();
    const parentId = ev.currentTarget.dataset.parentId || null;
    const name = await app.promptText(loc("AGENTOS.Data.NewFolder"), "", loc("AGENTOS.Data.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    if (parentId) { st.collapsed = st.collapsed || {}; st.collapsed[parentId] = false; }
    await app.mutate("datapoolFolder.create", { name: name.trim(), parentId });
    app.render(false);
  });

  html.on("click", "[data-action='datapool-folder-rename']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    const cur = (Data.getWorld("datapoolFolders") || []).find(f => f.id === folderId);
    const name = await app.promptText(loc("AGENTOS.Data.RenameFolder"), cur?.name || "", loc("AGENTOS.Data.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    await app.mutate("datapoolFolder.rename", { folderId, name: name.trim() });
    app.render(false);
  });

  html.on("click", "[data-action='datapool-folder-delete']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    if (!(await app.confirm(loc("AGENTOS.Data.DeleteFolderConfirm")))) return;
    AgentAudio.play("tap");
    await app.mutate("datapoolFolder.delete", { folderId });
    app.render(false);
  });

  /* Drag a shard row or a folder onto a folder header (or Inbox/root). */
  html.on("dragstart", "[data-shard-drag], [data-datapoolfolder-drag]", (ev) => {
    ev.stopPropagation();
    const el = ev.currentTarget;
    const payload = el.dataset.shardDrag ? { shard: el.dataset.shardDrag } : { folder: el.dataset.datapoolfolderDrag };
    ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(payload));
    ev.originalEvent.dataTransfer.effectAllowed = "move";
  });
  const drops = html.find("[data-datapool-drop]");
  drops.on("dragover", (ev) => { ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.classList.add("drop-over"); });
  drops.on("dragleave", (ev) => ev.currentTarget.classList.remove("drop-over"));
  drops.on("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.remove("drop-over");
    let data;
    try { data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain")); } catch (e) { return; }
    const target = ev.currentTarget.dataset.datapoolDrop;   // "" = root, "__inbox" = Inbox, else folderId
    AgentAudio.play("tap");
    if (data.shard) {
      // Dropping into Inbox is only meaningful for received copies → clears their folder (null).
      const folderId = (target === "__inbox" || target === "") ? "" : target;
      await app.mutate("shard.setFolder", { shardId: data.shard, folderId });
    } else if (data.folder && target !== "__inbox" && data.folder !== target) {
      // folders can't nest under Inbox
      await app.mutate("datapoolFolder.move", { folderId: data.folder, parentId: target || null });
    }
    app.render(false);
  });

  const readCompose = () => ({
    title: String(html.find("[name='shard-title']").val() ?? st.compose?.title ?? ""),
    body: String(html.find("[name='shard-body']").val() ?? st.compose?.body ?? ""),
    format: String(html.find("[name='shard-format']").val() ?? st.compose?.format ?? "plain"),
    authorName: String(html.find("[name='shard-author']").val() ?? st.compose?.authorName ?? "")
  });

  html.on("click", "[data-action='shard-compose']", () => {
    st.composing = true;
    st.editShardId = null;
    st.compose = { title: "", body: "", format: "plain", authorName: "" };
    app.render(false);
  });

  /* Author edits their ORIGINAL — already-sent copies stay as delivered. */
  html.on("click", "[data-action='shard-edit']", () => {
    const shard = Data.shardsForUser(game.user.id, game.user.isGM).find(s => s.id === st.shardId);
    if (!shard || shard.isCopy) return;
    app.state = {
      composing: true,
      editShardId: shard.id,
      compose: { title: shard.title, body: shard.body, format: shard.format, authorName: shard.authorName }
    };
    app.render(false);
  });

  html.on("click", "[data-action='shard-compose-cancel']", () => {
    st.composing = false;
    st.editShardId = null;
    st.compose = null;
    app.render(false);
  });

  /* Keep the compose draft synced so background re-renders never wipe it. */
  html.on("input change", "[name='shard-title'], [name='shard-body'], [name='shard-format'], [name='shard-author']", () => {
    st.compose = readCompose();
  });

  html.on("change", "[name='shard-author-garden']", (ev) => {
    const sel = ev.currentTarget.value;
    if (sel) {
      html.find("[name='shard-author']").val(sel);
      st.compose = readCompose();
    }
  });

  html.on("click", "[data-action='shard-create']", (ev) => {
    ev.preventDefault();
    const { title, body, format, authorName } = readCompose();
    if (!title.trim() || !body) return AgentAudio.play("error");
    const editShardId = st.editShardId;
    st.composing = false;
    st.editShardId = null;
    st.compose = null;
    AgentAudio.play("tap");
    app.render(false);                      // optimistic: close the modal now
    if (editShardId) {
      app.mutate("shard.update", { shardId: editShardId, patch: { title: title.trim(), body, format, authorName: authorName.trim() } });
    } else {
      app.mutate("shard.create", { shard: { title: title.trim(), body, format, authorName: authorName.trim() } });
    }
  });

  html.on("click", "[data-action='shard-delete']", async (ev) => {
    ev.stopPropagation();
    const shardId = ev.currentTarget.dataset.shardId || st.shardId;
    if (!(await app.confirm(loc("AGENTOS.Data.DeleteConfirm")))) return;
    if (st.shardId) app.state = {};
    await app.mutate("shard.delete", { shardId });
  });

  html.on("click", "[data-action='shard-send-open']", () => {
    st.sending = true;
    st.sendTo = [];
    app.render(false);
  });

  html.on("click", "[data-action='shard-send-cancel']", () => {
    st.sending = false;
    app.render(false);
  });

  html.on("click", "[data-action='shard-toggle-recipient']", (ev) => {
    const id = ev.currentTarget.dataset.id;
    st.sendTo = st.sendTo || [];
    if (st.sendTo.includes(id)) st.sendTo = st.sendTo.filter(x => x !== id);
    else st.sendTo.push(id);
    app.render(false);
  });

  html.on("click", "[data-action='shard-send']", async () => {
    const ids = st.sendTo || [];
    if (!ids.length) return AgentAudio.play("error");
    const userIds = ids.filter(i => i.startsWith("user:")).map(i => i.slice(5));
    const gardenIds = ids.filter(i => i.startsWith("garden:")).map(i => i.slice(7));
    st.sending = false;
    st.sendTo = [];
    await app.mutate("shard.send", { shardId: st.shardId, userIds, gardenIds });
    AgentAudio.play("tap");
  });
}
