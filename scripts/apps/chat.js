/* Messenger app. Conversations happen between CHARACTERS:
 * player participants are the users' assigned actors (shown under their
 * proxy ID when set), NPC participants are Garden contacts. The GM observes
 * every chat without being a member and may speak as any NPC participant. */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";
import { triggerCall } from "../vfx.js";

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
    const chat = openChat;
    const disp = chatDisplay(chat);
    const mine = myKey();
    const isMember = chat.participants.some(p => p.key === mine);
    const messages = Data.getMessages(st.chatId).map(m => {
      const live = chat.participants.some(p => p.key === m.senderKey)
        ? Data.participantIdentity(chat, m.senderKey)
        : { name: m.senderName, img: m.senderImg };
      return {
        ...m,
        name: live.name,
        img: live.img,
        isSelf: !isGM && m.senderKey === mine
      };
    });
    if (isMember) {
      const lastRead = (game.user.getFlag(MODULE_ID, "lastRead") || {})[st.chatId] || 0;
      const lastOther = [...messages].reverse().find(m => m.senderKey !== mine);
      if (lastOther && lastOther.ts > lastRead) await Data.markChatRead(st.chatId);
    }

    const npcParticipants = chat.participants.filter(p => p.kind === "garden")
      .map(p => ({ key: p.key, ...Data.participantIdentity(chat, p.key) }));
    if (isGM && (!st.voiceKey || !npcParticipants.some(p => p.key === st.voiceKey)) && npcParticipants.length) {
      st.voiceKey = npcParticipants[0].key;
    }
    const voice = npcParticipants.find(p => p.key === st.voiceKey) || null;

    const participants = chat.participants.map(p => ({
      key: p.key,
      kind: p.kind,
      ...Data.participantIdentity(chat, p.key),
      sub: p.kind === "player" ? (game.users.get(p.userId)?.name || "?") : "Garden"
    }));

    const addable = isGM
      ? availableParticipants(true).filter(a => !chat.participants.some(p => p.key === a.key))
      : [];
    const addableGroups = groupCandidates(addable);

    return {
      thread: true,
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
        const m = Data.getMessages(st.chatId).find(x => x.id === st.editMsgId);
        if (!m) return null;
        // build a YYYY-MM-DDTHH:mm string in local time for <input datetime-local>
        const d = new Date(m.ts);
        const pad = (n) => String(n).padStart(2, "0");
        const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return { text: m.text || "", tsLocal: local };
      })() : null,
      attachment: st.attachment || null,
      uploading: !!st.uploading,
      draft: st.draft || ""
    };
  }

  /* ---- chat list ---- */
  const unreads = Data.unreadCounts();
  const chats = (isGM ? Data.allChats() : Data.chatsForUser(game.user.id)).map(c => {
    const disp = chatDisplay(c);
    const msgs = Data.getMessages(c.id);
    const last = msgs[msgs.length - 1];
    return {
      id: c.id,
      name: disp.name,
      img: disp.img,
      lastText: last ? (last.text || "📎") : "",
      lastTs: last?.ts || c.ts,
      unread: unreads[c.id] || 0,
      count: c.participants.length
    };
  });

  return {
    thread: false,
    chats,
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

  /* ---- list ---- */
  html.on("click", "[data-action='chat-open']", (ev) => {
    app.state = { chatId: ev.currentTarget.dataset.chatId };
    AgentAudio.play("tap");
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
    st.creating = false;
    st.selectedKeys = [];
    st.newChatName = "";
    app.render(false);                       // optimistic: close the modal now
    const result = await app.mutate("chat.create", { name, participantKeys: keys });
    if (typeof result === "string") {
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

  const doSend = () => {
    const ta = html.find("[name='chat-input']");
    const text = String(ta.val() || "").trim();
    const attachment = st.attachment || null;
    if (!text && !attachment) return;
    const senderKey = isGM ? st.voiceKey : myKey();
    if (!senderKey) return AgentAudio.play("error");
    st.attachment = null;
    st.draft = "";
    ta.val("");
    AgentAudio.play("tap");
    app.render(false);                       // clear the attachment chip now
    app.mutate("msg.send", { chatId: st.chatId, senderKey, text, attachment });
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
    st.uploading = true;
    app.render(false);
    const path = await app.uploadFile(file);
    st.uploading = false;
    if (path) st.attachment = { kind: "image", src: path };
    app.render(false);
  });

  html.find("[name='chat-input']").on("blur", () => { st.composeFocus = false; });
  if (st.composeFocus) {
    const ta = html.find("[name='chat-input']")[0];
    if (ta) {
      ta.focus();
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* noop */ }
    }
  }

  html.on("click", "[data-action='chat-attach']", async (ev) => {
    const kind = ev.currentTarget.dataset.kind; // image | audio | video
    const fpType = kind === "image" ? "image" : (kind === "audio" ? "audio" : "video");
    const path = await app.pickFile(fpType);
    if (!path) return;
    st.attachment = { kind, src: path };
    app.render(false);
  });

  html.on("click", "[data-action='chat-attach-clear']", () => {
    st.attachment = null;
    app.render(false);
  });

  /* Drag & drop an OS media file anywhere onto the open thread — it is
   * uploaded to the module folder and attached to the next message. */
  const threadEl = html.find(".agentos-thread")[0];
  if (threadEl) {
    threadEl.addEventListener("dragover", (ev) => {
      if (ev.dataTransfer?.types?.includes("Files")) {
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
      if (!file) return;
      ev.preventDefault();
      ev.stopPropagation();
      const kind = file.type.startsWith("audio/") ? "audio"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("image/") ? "image" : null;
      if (!kind) return AgentAudio.play("error");
      st.uploading = true;
      app.render(false);
      const path = await app.uploadFile(file);
      st.uploading = false;
      if (path) st.attachment = { kind, src: path };
      app.render(false);
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
    if (targets.length) triggerCall(targets.map(p => p.actorUuid));
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

  /* keep the thread scrolled to the newest message */
  const scroller = html.find(".agentos-chat-scroll")[0];
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}
