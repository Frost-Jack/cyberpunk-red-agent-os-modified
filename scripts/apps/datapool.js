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
  const shards = Data.shardsForUser(game.user.id, isGM)
    .slice().sort((a, b) => b.ts - a.ts);

  /* The folder a shard lives in FOR THE CURRENT VIEWER. */
  const folderOf = (s) => {
    if (!s.isCopy && (isGM || s.createdBy === game.user.id)) return (s.folder || "").trim();
    return ((s.recipientFolders || {})[game.user.id] || "").trim();
  };
  const allFolders = [...new Set(shards.map(folderOf).filter(Boolean))].sort();

  if (st.shardId) {
    const shard = shards.find(s => s.id === st.shardId);
    if (!shard) { app.state = {}; return getData(app); }

    /* GM sees WHO got a copy and WHEN (recipients keyed by userId → ts). */
    let recipients = [];
    if (isGM) {
      recipients = Object.entries(shard.recipients || {}).map(([uid, ts]) => ({
        name: Data.playerIdentity(uid).name,
        userName: game.users.get(uid)?.name || "?",
        ts
      })).sort((a, b) => a.ts - b.ts);
      for (const gid of (shard.gardenRecipients || [])) {
        const g = Data.gardenContact(gid);
        recipients.push({ name: g?.name || "Garden", userName: "Garden", ts: shard.ts });
      }
    }

    return {
      viewing: true,
      shard,
      bodyHtml: renderShardBody(shard),
      isAuthored: shard.createdBy === game.user.id,
      canDelete: isGM || shard.createdBy === game.user.id,
      canSend: !shard.isCopy && (isGM || shard.createdBy === game.user.id),
      canEdit: !shard.isCopy && (isGM || shard.createdBy === game.user.id),
      currentFolder: folderOf(shard),
      folders: allFolders,
      recipients,
      hasRecipients: recipients.length > 0,
      sending: !!st.sending,
      candidates: st.sending ? recipientCandidates(isGM, shard.createdBy).map(c => ({
        ...c, selected: (st.sendTo || []).includes(c.id)
      })) : []
    };
  }

  const mapped = shards.map(s => ({
    id: s.id,
    title: s.title,
    authorName: s.authorName,
    ts: s.ts,
    isCopy: !!s.isCopy,
    isAuthored: s.createdBy === game.user.id && !s.isCopy,
    creatorName: isGM ? (game.users.get(s.createdBy)?.name || "?") : "",
    recipientCount: Object.keys(s.recipients || {}).length + (s.gardenRecipients || []).length,
    folder: folderOf(s)
  }));

  /* Group into collapsible folders; ungrouped bucket first. */
  const noFolder = loc("AGENTOS.Data.NoFolder");
  const byFolder = new Map();
  for (const s of mapped) {
    const key = s.folder || noFolder;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(s);
  }
  const collapsed = st.collapsed || {};
  const groups = [...byFolder.entries()]
    .sort((a, b) => (a[0] === noFolder ? -1 : b[0] === noFolder ? 1 : a[0].localeCompare(b[0])))
    .map(([name, items]) => ({ name, collapsed: !!collapsed[name], count: items.length, shards: items }));

  return {
    viewing: false,
    composing: !!st.composing,
    isEditing: !!st.editShardId,
    compose: st.compose || { title: "", body: "", format: "plain", authorName: "" },
    isGM,
    gardenAuthors: isGM ? Data.visibleGardenContacts(true) : [],
    hasShards: mapped.length > 0,
    groups
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
    const name = ev.currentTarget.dataset.folder;
    st.collapsed = st.collapsed || {};
    st.collapsed[name] = !st.collapsed[name];
    app.render(false);
  });

  /* Move the currently-open shard into a folder (author's original or the
   * recipient's own copy — the op figures out which). */
  html.on("click", "[data-action='shard-move']", async () => {
    const folder = await app.promptText(loc("AGENTOS.Data.MoveToFolder"),
      (await getData(app)).currentFolder || "", loc("AGENTOS.Data.FolderPlaceholder"));
    if (folder === null) return;
    await app.mutate("shard.setFolder", { shardId: st.shardId, folder: folder.trim() });
  });

  const readCompose = () => ({
    title: String(html.find("[name='shard-title']").val() ?? st.compose?.title ?? ""),
    body: String(html.find("[name='shard-body']").val() ?? st.compose?.body ?? ""),
    format: String(html.find("[name='shard-format']").val() ?? st.compose?.format ?? "plain"),
    authorName: String(html.find("[name='shard-author']").val() ?? st.compose?.authorName ?? ""),
    folder: String(html.find("[name='shard-folder']").val() ?? st.compose?.folder ?? "")
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
  html.on("input change", "[name='shard-title'], [name='shard-body'], [name='shard-format'], [name='shard-author'], [name='shard-folder']", () => {
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
    const { title, body, format, authorName, folder } = readCompose();
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
      app.mutate("shard.create", { shard: { title: title.trim(), body, format, authorName: authorName.trim(), folder: (folder || "").trim() } });
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
