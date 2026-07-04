/* World data layer.
 *
 * All shared state lives in world-scoped settings (type Object). Only a GM
 * client may write them, so player mutations are relayed over the module
 * socket to the primary GM, who validates and applies them. Every write
 * triggers the core `updateSetting` broadcast, which re-renders open Agents
 * on all clients — no manual refresh fan-out is needed for data changes.
 */

import { MODULE_ID, SOCKET_NAME, PACK_CATEGORIES, uid } from "./constants.js";

/* ------------------------------------------------------------------ */
/* Generic access                                                      */
/* ------------------------------------------------------------------ */

export function getWorld(key) {
  try { return foundry.utils.deepClone(game.settings.get(MODULE_ID, key)); }
  catch (e) { return null; }
}

async function setWorld(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

/** Direct world write — GM-only callers only (e.g. the library downloader). */
export async function setWorldGM(key, value) {
  if (!game.user.isGM) return false;
  await setWorld(key, value);
  return true;
}

export function primaryGM() {
  return game.users.filter(u => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

export function isPrimaryGM() {
  return primaryGM()?.id === game.user.id;
}

/** Pending player-side mutation requests awaiting the GM's result. */
const _pendingMutations = new Map(); // requestId -> resolve

/** Mutate shared world data. GMs apply locally; players relay to the GM and
 *  await the GM's result over the socket (10s timeout → null). */
export async function mutate(op, payload = {}) {
  if (game.user.isGM) {
    return applyOp(op, payload, game.user.id);
  }
  const gm = primaryGM();
  if (!gm) {
    ui.notifications.warn(game.i18n.localize("AGENTOS.Notify.NoGm"));
    return false;
  }
  const requestId = foundry.utils.randomID(10);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (_pendingMutations.delete(requestId)) resolve(null);
    }, 10000);
    _pendingMutations.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    game.socket.emit(SOCKET_NAME, { action: "mutate", op, payload, userId: game.user.id, requestId });
  });
}

/** Called by the socket router when the GM reports a mutation result. */
export function resolveMutation(requestId, result) {
  const resolve = _pendingMutations.get(requestId);
  if (!resolve) return;
  _pendingMutations.delete(requestId);
  resolve(result);
}

/* ------------------------------------------------------------------ */
/* Identity helpers                                                    */
/* ------------------------------------------------------------------ */

export function playerCharacter(userId) {
  return game.users.get(userId)?.character ?? null;
}

export function idProfile(userId) {
  const all = getWorld("idProfiles") || {};
  return all[userId] || {};
}

/** Public identity of a player's character: proxy ID if set, else the actor. */
export function playerIdentity(userId) {
  const prof = idProfile(userId);
  const actor = playerCharacter(userId);
  return {
    name: prof.proxyName || actor?.name || game.users.get(userId)?.name || "???",
    img: prof.proxyImg || actor?.img || "icons/svg/mystery-man.svg",
    isProxy: !!prof.proxyName
  };
}

export function gardenContact(gardenId) {
  return (getWorld("gardenContacts") || []).find(c => c.id === gardenId) ?? null;
}

/** Resolve a chat participant to display identity (chat overrides win). */
export function participantIdentity(chat, key) {
  const p = (chat?.participants || []).find(x => x.key === key);
  if (!p) return { name: "???", img: "icons/svg/mystery-man.svg" };
  let base = { name: "???", img: "icons/svg/mystery-man.svg" };
  if (p.kind === "player") base = playerIdentity(p.userId);
  else if (p.kind === "garden") {
    const g = gardenContact(p.gardenId);
    if (g) base = { name: g.name, img: g.img || "icons/svg/mystery-man.svg" };
    else base = { name: p.nameOverride || "???", img: p.imgOverride || "icons/svg/mystery-man.svg" };
  }
  return {
    name: p.nameOverride || base.name,
    img: p.imgOverride || base.img
  };
}

export function participantKeyForUser(userId) {
  return `player:${userId}`;
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                        */
/* ------------------------------------------------------------------ */

export function allChats() {
  return Object.values(getWorld("agentChats") || {}).sort((a, b) => (b.lastTs || b.ts) - (a.lastTs || a.ts));
}

export function chatsForUser(userId) {
  const key = participantKeyForUser(userId);
  return allChats().filter(c => (c.participants || []).some(p => p.key === key));
}

export function getChat(chatId) {
  return (getWorld("agentChats") || {})[chatId] ?? null;
}

export function getMessages(chatId) {
  return ((getWorld("agentMessages") || {})[chatId] || []);
}

export function visibleGardenContacts(forGM = false) {
  const list = getWorld("gardenContacts") || [];
  return forGM ? list : list.filter(c => c.visible);
}

export function shardsForUser(userId, isGM) {
  const list = getWorld("agentShards") || [];
  if (isGM) return list;
  // Players: their own ORIGINALS (editable) + copies delivered to them.
  return list.filter(s =>
    (s.createdBy === userId && !s.isCopy) ||
    (s.recipients && s.recipients[userId])
  );
}

export function contactsForUser(userId, isGM) {
  const list = getWorld("personalContacts") || [];
  if (isGM) return list;
  return list.filter(c => c.ownerUserId === userId || (c.sharedWith || []).includes(userId));
}

export function unreadCounts() {
  const lastRead = game.user.getFlag(MODULE_ID, "lastRead") || {};
  const selfKey = participantKeyForUser(game.user.id);
  const out = {};
  const chats = game.user.isGM ? allChats() : chatsForUser(game.user.id);
  for (const chat of chats) {
    if (game.user.isGM) { out[chat.id] = 0; continue; } // GM is an observer, no unreads
    const since = lastRead[chat.id] || 0;
    out[chat.id] = getMessages(chat.id).filter(m => m.ts > since && m.senderKey !== selfKey).length;
  }
  return out;
}

export async function markChatRead(chatId) {
  const lastRead = foundry.utils.deepClone(game.user.getFlag(MODULE_ID, "lastRead") || {});
  lastRead[chatId] = Date.now();
  await game.user.setFlag(MODULE_ID, "lastRead", lastRead);
}

/* ------------------------------------------------------------------ */
/* Wealth helpers (CPR ledger API)                                     */
/* ------------------------------------------------------------------ */

export function actorWealth(actor) {
  return Number(foundry.utils.getProperty(actor, "system.wealth.value") ?? 0);
}

/* Build regexes out of the CPR ledger sentence templates so transaction
 * lines parse correctly in whatever language the system runs in
 * (e.g. en: "{property} increased by {amount} to {total}"). */
let _ledgerPatterns = null;
function ledgerPatterns() {
  if (_ledgerPatterns) return _ledgerPatterns;
  const build = (key) => {
    const tpl = game.i18n.localize(key);
    const esc = tpl.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    return new RegExp("^" + esc
      .replace("\\{property\\}", "(?<property>.+?)")
      .replace("\\{amount\\}", "(?<amount>[\\d.,\\s]+)")
      .replace("\\{total\\}", "(?<total>[\\d.,\\s-]+)")
      .replace(/\{property\}/, "(?<property>.+?)")
      .replace(/\{amount\}/, "(?<amount>[\\d.,\\s]+)")
      .replace(/\{total\}/, "(?<total>[\\d.,\\s-]+)") + "$");
  };
  try {
    _ledgerPatterns = {
      plus: build("CPR.ledger.increaseSentence"),
      minus: build("CPR.ledger.decreaseSentence"),
      set: build("CPR.ledger.setSentence")
    };
  } catch (e) {
    _ledgerPatterns = null;
  }
  return _ledgerPatterns;
}

/** Parse one ledger line into {kind: 'plus'|'minus'|'set'|'raw', amount, total}. */
export function parseLedgerText(text) {
  const pats = ledgerPatterns();
  const num = (s) => Number(String(s ?? "").replace(/[^\d-]/g, "")) || 0;
  if (pats) {
    for (const kind of ["plus", "minus", "set"]) {
      const m = String(text).match(pats[kind]);
      if (m) {
        return {
          kind,
          amount: kind === "set" ? num(m.groups?.total) : num(m.groups?.amount),
          total: num(m.groups?.total)
        };
      }
    }
  }
  return { kind: "raw", amount: 0, total: 0 };
}

export function actorTransactions(actor) {
  const recs = (typeof actor?.listRecords === "function" ? actor.listRecords("wealth") : null)
    ?? foundry.utils.getProperty(actor, "system.wealth.transactions") ?? [];
  return recs.map(r => {
    const text = Array.isArray(r) ? r[0] : String(r);
    const reason = Array.isArray(r) ? (r[1] || "") : "";
    return { text, reason, ...parseLedgerText(text) };
  }).reverse();
}

async function deltaWealth(actor, amount, reason) {
  if (typeof actor.deltaLedgerProperty === "function") {
    return actor.deltaLedgerProperty("wealth", amount, reason);
  }
  const value = actorWealth(actor);
  return actor.update({ "system.wealth.value": Math.max(0, value + amount) });
}

/* ------------------------------------------------------------------ */
/* Notification fan-out (GM side)                                      */
/* ------------------------------------------------------------------ */

function notifyClients(data) {
  game.socket.emit(SOCKET_NAME, { action: "notify", ...data });
  // The emitting GM does not receive its own socket message.
  Hooks.callAll(`${MODULE_ID}.notify`, data);
}

/* ------------------------------------------------------------------ */
/* Operations (executed on a GM client only)                           */
/* ------------------------------------------------------------------ */

function requesterIsGM(userId) {
  return game.users.get(userId)?.isGM ?? false;
}

const OPS = {

  /* ---- chat ---- */

  async "chat.create"({ name, participantKeys }, userId) {
    const isGM = requesterIsGM(userId);
    const participants = [];
    for (const key of participantKeys || []) {
      const p = buildParticipant(key);
      if (!p) continue;
      if (!isGM && p.kind === "garden") {
        const g = gardenContact(p.gardenId);
        if (!g || !g.visible) continue; // players may only add visible Garden contacts
      }
      participants.push(p);
    }
    if (!isGM) {
      const selfKey = participantKeyForUser(userId);
      if (!participants.some(p => p.key === selfKey)) {
        const self = buildParticipant(selfKey);
        if (self) participants.unshift(self);
      }
    }
    if (!participants.length) return false;
    const chats = getWorld("agentChats") || {};
    const id = uid("chat");
    chats[id] = {
      id,
      name: name || "",
      participants,
      createdBy: userId,
      ts: Date.now(),
      lastTs: Date.now()
    };
    await setWorld("agentChats", chats);
    return id;
  },

  async "chat.rename"({ chatId, name, img }, userId) {
    const chats = getWorld("agentChats") || {};
    const chat = chats[chatId];
    if (!chat) return false;
    if (!requesterIsGM(userId) && chat.createdBy !== userId) return false;
    if (name !== undefined) chat.name = String(name || "");
    if (img !== undefined) chat.img = String(img || "").slice(0, 1000);
    await setWorld("agentChats", chats);
    return true;
  },

  async "chat.delete"({ chatId }, userId) {
    if (!requesterIsGM(userId)) return false;
    const chats = getWorld("agentChats") || {};
    if (!chats[chatId]) return false;
    delete chats[chatId];
    await setWorld("agentChats", chats);
    const msgs = getWorld("agentMessages") || {};
    if (msgs[chatId]) { delete msgs[chatId]; await setWorld("agentMessages", msgs); }
    return true;
  },

  async "chat.addParticipant"({ chatId, key }, userId) {
    if (!requesterIsGM(userId)) return false;
    const chats = getWorld("agentChats") || {};
    const chat = chats[chatId];
    if (!chat) return false;
    if (chat.participants.some(p => p.key === key)) return false;
    const p = buildParticipant(key);
    if (!p) return false;
    chat.participants.push(p);
    await setWorld("agentChats", chats);
    return true;
  },

  async "chat.removeParticipant"({ chatId, key }, userId) {
    if (!requesterIsGM(userId)) return false;
    const chats = getWorld("agentChats") || {};
    const chat = chats[chatId];
    if (!chat) return false;
    chat.participants = chat.participants.filter(p => p.key !== key);
    await setWorld("agentChats", chats);
    return true;
  },

  async "chat.updateParticipant"({ chatId, key, nameOverride, imgOverride }, userId) {
    if (!requesterIsGM(userId)) return false;
    const chats = getWorld("agentChats") || {};
    const chat = chats[chatId];
    const p = chat?.participants.find(x => x.key === key);
    if (!p) return false;
    if (nameOverride !== undefined) p.nameOverride = String(nameOverride || "");
    if (imgOverride !== undefined) p.imgOverride = String(imgOverride || "");
    await setWorld("agentChats", chats);
    return true;
  },

  /* ---- messages ---- */

  async "msg.send"({ chatId, senderKey, text, attachment }, userId) {
    const chats = getWorld("agentChats") || {};
    const chat = chats[chatId];
    if (!chat) return false;
    const isGM = requesterIsGM(userId);
    const sender = chat.participants.find(p => p.key === senderKey);
    if (!sender) return false;
    // Players may only speak as themselves; GM as any non-player participant.
    if (!isGM && senderKey !== participantKeyForUser(userId)) return false;
    if (isGM && sender.kind === "player") return false;
    text = String(text || "").slice(0, 5000);
    if (!text && !attachment) return false;
    const identity = participantIdentity(chat, senderKey);
    const msg = {
      id: uid("msg"),
      senderKey,
      senderName: identity.name,
      senderImg: identity.img,
      text,
      attachment: sanitizeAttachment(attachment),
      authorUserId: userId,
      ts: Date.now()
    };
    const all = getWorld("agentMessages") || {};
    const list = all[chatId] || [];
    list.push(msg);
    all[chatId] = list;
    chat.lastTs = msg.ts;
    await setWorld("agentMessages", all);
    await setWorld("agentChats", chats);
    notifyClients({
      kind: "message",
      chatId,
      chatName: chat.name,
      senderKey,
      senderName: identity.name,
      preview: text ? text.slice(0, 80) : "📎",
      participantUserIds: chat.participants.filter(p => p.kind === "player").map(p => p.userId)
    });
    return msg.id;
  },

  async "msg.delete"({ chatId, msgId }, userId) {
    if (!requesterIsGM(userId)) return false;
    const all = getWorld("agentMessages") || {};
    const list = all[chatId];
    if (!list) return false;
    all[chatId] = list.filter(m => m.id !== msgId);
    await setWorld("agentMessages", all);
    return true;
  },

  /* GM silently edits a message's text and/or timestamp. No "edited" flag is
   * stored, so players never see that anything changed. */
  async "msg.edit"({ chatId, msgId, text, ts }, userId) {
    if (!requesterIsGM(userId)) return false;
    const all = getWorld("agentMessages") || {};
    const list = all[chatId];
    const msg = list?.find(m => m.id === msgId);
    if (!msg) return false;
    if (text !== undefined) msg.text = String(text).slice(0, 5000);
    if (Number.isFinite(ts) && ts > 0) msg.ts = ts;
    // keep the thread ordered by timestamp after a time edit
    list.sort((a, b) => a.ts - b.ts);
    const chats = getWorld("agentChats") || {};
    if (chats[chatId]) { chats[chatId].lastTs = list[list.length - 1]?.ts || chats[chatId].lastTs; await setWorld("agentChats", chats); }
    await setWorld("agentMessages", all);
    return true;
  },

  /* ---- Garden contacts ---- */

  async "garden.save"({ contact }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("gardenContacts") || [];
    const existing = contact.id ? list.find(c => c.id === contact.id) : null;
    if (existing) {
      Object.assign(existing, {
        name: String(contact.name || existing.name),
        img: String(contact.img || existing.img || ""),
        note: String(contact.note ?? existing.note ?? ""),
        folder: String(contact.folder ?? existing.folder ?? "").trim(),
        actorUuid: contact.actorUuid ?? existing.actorUuid ?? ""
      });
    } else {
      list.push({
        id: uid("grd"),
        name: String(contact.name || "New Contact"),
        img: String(contact.img || ""),
        note: String(contact.note || ""),
        folder: String(contact.folder || "").trim(),
        actorUuid: contact.actorUuid || "",
        visible: false,
        ts: Date.now()
      });
    }
    await setWorld("gardenContacts", list);
    return true;
  },

  async "garden.toggleVisible"({ gardenId }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("gardenContacts") || [];
    const c = list.find(x => x.id === gardenId);
    if (!c) return false;
    c.visible = !c.visible;
    await setWorld("gardenContacts", list);
    return true;
  },

  /* Rename a Garden folder for every contact in it. `from` may be "" (the
   * ungrouped bucket) — that assigns the new folder to all ungrouped ones. */
  async "garden.renameFolder"({ from, to }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("gardenContacts") || [];
    const src = String(from ?? "").trim();
    const dst = String(to ?? "").trim();
    for (const c of list) {
      if ((c.folder || "").trim() === src) c.folder = dst;
    }
    await setWorld("gardenContacts", list);
    return true;
  },

  async "garden.delete"({ gardenId }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = (getWorld("gardenContacts") || []).filter(x => x.id !== gardenId);
    await setWorld("gardenContacts", list);
    return true;
  },

  /* ---- Datapool shards ---- */

  async "shard.create"({ shard }, userId) {
    const list = getWorld("agentShards") || [];
    const isGM = requesterIsGM(userId);
    list.push({
      id: uid("shard"),
      title: String(shard.title || "Untitled").slice(0, 200),
      body: String(shard.body || "").slice(0, 50000),
      format: ["plain", "markdown", "html"].includes(shard.format) ? shard.format : "plain",
      authorName: isGM ? String(shard.authorName || "???") : playerIdentity(userId).name,
      createdBy: userId,
      recipients: {},
      folder: String(shard.folder || "").trim(),
      ts: Date.now()
    });
    await setWorld("agentShards", list);
    return true;
  },

  /* Move a shard into a folder. Folders are per-viewer: the author sets the
   * folder on originals they own; a recipient files their delivered COPY via
   * `recipientFolders[userId]`. */
  async "shard.setFolder"({ shardId, folder }, userId) {
    const list = getWorld("agentShards") || [];
    const shard = list.find(s => s.id === shardId);
    if (!shard) return false;
    const isGM = requesterIsGM(userId);
    const f = String(folder || "").trim().slice(0, 100);
    const owns = shard.createdBy === userId && !shard.isCopy;
    if (isGM || owns) {
      shard.folder = f;
    } else if (shard.recipients && shard.recipients[userId]) {
      shard.recipientFolders = shard.recipientFolders || {};
      if (f) shard.recipientFolders[userId] = f;
      else delete shard.recipientFolders[userId];
    } else {
      return false;
    }
    await setWorld("agentShards", list);
    return true;
  },

  /* Sending delivers an immutable COPY — later edits to the author's
   * original never change what recipients already received. */
  async "shard.send"({ shardId, userIds, gardenIds }, userId) {
    const list = getWorld("agentShards") || [];
    const shard = list.find(s => s.id === shardId);
    if (!shard || shard.isCopy) return false;
    if (!requesterIsGM(userId) && shard.createdBy !== userId) return false;
    const now = Date.now();
    const targets = (userIds || []).filter(u => u !== shard.createdBy);
    if (!targets.length && !(gardenIds || []).length) return false;
    list.push({
      id: uid("shard"),
      title: shard.title,
      body: shard.body,
      format: shard.format,
      authorName: shard.authorName,
      createdBy: shard.createdBy,
      isCopy: true,
      recipients: Object.fromEntries(targets.map(u => [u, now])),
      gardenRecipients: [...(gardenIds || [])],
      ts: now
    });
    await setWorld("agentShards", list);
    notifyClients({
      kind: "shard",
      title: shard.title,
      authorName: shard.authorName,
      recipientUserIds: targets
    });
    return true;
  },

  /* Author (or GM) edits their own ORIGINAL shard; copies are immutable. */
  async "shard.update"({ shardId, patch }, userId) {
    const list = getWorld("agentShards") || [];
    const shard = list.find(s => s.id === shardId);
    if (!shard || shard.isCopy) return false;
    const isGM = requesterIsGM(userId);
    if (!isGM && shard.createdBy !== userId) return false;
    if (patch.title !== undefined) shard.title = String(patch.title || shard.title).slice(0, 200);
    if (patch.body !== undefined) shard.body = String(patch.body).slice(0, 50000);
    if (["plain", "markdown", "html"].includes(patch.format)) shard.format = patch.format;
    if (isGM && patch.authorName !== undefined) shard.authorName = String(patch.authorName || shard.authorName);
    await setWorld("agentShards", list);
    return true;
  },

  async "shard.delete"({ shardId }, userId) {
    const list = getWorld("agentShards") || [];
    const shard = list.find(s => s.id === shardId);
    if (!shard) return false;
    if (!requesterIsGM(userId) && shard.createdBy !== userId) return false;
    await setWorld("agentShards", list.filter(s => s.id !== shardId));
    return true;
  },

  /* ---- personal contacts (contact book) ---- */

  async "contact.save"({ contact }, userId) {
    const list = getWorld("personalContacts") || [];
    const existing = contact.id ? list.find(c => c.id === contact.id) : null;
    if (existing) {
      if (!requesterIsGM(userId) && existing.ownerUserId !== userId) return false;
      Object.assign(existing, {
        name: String(contact.name ?? existing.name),
        note: String(contact.note ?? existing.note ?? ""),
        address: String(contact.address ?? existing.address ?? ""),
        hasPin: !!contact.hasPin,
        mapX: Number(contact.mapX ?? existing.mapX ?? 50),
        mapY: Number(contact.mapY ?? existing.mapY ?? 50)
      });
    } else {
      list.push({
        id: uid("ct"),
        name: String(contact.name || "New Contact"),
        note: String(contact.note || ""),
        address: String(contact.address || ""),
        hasPin: !!contact.hasPin,
        mapX: Number(contact.mapX ?? 50),
        mapY: Number(contact.mapY ?? 50),
        ownerUserId: userId,
        ownerName: game.users.get(userId)?.name || "?",
        sharedWith: [],
        ts: Date.now()
      });
    }
    await setWorld("personalContacts", list);
    return true;
  },

  async "contact.delete"({ contactId }, userId) {
    const list = getWorld("personalContacts") || [];
    const c = list.find(x => x.id === contactId);
    if (!c) return false;
    if (!requesterIsGM(userId) && c.ownerUserId !== userId) return false;
    await setWorld("personalContacts", list.filter(x => x.id !== contactId));
    return true;
  },

  /* Set the EXACT share list — checking a box shares, unchecking removes.
   * Only newly-added users are notified. */
  async "contact.share"({ contactId, userIds }, userId) {
    const list = getWorld("personalContacts") || [];
    const c = list.find(x => x.id === contactId);
    if (!c) return false;
    if (!requesterIsGM(userId) && c.ownerUserId !== userId) return false;
    const before = new Set(c.sharedWith || []);
    c.sharedWith = Array.from(new Set(userIds || [])).filter(u => u !== c.ownerUserId);
    const added = c.sharedWith.filter(u => !before.has(u));
    await setWorld("personalContacts", list);
    if (added.length) notifyClients({ kind: "contactShared", name: c.name, recipientUserIds: added });
    return true;
  },

  /* ---- NCPD ---- */

  async "ncpd.save"({ record }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("ncpdRecords") || [];
    const existing = record.id ? list.find(r => r.id === record.id) : null;
    const clean = {
      name: String(record.name || "UNKNOWN"),
      img: String(record.img || ""),
      description: String(record.description || ""),
      faction: String(record.faction || ""),
      status: String(record.status || "")
    };
    if (existing) Object.assign(existing, clean);
    else list.push({ id: uid("ncpd"), ...clean, ts: Date.now() });
    await setWorld("ncpdRecords", list);
    return true;
  },

  async "ncpd.delete"({ recordId }, userId) {
    if (!requesterIsGM(userId)) return false;
    await setWorld("ncpdRecords", (getWorld("ncpdRecords") || []).filter(r => r.id !== recordId));
    return true;
  },

  /* ---- GM map markers ---- */

  async "marker.save"({ marker }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("mapMarkers") || [];
    const existing = marker.id ? list.find(m => m.id === marker.id) : null;
    const clean = {
      label: String(marker.label || "").slice(0, 100),
      color: /^#[0-9a-fA-F]{3,8}$/.test(marker.color || "") ? marker.color : "#ffcc00",
      icon: /^fa-[\w-]+$/.test(marker.icon || "") ? marker.icon : "fa-location-dot",
      hidden: marker.hidden !== false,   // new markers are GM-only until revealed
      x: Math.max(0, Math.min(100, Number(marker.x ?? 50))),
      y: Math.max(0, Math.min(100, Number(marker.y ?? 50)))
    };
    if (existing) Object.assign(existing, clean);
    else list.push({ id: uid("mk"), ...clean, ts: Date.now() });
    await setWorld("mapMarkers", list);
    return true;
  },

  async "marker.delete"({ markerId }, userId) {
    if (!requesterIsGM(userId)) return false;
    await setWorld("mapMarkers", (getWorld("mapMarkers") || []).filter(m => m.id !== markerId));
    return true;
  },

  /* ---- ID profiles / housing / lifestyle ---- */

  async "id.update"({ targetUserId, patch }, userId) {
    const isGM = requesterIsGM(userId);
    const PLAYER_FIELDS = ["proxyName", "proxyImg", "realName", "housingId", "lifestyleId", "traumaId"];
    if (!isGM) {
      if (targetUserId !== userId) return false;
      patch = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => PLAYER_FIELDS.includes(k)));
    }
    const all = getWorld("idProfiles") || {};
    all[targetUserId] = { ...(all[targetUserId] || {}), ...patch };
    await setWorld("idProfiles", all);
    return true;
  },

  async "housing.save"({ option }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("housingOptions") || [];
    const existing = option.id ? list.find(o => o.id === option.id) : null;
    const clean = { name: String(option.name || "?"), rent: Number(option.rent || 0), buy: Number(option.buy || 0) };
    if (existing) Object.assign(existing, clean);
    else list.push({ id: uid("h"), ...clean });
    await setWorld("housingOptions", list);
    return true;
  },

  async "housing.delete"({ optionId }, userId) {
    if (!requesterIsGM(userId)) return false;
    await setWorld("housingOptions", (getWorld("housingOptions") || []).filter(o => o.id !== optionId));
    return true;
  },

  async "lifestyle.save"({ option }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("lifestyleOptions") || [];
    const existing = option.id ? list.find(o => o.id === option.id) : null;
    const clean = { name: String(option.name || "?"), cost: Number(option.cost || 0) };
    if (existing) Object.assign(existing, clean);
    else list.push({ id: uid("ls"), ...clean });
    await setWorld("lifestyleOptions", list);
    return true;
  },

  async "lifestyle.delete"({ optionId }, userId) {
    if (!requesterIsGM(userId)) return false;
    await setWorld("lifestyleOptions", (getWorld("lifestyleOptions") || []).filter(o => o.id !== optionId));
    return true;
  },

  /* ---- tools / daemons ----
   * Entries: { uuid, visible, ownerUserId }. GM entries have ownerUserId="".
   * The GM may rewrite the whole list; a player may only touch their OWN
   * entries (add / remove / reorder), never GM or other players' ones. */

  async "tools.setList"({ list }, userId) {
    const clean = (Array.isArray(list) ? list : [])
      .filter(e => e && typeof e.uuid === "string")
      .map(e => ({ uuid: e.uuid, visible: !!e.visible, ownerUserId: String(e.ownerUserId || "") }));
    if (requesterIsGM(userId)) {
      await setWorld("toolMacros", clean);
      return true;
    }
    // player: keep everyone else's entries, replace only this player's set
    const current = getWorld("toolMacros") || [];
    const others = current.filter(e => e.ownerUserId !== userId);
    const mine = clean.filter(e => e.ownerUserId === userId);
    await setWorld("toolMacros", [...others, ...mine]);
    return true;
  },

  /* ---- chrome (implant viewer display layout; owner or GM) ---- */

  async "chrome.setLayout"({ actorUuid, layout }, userId) {
    const actor = await fromUuid(actorUuid);
    if (!actor) return false;
    if (!requesterIsGM(userId) && !actor.testUserPermission(game.users.get(userId), "OWNER")) return false;
    const sides = {};
    for (const [k, v] of Object.entries((layout && layout.sides) || {})) {
      if (v === "left" || v === "right") sides[String(k)] = v;
    }
    const paired = {};
    for (const [k, v] of Object.entries((layout && layout.paired) || {})) {
      if (v) paired[String(k)] = true;
    }
    const all = getWorld("chromeLayout") || {};
    all[actor.id] = { sides, paired };
    await setWorld("chromeLayout", all);
    return true;
  },

  /* ---- library (GM only; PDFs are downloaded by the GM client itself) ---- */

  async "library.setTree"({ tree }, userId) {
    if (!requesterIsGM(userId)) return false;
    await setWorld("libraryTree", Array.isArray(tree) ? tree : []);
    return true;
  },

  async "library.renameFile"({ nodeId, name }, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("libraryTree") || [];
    const node = tree.find(n => n.id === nodeId);
    if (!node) return false;
    node.name = String(name || node.name).slice(0, 200);
    await setWorld("libraryTree", tree);
    return true;
  },

  async "library.deleteFile"({ nodeId }, userId) {
    if (!requesterIsGM(userId)) return false;
    const tree = getWorld("libraryTree") || [];
    await setWorld("libraryTree", tree.filter(n => n.id !== nodeId));
    return true;
  },

  async "trauma.save"({ option }, userId) {
    if (!requesterIsGM(userId)) return false;
    const list = getWorld("traumaOptions") || [];
    const existing = option.id ? list.find(o => o.id === option.id) : null;
    const clean = {
      name: String(option.name || "?"),
      cost: Number(option.cost || 0),
      tier: option.tier === "platinum" ? "platinum" : "silver"
    };
    if (existing) Object.assign(existing, clean);
    else list.push({ id: uid("tt"), ...clean });
    await setWorld("traumaOptions", list);
    return true;
  },

  async "trauma.delete"({ optionId }, userId) {
    if (!requesterIsGM(userId)) return false;
    await setWorld("traumaOptions", (getWorld("traumaOptions") || []).filter(o => o.id !== optionId));
    return true;
  },

  /* ---- wallet ---- */

  async "wallet.transfer"({ fromActorUuid, toActorUuid, amount, memo }, userId) {
    amount = Math.floor(Number(amount));
    if (!(amount > 0)) return false;
    const from = await fromUuid(fromActorUuid);
    const to = toActorUuid ? await fromUuid(toActorUuid) : null;
    if (!from) return false;
    // Requesting player must own the source actor.
    if (!requesterIsGM(userId) && !from.testUserPermission(game.users.get(userId), "OWNER")) return false;
    if (actorWealth(from) < amount) return false;
    const fromName = from.name;
    const toName = to?.name || memo || "???";
    await deltaWealth(from, -amount, `Agent: → ${toName}${memo ? ` — ${memo}` : ""}`);
    if (to) await deltaWealth(to, amount, `Agent: ← ${fromName}${memo ? ` — ${memo}` : ""}`);
    const toOwnerIds = to ? game.users.filter(u => !u.isGM && to.testUserPermission(u, "OWNER")).map(u => u.id) : [];
    notifyClients({ kind: "transfer", fromName, toName, amount, recipientUserIds: toOwnerIds });
    return true;
  },

  /* GM grant: credit a player from an arbitrary named sender (no source actor). */
  async "wallet.gmGrant"({ toActorUuid, amount, senderName, memo }, userId) {
    if (!requesterIsGM(userId)) return false;
    amount = Math.floor(Number(amount));
    if (!(amount > 0)) return false;
    const to = await fromUuid(toActorUuid);
    if (!to) return false;
    const fromName = String(senderName || "???").slice(0, 100);
    await deltaWealth(to, amount, `Agent: ← ${fromName}${memo ? ` — ${memo}` : ""}`);
    const toOwnerIds = game.users.filter(u => !u.isGM && to.testUserPermission(u, "OWNER")).map(u => u.id);
    notifyClients({ kind: "transfer", fromName, toName: to.name, amount, recipientUserIds: toOwnerIds });
    return true;
  },

  /* ---- store ---- */

  async "store.checkout"({ actorUuid, itemUuids }, userId) {
    const actor = await fromUuid(actorUuid);
    if (!actor) return false;
    if (!requesterIsGM(userId) && !actor.testUserPermission(game.users.get(userId), "OWNER")) return false;
    const cfg = getWorld("storeConfig") || {};
    // Pricing follows the ACTOR'S OWNER, not the request sender — so a GM
    // buying for a player still applies that player's markup / price cap.
    const ownerId = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"))?.id || null;
    // per-player markup overrides the global one; both may be negative (discount)
    const markup = Number((cfg.playerMarkup || {})[ownerId] ?? cfg.markup ?? 0);
    const blacklist = (cfg.blacklist || []).map(b => b.uuid);
    const docs = [];
    let total = 0;
    const locked = cfg.lockedCategories || [];
    const isGmBuyer = requesterIsGM(userId);
    const cap = isGmBuyer ? 0 : ((cfg.playerMaxPrice || {})[userId] ?? (cfg.maxPrice ?? 100));
    for (const itemUuid of (itemUuids || []).slice(0, 50)) {
      if (blacklist.includes(itemUuid)) continue;
      const doc = await fromUuid(itemUuid);
      if (!doc) continue;
      // Re-apply the GM's catalog gates server-side (clients can be crafted).
      const packId = doc.pack || "";
      const isCore = !!PACK_CATEGORIES[packId];
      const category = PACK_CATEGORIES[packId] || "Extra";
      if (locked.includes(category)) continue;
      if (cfg.sourceFilter === "core" && !isCore) continue;
      if (cfg.sourceFilter === "extra" && isCore) continue;
      const price = Number(foundry.utils.getProperty(doc, "system.price.market") || 0);
      if (cap > 0 && price > cap) continue;
      total += Math.max(0, Math.ceil(price * (1 + markup / 100)));
      docs.push(doc);
    }
    if (!docs.length) return false;
    if (actorWealth(actor) < total) return false;
    await deltaWealth(actor, -total, `Agent: NC MART (${docs.length})`);
    await actor.createEmbeddedDocuments("Item", docs.map(d => d.toObject()));
    const ownerIds = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
    notifyClients({ kind: "purchase", actorName: actor.name, total, count: docs.length, recipientUserIds: ownerIds });
    return true;
  }
};

function buildParticipant(key) {
  if (key.startsWith("player:")) {
    const userId = key.slice(7);
    const user = game.users.get(userId);
    if (!user) return null;
    return { key, kind: "player", userId, actorUuid: user.character?.uuid || "" };
  }
  if (key.startsWith("garden:")) {
    const gardenId = key.slice(7);
    if (!gardenContact(gardenId)) return null;
    return { key, kind: "garden", gardenId };
  }
  return null;
}

function sanitizeAttachment(att) {
  if (!att || !att.src) return null;
  const kind = ["image", "audio", "video"].includes(att.kind) ? att.kind : "image";
  return { kind, src: String(att.src).slice(0, 1000) };
}

/** Entry point for socket-relayed and local mutations (GM client only). */
export async function applyOp(op, payload, userId) {
  const fn = OPS[op];
  if (!fn) {
    console.warn(`${MODULE_ID} | unknown op ${op}`);
    return false;
  }
  try {
    return await fn(payload, userId);
  } catch (e) {
    console.error(`${MODULE_ID} | op ${op} failed`, e);
    return false;
  }
}
