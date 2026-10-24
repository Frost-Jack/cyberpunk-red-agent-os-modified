/* Messenger app. Conversations happen between CHARACTERS:
 * player participants are the users' assigned actors (shown under their
 * proxy ID when set), NPC participants are Garden contacts. The GM observes
 * every chat without being a member and may speak as any NPC participant. */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";
import { triggerCall } from "../vfx.js";
import { ShardReader } from "../shard-reader.js";

// Private drafts live only in this browser session, never in shared world data.
const drafts = new Map();
const draftKey = id => `${game.user.id}:${id}`;
function rememberDraft(st) {
  if (!st.chatId) return;
  if (st.draft || st.attachment || st.reply || st.sending || st.uploading || st.pendingUpload) drafts.set(draftKey(st.chatId), st);
  else drafts.delete(draftKey(st.chatId));
}

async function uploadAttachment(app, st, file, kind) {
  if (st.uploading) return;
  st.pendingUpload = { file, kind }; st.uploading = true;
  rememberDraft(st); app.render(false);
  const path = await app.uploadFile(file);
  const current = drafts.get(draftKey(st.chatId)) || st;
  current.uploading = false;
  if (path) { if (!current.attachment) current.attachment = { kind, src: path }; current.pendingUpload = null; }
  rememberDraft(current);
  if (app.state === current) app.render(false);
}

function myKey() {
  return Data.participantKeyForUser(game.user.id);
}

function chatDisplay(chat) {
  const isGM = game.user.isGM;
  const others = (chat.participants || []).filter(p => isGM || p.key !== myKey());
  const idents = others.map(p => Data.participantIdentity(chat, p.key));
  return {
    name: chat.name || idents.map(i => i.name).join(", ") || "—",
    // a GM-set chat picture wins over the first participant's avatar
    img: chat.img || idents[0]?.img || "icons/svg/mystery-man.svg"
  };
}

/** Selectable participants for the chat-creation modal. */
function availableParticipants(forGM) {
  const out = [];
  for (const user of game.users.filter(u => !u.isGM && u.character)) {
    if (!forGM && user.id === game.user.id) continue;
    const ident = Data.playerIdentity(user.id);
    out.push({ key: `player:${user.id}`, name: ident.name, img: ident.img, kind: "player", sub: user.name });
  }
  for (const g of Data.visibleGardenContacts(forGM)) {
    out.push({
      key: `garden:${g.id}`, name: g.name, img: g.img || "icons/svg/mystery-man.svg",
      kind: "garden", sub: "Garden", folder: (g.folder || "").trim()
    });
  }
  return out;
}

/** Group participant candidates into folders: players first, then Garden folders. */
function groupCandidates(cands, collapsedMap = null) {
  const groups = [];
  const players = cands.filter(c => c.kind === "player");
  if (players.length) {
    groups.push({ id: "__players", name: loc("AGENTOS.Chat.PlayersFolder"), items: players });
  }
  const noFolder = loc("AGENTOS.Garden.NoFolder");
  const byFolder = new Map();
  for (const c of cands.filter(c => c.kind === "garden")) {
    const key = c.folder || noFolder;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(c);
  }
  for (const [name, items] of [...byFolder.entries()]
    .sort((a, b) => (a[0] === noFolder ? -1 : b[0] === noFolder ? 1 : a[0].localeCompare(b[0])))) {
    groups.push({ id: `f:${name}`, name, items });
  }
  for (const g of groups) {
    g.count = g.items.length;
    g.collapsed = collapsedMap ? !!collapsedMap[g.id] : false;
  }
  return groups;
}

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;

  /* ---- open thread ---- */
  /* If the chat isn't in world data yet (a just-created chat racing the
   * settings sync), fall through to the list but KEEP st.chatId — the next
   * updateSetting re-render will open the thread automatically. */
  const openChat = st.chatId ? Data.getChat(st.chatId) : null;
  if (openChat) {
    if (st.draftChat !== st.chatId) {
      const saved = drafts.get(draftKey(st.chatId));
      if (saved) Object.assign(st, { draft: saved.draft, attachment: saved.attachment, sending: saved.sending, uploading: saved.uploading, voiceKey: saved.voiceKey, reply: saved.reply, pendingUpload: saved.pendingUpload });
      st.draftChat = st.chatId;
      rememberDraft(st);
    }
    const oldInput = app.element?.find("[name='chat-input']")[0];
    if (oldInput) {
      const active = globalThis.document?.activeElement;
      if (active === oldInput) st.composeFocus = true;
      else if (active?.matches?.("input,textarea,select") || active?.isContentEditable) st.composeFocus = false;
      st.composeSelection = [oldInput.selectionStart, oldInput.selectionEnd];
    }
    const chat = openChat;
    const disp = chatDisplay(chat);
    const mine = myKey();
    const isMember = chat.participants.some(p => p.key === mine);
    const identities = new Map(chat.participants.map(p => [p.key, Data.participantIdentity(chat, p.key)]));
    const shards = Data.shardsForUser(game.user.id, isGM), contacts = Data.contactsForUser(game.user.id, isGM);
    const imported = new Set([...shards.filter(s => s.recipients?.[game.user.id]), ...contacts.filter(c => c.ownerUserId === game.user.id)].map(v => v.importMessage));
    const messages = Data.getMessages(st.chatId).map(m => {
      const live = identities.get(m.senderKey) || { name: m.senderName, img: m.senderImg };
      const media = ["image", "audio", "video"].includes(m.attachment?.kind);
      const attachment = media ? (Data.safeMediaPath(m.attachment.src) ? { ...m.attachment, src: Data.safeMediaPath(m.attachment.src) } : null) : m.attachment;
      return {
        ...m,
        attachment,
        name: live.name,
        img: live.img,
        isSelf: !isGM && m.senderKey === mine,
        reactionsView: ["👍", "❤", "⚠"].map(reaction => ({ reaction, count: m.reactions?.[reaction]?.length || 0, active: m.reactions?.[reaction]?.includes(game.user.id) || false })),
        imported: imported.has(`${st.chatId}:${m.id}`),
        card: ["shard", "contact", "coordinates", "item"].includes(m.attachment?.kind),
        importable: ["shard", "contact"].includes(m.attachment?.kind)
      };
    });
    // Opening a chat marks it read — for members AND the observing GM. An
    // "incoming" message is one this user didn't send: a member checks by
    // participant key, the GM by authorUserId (so GM-voiced NPC lines don't
    // keep the chat marked unread).
    if (isMember || isGM) {
      const lastRead = (game.user.getFlag(MODULE_ID, "lastRead") || {})[st.chatId] || 0;
      const lastOther = [...messages].reverse().find(m =>
        isGM ? m.authorUserId !== game.user.id : m.senderKey !== mine);
      if (lastOther && lastOther.ts > lastRead) await Data.markChatRead(st.chatId);
    }

    const npcParticipants = chat.participants.filter(p => p.kind === "garden")
      .map(p => ({ key: p.key, ...identities.get(p.key) }));
    if (isGM && (!st.voiceKey || !npcParticipants.some(p => p.key === st.voiceKey)) && npcParticipants.length) {
      st.voiceKey = npcParticipants[0].key;
    }
    const voice = npcParticipants.find(p => p.key === st.voiceKey) || null;

    const participants = chat.participants.map(p => ({
      key: p.key,
      kind: p.kind,
      ...identities.get(p.key),
      sub: p.kind === "player" ? (game.users.get(p.userId)?.name || "?") : "Garden"
    }));

    const addable = isGM
      ? availableParticipants(true).filter(a => !chat.participants.some(p => p.key === a.key))
      : [];
    const addableGroups = groupCandidates(addable);

    return {
      thread: true,
      pinned: messages.filter(m => m.pinned).map(m => ({ ...m, preview: (m.text || m.attachment?.title || "").slice(0, 160) })),
      reply: st.reply || null,
      muted: !!game.user.getFlag(MODULE_ID, "mutedChats")?.[st.chatId],
      isGM,
      chat,
      chatName: disp.name,
      chatImg: disp.img,
      messages,
      isMember,
      canWrite: isGM ? npcParticipants.length > 0 : isMember,
      npcParticipants,
      voice,
      voicePickerOpen: !!st.voicePickerOpen,
      voiceKey: st.voiceKey || "",
      participants,
      addable,
      addableGroups,
      showParticipants: !!st.showParticipants,
      editingChat: st.editingChat ? {
        name: chat.name || "",
        img: chat.img || ""
      } : null,
      editMsg: (isGM && st.editMsgId) ? (() => {
        const m = messages.find(x => x.id === st.editMsgId);
        if (!m) return null;
        // build a YYYY-MM-DDTHH:mm string in local time for <input datetime-local>
        const d = new Date(m.ts);
        const pad = (n) => String(n).padStart(2, "0");
        const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return { text: m.text || "", tsLocal: local };
      })() : null,
      attachment: st.attachment || null,
      attachmentLabel: st.attachment?.src || st.attachment?.title || (st.attachment?.kind === "shard" ? shards.find(s => s.id === st.attachment.id)?.title || loc("AGENTOS.Notifications.Category.shard") : st.attachment?.kind === "contact" ? contacts.find(c => c.id === st.attachment.id)?.name || loc("AGENTOS.Notifications.Category.contactShared") : st.attachment?.kind === "item" ? loc("AGENTOS.App.store") : st.attachment?.kind === "coordinates" ? `${st.attachment.x}, ${st.attachment.y}` : ""),
      uploading: !!st.uploading,
      uploadFailed: !!st.pendingUpload && !st.uploading,
      sending: !!st.sending,
      messageQuery: st.messageQuery || "",
      searchOpen: !!st.searchOpen,
      showLatest: st.followTail === false,
      draft: st.draft || ""
    };
  }

  /* ---- chat list ---- */
  const uid = game.user.id;
  const unreads = Data.unreadCounts();
  const rawChats = isGM ? Data.allChats() : Data.chatsForUser(uid);
  const chats = rawChats.map(c => {
    const disp = chatDisplay(c);
    const last = Data.getLastMessage(c.id);
    return {
      id: c.id,
      name: disp.name,
      img: disp.img,
      lastText: last ? (last.text || "📎") : "",
      draftText: drafts.get(draftKey(c.id))?.draft || "",
      lastTs: last?.ts || c.ts,
      unread: unreads[c.id] || 0,
      count: c.participants.length,
      folderId: (c.folderIds || {})[uid] || null
    };
  });

  /* Group chats into the viewer's folders; unfiled chats sit at the root.
   * A folder carries the sum of unread counts of the chats inside it. */
  const query = (st.chatQuery || "").trim().toLocaleLowerCase();
  const shown = query ? chats.filter(c => `${c.name} ${c.lastText}`.toLocaleLowerCase().includes(query)) : chats;
  const myFolders = (Data.getWorld("chatFolders") || []).filter(f => f.ownerUserId === uid);
  const collapsed = st.collapsed || {};
  const folders = myFolders
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(f => {
      const items = shown.filter(c => c.folderId === f.id);
      return {
        id: f.id, name: f.name,
        collapsed: query ? false : !!collapsed[f.id],
        chats: items,
        count: items.length,
        unread: chats.filter(c => c.folderId === f.id).reduce((n, c) => n + c.unread, 0)
      };
    }).filter(f => !query || f.count > 0);
  const rootChats = shown.filter(c => !c.folderId || !myFolders.some(f => f.id === c.folderId));

  return {
    thread: false,
    isGM,
    hasChats: chats.length > 0,
    chatQuery: st.chatQuery || "",
    noMatches: !!query && shown.length === 0,
    folders,
    rootChats,
    creating: !!st.creating,
    newChatName: st.newChatName || "",
    candidateGroups: st.creating ? groupCandidates(
      availableParticipants(isGM).map(c => ({
        ...c, selected: (st.selectedKeys || []).includes(c.key)
      })),
      st.candCollapsed || {}
    ) : [],
    canCreate: isGM || !!game.user.character,
    noActor: !isGM && !game.user.character
  };
}

export function activateListeners(app, html) {
  const st = app.state;
  const isGM = game.user.isGM;
  html.on("click", "[data-action='chat-upload-retry']", () => {
    if (st.pendingUpload) uploadAttachment(app, st, st.pendingUpload.file, st.pendingUpload.kind);
  });
  const messageFor = ev => Data.getMessages(st.chatId).find(m => m.id === ev.currentTarget.dataset.msgId);
  html.on("click", "[data-action='msg-reply']", ev => {
    const msg = messageFor(ev);
    if (!msg) return;
    st.reply = { id: msg.id, text: msg.text || msg.attachment?.title || "", name: Data.participantIdentity(Data.getChat(st.chatId), msg.senderKey).name };
    st.composeFocus = true; rememberDraft(st); app.render(false);
  });
  html.on("click", "[data-action='reply-clear']", () => { st.reply = null; app.render(false); });
  html.on("click", "[data-action='msg-jump']", ev => {
    const row = [...html.find(".agentos-msg-row")].find(e => e.dataset.msgId === ev.currentTarget.dataset.msgId);
    if (row) { st.followTail = false; row.scrollIntoView({ block: "center" }); row.classList.add("search-match"); }
    else ui.notifications.info(loc("AGENTOS.Chat.OriginalMissing"));
  });
  html.on("click", "[data-action='msg-react']", ev => {
    const msg = messageFor(ev), reaction = ev.currentTarget.dataset.reaction;
    if (msg) app.mutate("msg.react", { chatId: st.chatId, msgId: msg.id, reaction, active: !msg.reactions?.[reaction]?.includes(game.user.id) });
  });
  html.on("click", "[data-action='msg-pin']", ev => {
    const msg = messageFor(ev);
    if (msg && isGM) app.mutate("msg.pin", { chatId: st.chatId, msgId: msg.id, pinned: !msg.pinned });
  });
  html.on("click", "[data-action='chat-mute']", async () => {
    const muted = game.user.getFlag(MODULE_ID, "mutedChats")?.[st.chatId];
    await game.user.setFlag(MODULE_ID, `mutedChats.${st.chatId}`, !muted); app.render(false);
  });
  html.on("click", "[data-action='card-import']", async ev => {
    await app.mutate("msg.importAttachment", { chatId: st.chatId, msgId: ev.currentTarget.dataset.msgId }); app.render(false);
  });
  html.on("click", "[data-action='card-open']", async ev => {
    const attachment = messageFor(ev)?.attachment;
    if (!attachment) return;
    if (attachment.kind === "coordinates") { app.openSideApp?.("map", { focusX: attachment.x, focusY: attachment.y }); return; }
    if (attachment.kind === "item") {
      const doc = await fromUuid(attachment.uuid).catch(() => null);
      if (!doc || (!isGM && !doc.testUserPermission?.(game.user, "OBSERVER"))) return ui.notifications.warn(loc("AGENTOS.Chat.OriginalMissing"));
      doc.sheet.render(true); return;
    }
    const snapshot = attachment.snapshot;
    if (!snapshot) return;
    if (attachment.kind === "shard") { new ShardReader(snapshot).render(true); return; }
    const content = document.createElement("div");
    const text = document.createElement("pre"); text.style.whiteSpace = "pre-wrap"; text.textContent = [snapshot.name, snapshot.note, snapshot.address].filter(Boolean).join("\n"); content.append(text);
    const dialog = new Dialog({ title: attachment.title, content: "<div class='agentos-card-preview'></div>", buttons: { close: { label: loc("AGENTOS.Common.Close") } }, render: h => h.find(".agentos-card-preview")[0].append(content) });
    dialog.render(true);
  });

  html.on("input", "[name='chat-search']", foundry.utils.debounce(ev => {
    if (app.state !== st) return;
    st.chatQuery = ev.target.value;
    st.searchFocus = true;
    st.searchCaret = ev.target.selectionStart;
    app.render(false);
  }, 180));
  const chatSearch = html.find("[name='chat-search']")[0];
  if (chatSearch && st.searchFocus && !st.creating) {
    chatSearch.focus({ preventScroll: true });
    chatSearch.setSelectionRange(st.searchCaret ?? chatSearch.value.length, st.searchCaret ?? chatSearch.value.length);
  }
  html.on("blur", "[name='chat-search']", ev => { if (ev.target.isConnected) st.searchFocus = false; });

  /* ---- list ---- */
  html.on("click", "[data-action='chat-open']", (ev) => {
    app.state = { chatId: ev.currentTarget.dataset.chatId };
    AgentAudio.play("tap");
    app.render(false);
  });

  /* ---- chat folders ---- */

  html.on("click", "[data-action='chat-folder-toggle']", (ev) => {
    ev.stopPropagation();
    const id = ev.currentTarget.dataset.folderId;
    st.collapsed = st.collapsed || {};
    st.collapsed[id] = !st.collapsed[id];
    app.render(false);
  });

  html.on("click", "[data-action='chat-folder-new']", async (ev) => {
    ev.stopPropagation();
    const name = await app.promptText(loc("AGENTOS.Chat.NewFolder"), "", loc("AGENTOS.Chat.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    await app.mutate("chatFolder.create", { name: name.trim() });
    app.render(false);
  });

  html.on("click", "[data-action='chat-folder-rename']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    const cur = (Data.getWorld("chatFolders") || []).find(f => f.id === folderId);
    const name = await app.promptText(loc("AGENTOS.Chat.RenameFolder"), cur?.name || "", loc("AGENTOS.Chat.FolderName"));
    if (name === null || !name.trim()) return;
    AgentAudio.play("tap");
    await app.mutate("chatFolder.rename", { folderId, name: name.trim() });
    app.render(false);
  });

  html.on("click", "[data-action='chat-folder-delete']", async (ev) => {
    ev.stopPropagation();
    const folderId = ev.currentTarget.dataset.folderId;
    if (!(await app.confirm(loc("AGENTOS.Chat.DeleteFolderConfirm")))) return;
    AgentAudio.play("tap");
    await app.mutate("chatFolder.delete", { folderId });
    app.render(false);
  });

  /* Drag a chat row onto a folder header (or the root) to file it. */
  html.on("dragstart", "[data-chat-drag]", (ev) => {
    ev.stopPropagation();
    ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({ chat: ev.currentTarget.dataset.chatDrag }));
    ev.originalEvent.dataTransfer.effectAllowed = "move";
  });
  const drops = html.find("[data-chat-drop]");
  drops.on("dragover", (ev) => { ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.classList.add("drop-over"); });
  drops.on("dragleave", (ev) => ev.currentTarget.classList.remove("drop-over"));
  drops.on("drop", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.classList.remove("drop-over");
    let data;
    try { data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain")); } catch (e) { return; }
    if (!data.chat) return;
    const folderId = ev.currentTarget.dataset.chatDrop || "";   // "" = root
    AgentAudio.play("tap");
    await app.mutate("chat.setFolder", { chatId: data.chat, folderId });
    app.render(false);
  });

  /* Open a chat image (incl. animated gif/webp) in Foundry's image viewer. */
  html.on("click", "[data-action='chat-open-image']", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const src = ev.currentTarget.dataset.src;
    if (!src) return;
    AgentAudio.play("tap");
    new ImagePopout(src, { title: "", shareable: true }).render(true);
  });

  html.on("click", "[data-action='chat-new']", () => {
    st.creating = true;
    st.selectedKeys = [];
    app.render(false);
  });

  html.on("click", "[data-action='chat-new-cancel']", () => {
    st.creating = false;
    app.render(false);
  });

  html.on("input", "[name='new-chat-name']", (ev) => {
    st.newChatName = ev.currentTarget.value;
  });

  html.on("click", "[data-action='chat-cand-folder']", (ev) => {
    const id = ev.currentTarget.dataset.folderId;
    st.candCollapsed = st.candCollapsed || {};
    st.candCollapsed[id] = !st.candCollapsed[id];
    st.newChatName = String(html.find("[name='new-chat-name']").val() || "");
    app.render(false);
  });

  html.on("click", "[data-action='chat-toggle-candidate']", (ev) => {
    const key = ev.currentTarget.dataset.key;
    st.selectedKeys = st.selectedKeys || [];
    if (st.selectedKeys.includes(key)) st.selectedKeys = st.selectedKeys.filter(k => k !== key);
    else st.selectedKeys.push(key);
    st.newChatName = String(html.find("[name='new-chat-name']").val() || "");
    app.render(false);
  });

  html.on("click", "[data-action='chat-create']", async (ev) => {
    ev.preventDefault();
    const name = String(html.find("[name='new-chat-name']").val() || "").trim();
    const keys = st.selectedKeys || [];
    if (!keys.length) return AgentAudio.play("error");
    st.newChatName = name;
    const result = await app.mutate("chat.create", { name, participantKeys: keys });
    if (typeof result === "string") {
      st.creating = false; st.selectedKeys = []; st.newChatName = "";
      app.openChatThread(result);
      app.render(false);
    }
  });

  html.on("click", "[data-action='chat-delete']", async (ev) => {
    ev.stopPropagation();
    const chatId = ev.currentTarget.dataset.chatId;
    if (!(await app.confirm(loc("AGENTOS.Chat.DeleteChat")))) return;
    await app.mutate("chat.delete", { chatId });
  });

  /* ---- thread ---- */
  html.on("click", "[data-action='chat-back']", () => {
    app.state = {};
    AgentAudio.play("tap");
    app.render(false);
  });

  const doSend = async () => {
    if (st.sending || st.uploading) return;
    const ta = html.find("[name='chat-input']");
    const text = String(ta.val() || "").trim();
    const attachment = st.attachment || null;
    if (!text && !attachment) return;
    const senderKey = isGM ? st.voiceKey : myKey();
    if (!senderKey) return AgentAudio.play("error");
    const draft = String(ta.val() || "");
    st.draft = draft;
    st.sending = true;
    rememberDraft(st);
    AgentAudio.play("tap");
    app.render(false);
    const result = await app.mutate("msg.send", { chatId: st.chatId, senderKey, text, attachment, replyTo: st.reply?.id || null });
    const current = drafts.get(draftKey(st.chatId)) || st;
    current.sending = false;
    if (result) {
      current.reply = null;
      if (current.draft === draft) current.draft = "";
      if (current.attachment === attachment) current.attachment = null;
      current.followTail = true;
    } else ui.notifications.warn(loc("AGENTOS.Chat.SendUnconfirmed"));
    rememberDraft(current);
    if (app.state === current) app.render(false);
  };

  html.on("click", "[data-action='chat-send']", doSend);
  html.on("keydown", "[name='chat-input']", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      doSend();
    }
  });
  html.on("input", "[name='chat-input']", (ev) => {
    st.draft = ev.currentTarget.value;
    st.composeFocus = true;
    st.composeSelection = [ev.currentTarget.selectionStart, ev.currentTarget.selectionEnd];
    rememberDraft(st);
  });

  /* Paste an image straight from the clipboard (Ctrl+V) into the input. */
  html.on("paste", "[name='chat-input']", async (ev) => {
    const items = ev.originalEvent?.clipboardData?.items || ev.clipboardData?.items;
    if (!items) return;
    const imgItem = [...items].find(i => i.kind === "file" && i.type.startsWith("image/"));
    if (!imgItem) return;                    // plain text paste — let it through
    ev.preventDefault();
    const blob = imgItem.getAsFile();
    if (!blob) return;
    const ext = (blob.type.split("/")[1] || "png").replace(/[^\w]/g, "");
    const file = new File([blob], `clipboard-${Date.now()}.${ext}`, { type: blob.type });
    st.draft = String(html.find("[name='chat-input']").val() || "");
    st.composeFocus = true;
    await uploadAttachment(app, st, file, "image");
  });

  if (st.composeFocus) {
    const ta = html.find("[name='chat-input']")[0];
    if (ta) {
      ta.focus();
      try { ta.setSelectionRange(...(st.composeSelection || [ta.value.length, ta.value.length])); } catch (e) { /* noop */ }
    }
  }

  html.on("click", "[data-action='chat-attach']", async (ev) => {
    const kind = ev.currentTarget.dataset.kind; // image | audio | video
    const fpType = kind === "image" ? "image" : (kind === "audio" ? "audio" : "video");
    const path = await app.pickFile(fpType);
    if (!path) return;
    const current = drafts.get(draftKey(st.chatId)) || st;
    current.attachment = { kind, src: path };
    rememberDraft(current);
    if (app.state === current) app.render(false);
  });

  html.on("click", "[data-action='chat-attach-clear']", () => {
    st.attachment = null;
    rememberDraft(st);
    app.render(false);
  });

  /* Drag & drop an OS media file anywhere onto the open thread — it is
   * uploaded to the module folder and attached to the next message. */
  const threadEl = html.find(".agentos-thread")[0];
  if (threadEl) {
    threadEl.addEventListener("dragover", (ev) => {
      if (ev.dataTransfer?.types?.includes("Files") || ev.dataTransfer?.types?.includes("text/plain")) {
        ev.preventDefault();
        threadEl.classList.add("drop-over");
      }
    });
    threadEl.addEventListener("dragleave", (ev) => {
      if (ev.target === threadEl) threadEl.classList.remove("drop-over");
    });
    threadEl.addEventListener("drop", async (ev) => {
      threadEl.classList.remove("drop-over");
      const file = ev.dataTransfer?.files?.[0];
      if (!file) {
        ev.preventDefault(); ev.stopPropagation();
        try {
          const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
          const kind = data.type === "Item" ? "item" : data.kind || (data.shard ? "shard" : data.contact ? "contact" : "");
          if (!["shard", "contact", "coordinates", "item"].includes(kind)) return;
          st.attachment = { kind, id: data.id || data.shard || data.contact, uuid: data.uuid, x: data.x, y: data.y };
          rememberDraft(st); app.render(false);
        } catch { AgentAudio.play("error"); }
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      const kind = file.type.startsWith("audio/") ? "audio"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("image/") ? "image" : null;
      if (!kind) return AgentAudio.play("error");
      await uploadAttachment(app, st, file, kind);
    });
  }

  html.on("click", "[data-action='voice-toggle']", () => {
    st.voicePickerOpen = !st.voicePickerOpen;
    app.render(false);
  });

  html.on("click", "[data-action='voice-pick']", (ev) => {
    st.voiceKey = ev.currentTarget.dataset.key;
    st.voicePickerOpen = false;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='chat-call']", async () => {
    const chat = Data.getChat(st.chatId);
    if (!chat) return;
    const targets = chat.participants.filter(p => p.kind === "player" && p.actorUuid);
    if (targets.length) triggerCall(targets.map(p => p.actorUuid), st.chatId);
    AgentAudio.play("tap");
    // Announce the call in the Foundry chat log. Names are resolved through
    // participantIdentity, so the GM's per-chat renames win over real names.
    const callerKey = isGM ? st.voiceKey : myKey();
    const callerName = callerKey
      ? Data.participantIdentity(chat, callerKey).name
      : (isGM ? "???" : Data.playerIdentity(game.user.id).name);
    const targetNames = chat.participants
      .filter(p => p.key !== callerKey)
      .map(p => Data.participantIdentity(chat, p.key).name)
      .join(", ") || "—";
    // Whispered to everyone EXCEPT the caller — the initiator gets no ping.
    await ChatMessage.create({
      content: `<p><i class="fas fa-phone"></i> ${Handlebars.escapeExpression(
        loc("AGENTOS.Chat.CallAnnounce", { caller: callerName, target: targetNames })
      )}</p>`,
      whisper: game.users.filter(u => u.id !== game.user.id).map(u => u.id)
    });
  });

  /* GM right-clicks a message → context menu: Edit / Delete. */
  if (isGM) {
    html.on("contextmenu", ".agentos-msg-row[data-msg-id]", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const msgId = ev.currentTarget.dataset.msgId;
      const body = html.find(".agentos-app-body")[0];
      if (!body) return;
      body.querySelector(".agentos-ctx-menu")?.remove();

      const zoom = app.zoom || 1;
      const rect = body.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.className = "agentos-ctx-menu";

      const mkItem = (icon, label, danger, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "agentos-ctx-item" + (danger ? " danger" : "");
        b.innerHTML = `<i class="fas ${icon}"></i> ${Handlebars.escapeExpression(label)}`;
        b.addEventListener("click", fn);
        return b;
      };

      menu.appendChild(mkItem("fa-pen", loc("AGENTOS.Common.Edit"), false, () => {
        menu.remove();
        st.editMsgId = msgId;
        app.render(false);
      }));
      menu.appendChild(mkItem("fa-trash", loc("AGENTOS.Common.Delete"), true, async () => {
        menu.remove();
        if (!(await app.confirm(loc("AGENTOS.Chat.DeleteMessage")))) return;
        await app.mutate("msg.delete", { chatId: st.chatId, msgId });
      }));
      body.appendChild(menu);

      // position at the cursor (convert viewport px → zoomed local px),
      // clamped so the menu never leaves the screen area
      let x = (ev.clientX - rect.left) / zoom + body.scrollLeft;
      let y = (ev.clientY - rect.top) / zoom + body.scrollTop;
      x = Math.min(x, body.scrollLeft + body.clientWidth - menu.offsetWidth - 6);
      y = Math.min(y, body.scrollTop + body.clientHeight - menu.offsetHeight - 6);
      menu.style.left = `${Math.max(2, x)}px`;
      menu.style.top = `${Math.max(2, y)}px`;

      const dismiss = (e) => {
        if (menu.contains(e.target)) return;
        menu.remove();
        document.removeEventListener("pointerdown", dismiss, true);
      };
      document.addEventListener("pointerdown", dismiss, true);
    });

    html.on("click", "[data-action='msg-edit-cancel']", () => {
      st.editMsgId = null;
      app.render(false);
    });

    html.on("click", "[data-action='msg-edit-save']", async () => {
      const msgId = st.editMsgId;
      const text = String(html.find("[name='msg-edit-text']").val() || "");
      const dt = String(html.find("[name='msg-edit-ts']").val() || "");
      st.editMsgId = null;
      AgentAudio.play("tap");
      app.render(false);
      // datetime-local → epoch ms (local time); blank keeps the original ts
      const ts = dt ? new Date(dt).getTime() : undefined;
      await app.mutate("msg.edit", { chatId: st.chatId, msgId, text, ts });
    });
  }

  /* ---- participants panel (GM) ---- */
  html.on("click", "[data-action='chat-participants']", () => {
    st.showParticipants = !st.showParticipants;
    app.render(false);
  });

  html.on("click", "[data-action='part-rename']", async (ev) => {
    const key = ev.currentTarget.dataset.key;
    const chat = Data.getChat(st.chatId);
    const current = Data.participantIdentity(chat, key).name;
    const name = await app.promptText(loc("AGENTOS.Chat.RenameParticipant"), current);
    if (name === null) return;
    await app.mutate("chat.updateParticipant", { chatId: st.chatId, key, nameOverride: name });
  });

  html.on("click", "[data-action='part-reimg']", async (ev) => {
    const key = ev.currentTarget.dataset.key;
    const path = await app.pickFile("image");
    if (path === null) return;
    await app.mutate("chat.updateParticipant", { chatId: st.chatId, key, imgOverride: path });
  });

  html.on("click", "[data-action='part-reimg-clear']", async (ev) => {
    const key = ev.currentTarget.dataset.key;
    await app.mutate("chat.updateParticipant", { chatId: st.chatId, key, imgOverride: "", nameOverride: "" });
  });

  html.on("click", "[data-action='part-remove']", async (ev) => {
    const key = ev.currentTarget.dataset.key;
    if (!(await app.confirm(loc("AGENTOS.Chat.RemoveParticipant")))) return;
    await app.mutate("chat.removeParticipant", { chatId: st.chatId, key });
  });

  html.on("change", "[name='chat-add-participant']", async (ev) => {
    const key = ev.currentTarget.value;
    if (!key) return;
    await app.mutate("chat.addParticipant", { chatId: st.chatId, key });
  });

  /* Styled edit-chat modal: rename + change picture. */
  html.on("click", "[data-action='chat-rename']", () => {
    st.editingChat = true;
    app.render(false);
  });

  html.on("click", "[data-action='chat-edit-cancel']", () => {
    st.editingChat = false;
    app.render(false);
  });

  html.on("click", "[data-action='chat-edit-img']", async () => {
    const path = await app.pickFile("image");
    if (path === null) return;
    st.editChatImg = path;
    // reflect immediately in the preview without closing the modal
    html.find(".agentos-chatedit-preview img").attr("src", path || "icons/svg/mystery-man.svg");
    html.find("[name='chat-edit-img']").val(path);
  });

  html.on("click", "[data-action='chat-edit-img-clear']", () => {
    st.editChatImg = "";
    html.find(".agentos-chatedit-preview img").attr("src", "icons/svg/mystery-man.svg");
    html.find("[name='chat-edit-img']").val("");
  });

  html.on("click", "[data-action='chat-edit-save']", async () => {
    const name = String(html.find("[name='chat-edit-name']").val() || "").trim();
    const img = String(html.find("[name='chat-edit-img']").val() || "").trim();
    st.editingChat = false;
    st.editChatImg = undefined;
    AgentAudio.play("tap");
    app.render(false);
    await app.mutate("chat.rename", { chatId: st.chatId, name, img });
  });

  const scroller = html.find(".agentos-chat-scroll")[0];
  if (scroller) {
    const latest = html.find("[data-action='chat-latest']")[0];
    const tail = () => { st.followTail = true; scroller.scrollTop = scroller.scrollHeight; if (latest) latest.hidden = true; };
    if (st.followTail === false) scroller.scrollTop = st.threadScroll || 0;
    else tail();
    scroller.addEventListener("scroll", () => {
      st.threadScroll = scroller.scrollTop;
      st.followTail = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 48;
      if (latest) latest.hidden = st.followTail;
    });
    for (const event of ["load", "loadedmetadata"]) scroller.addEventListener(event, ev => {
      if (st.followTail !== false && ev.target.matches(".agentos-attach-img, .agentos-attach-audio, .agentos-attach-video")) tail();
    }, true);
    html.on("click", "[data-action='chat-latest']", tail);

    let matches = [], match = st.messageMatch || 0, searchRows = null;
    const search = html.find("[name='message-search']")[0];
    const counter = html.find(".agentos-chat-match-count")[0];
    const find = (jump = true) => {
      const query = (search?.value || "").trim().toLocaleLowerCase();
      st.messageQuery = search?.value || "";
      for (const row of matches) row.classList.remove("search-match");
      matches = [];
      if (query) {
        searchRows ??= [...scroller.querySelectorAll(".agentos-msg-row")].map(row => ({ row, text: row.textContent.toLocaleLowerCase() }));
        for (const { row, text } of searchRows) if (text.includes(query)) {
          row.classList.add("search-match");
          matches.push(row);
        }
      }
      match = Math.min(match, Math.max(0, matches.length - 1));
      st.messageMatch = match;
      if (counter) counter.textContent = matches.length ? `${match + 1}/${matches.length}` : "0/0";
      if (jump && matches[match]) matches[match].scrollIntoView({ block: "center" });
    };
    html.on("click", "[data-action='chat-search-toggle']", () => {
      st.searchOpen = !st.searchOpen;
      html.find(".agentos-message-search")[0].hidden = !st.searchOpen;
      if (st.searchOpen) search?.focus();
      else { search.value = ""; find(false); }
    });
    html.on("input", "[name='message-search']", () => { match = 0; find(); });
    html.on("click", "[data-action='chat-search-step']", ev => {
      if (!matches.length) return;
      match = (match + Number(ev.currentTarget.dataset.step) + matches.length) % matches.length;
      find();
    });
    find(false);
  }
}
