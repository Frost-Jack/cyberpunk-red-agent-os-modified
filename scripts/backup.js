import { MODULE_ID } from "./constants.js";

// Only Agent metadata. Actor systems, inventory and attachment bytes are excluded.
export const BACKUP_SECTIONS = {
  chats: ["agentChats", "agentMessages", "chatFolders"],
  datapool: ["agentShards", "datapoolFolders"],
  contacts: ["personalContacts", "contactFolders", "gardenContacts"],
  identity: ["idProfiles", "housingOptions", "lifestyleOptions", "traumaOptions", "monthlyNotices"],
  world: ["ncpdRecords", "ncpdFolders", "mapMarkers", "mapImagePath", "librarySourceUrl", "libraryTree", "toolMacros", "chromeLayout"],
  configuration: ["storeConfig", "appConfig"],
  notifications: ["agentNotifications"],
  preferences: [],
  ledger: []
};
const ARRAY_KEYS = new Set(["chatFolders", "agentShards", "datapoolFolders", "personalContacts", "contactFolders", "gardenContacts", "housingOptions", "lifestyleOptions", "traumaOptions", "ncpdRecords", "ncpdFolders", "mapMarkers", "libraryTree", "toolMacros"]);
const USER_MAPS = new Set(["idProfiles", "monthlyNotices", "agentNotifications"]);
const STRING_KEYS = new Set(["mapImagePath", "librarySourceUrl"]);
const FLAGS = ["lastRead", "agentMode", "agentTheme", "agentZoom", "arcadeScores", "arcadeScoresHidden", "radioIgnoreBroadcast", "notificationRead", "notificationMuted", "mutedChats", "notificationCleared"];
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
function checkTree(value, depth = 0) {
  if (depth > 40) throw new Error("Backup nesting limit");
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error("Unsafe backup key");
    checkTree(child, depth + 1);
  }
}
const clone = value => foundry.utils.deepClone(value);
const worldId = () => game.world?.id || "";

export function exportBackup(sections = Object.keys(BACKUP_SECTIONS)) {
  if (!game.user.isGM) throw new Error("GM only");
  const data = {};
  for (const section of sections) {
    if (!Object.hasOwn(BACKUP_SECTIONS, section)) throw new Error("Unknown section");
    for (const key of BACKUP_SECTIONS[section]) data[key] = clone(game.settings.get(MODULE_ID, key));
  }
  const preferences = sections.includes("preferences") ? Object.fromEntries(game.users.map(u => [u.id,
    Object.fromEntries(FLAGS.map(f => [f, clone(u.getFlag(MODULE_ID, f) ?? null)]))])) : {};
  const ledgerMetadata = sections.includes("ledger") ? Object.fromEntries((game.actors?.map(a => [a.uuid, clone(a.getFlag(MODULE_ID, "wealthMetadata") || [])]) || []).filter(([, rows]) => rows.length)) : {};
  return { format: `${MODULE_ID}.backup`, version: 1, worldId: worldId(), created: new Date().toISOString(), ledgerMetadata,
    files: "references-only", sections, users: game.users.map(u => ({ id: u.id, name: u.name, actorUuid: u.character?.uuid || "" })), data, preferences };
}

export function validateBackup(backup) {
  if (!backup || backup.format !== `${MODULE_ID}.backup` || backup.version !== 1 || backup.files !== "references-only") throw new Error("Unsupported backup format");
  checkTree(backup);
  for (const rows of Object.values(backup.ledgerMetadata || {})) {
    if (!Array.isArray(rows) || rows.some(r => !Number.isInteger(r.index) || typeof r.text !== "string" || typeof r.reason !== "string" || !Number.isFinite(r.delta) || !Number.isFinite(r.total) || !Number.isFinite(r.ts))) throw new Error("Invalid ledger metadata");
  }
  if (!Array.isArray(backup.sections) || !backup.data || Array.isArray(backup.data) || !Array.isArray(backup.users) || typeof backup.worldId !== "string") throw new Error("Invalid backup structure");
  const object = v => v && typeof v === "object" && !Array.isArray(v);
  const validateMessage = m => {
    if (!object(m) || typeof m.id !== "string" || typeof m.senderKey !== "string" || typeof m.text !== "string" || !Number.isFinite(m.ts)) throw new Error("Invalid message");
    if (m.replyTo && (!object(m.replyTo) || typeof m.replyTo.id !== "string" || typeof m.replyTo.text !== "string" || typeof m.replyTo.name !== "string")) throw new Error("Invalid reply");
    if (m.reactions && (!object(m.reactions) || Object.values(m.reactions).some(v => !Array.isArray(v) || v.some(id => typeof id !== "string")))) throw new Error("Invalid reactions");
    const a = m.attachment;
    if (a && (!object(a) || !["image", "audio", "video", "shard", "contact", "item", "coordinates"].includes(a.kind))) throw new Error("Invalid attachment");
    if (["image", "audio", "video"].includes(a?.kind) && (typeof a.src !== "string" || /[\u0000-\u001f]/.test(a.src) || (/^[a-z][a-z\d+.-]*:/i.test(a.src.trim()) && !/^https?:\/\//i.test(a.src.trim())))) throw new Error("Unsafe media reference");
    if (["shard", "contact"].includes(a?.kind) && (!object(a.snapshot) || typeof a.title !== "string" || (a.kind === "shard" && (typeof a.snapshot.body !== "string" || !["html", "markdown", "plain"].includes(a.snapshot.format))))) throw new Error("Invalid card");
  };
  for (const user of backup.users) if (!object(user) || typeof user.id !== "string") throw new Error("Invalid users");
  const allowed = new Set(backup.sections.flatMap(s => {
    if (!Object.hasOwn(BACKUP_SECTIONS, s)) throw new Error("Unknown section");
    return BACKUP_SECTIONS[s];
  }));
  for (const [key, value] of Object.entries(backup.data)) {
    if (STRING_KEYS.has(key) && allowed.has(key)) {
      if (typeof value !== "string" || value.length > 2000 || /^(?:javascript|data|vbscript):/i.test(value.trim())) throw new Error(`Invalid file reference: ${key}`);
      continue;
    }
    if (!allowed.has(key) || !value || typeof value !== "object" || Array.isArray(value) !== ARRAY_KEYS.has(key)) throw new Error(`Invalid section: ${key}`);
    const rows = ARRAY_KEYS.has(key) ? value : key === "agentMessages" ? Object.values(value).flat() : [];
    if (key === "agentMessages" && Object.values(value).some(v => !Array.isArray(v))) throw new Error("Invalid messages");
    if (["agentNotifications", "monthlyNotices"].includes(key) && Object.values(value).some(rows => !Array.isArray(rows) || rows.some(n => !object(n) || typeof n.id !== "string" || !Number.isFinite(n.ts)))) throw new Error(`Invalid history: ${key}`);
    if (["idProfiles", "chromeLayout"].includes(key) && Object.values(value).some(v => !object(v))) throw new Error(`Invalid profiles: ${key}`);
    const ids = new Set();
    for (const row of rows) {
      const id = key === "toolMacros" ? `${row?.ownerUserId || ""}:${row?.uuid}` : row?.id;
      if (!row || typeof row !== "object" || typeof id !== "string" || !id || ids.has(id)) throw new Error(`Invalid/duplicate id: ${key}`);
      ids.add(id);
      for (const field of ["name", "title", "body", "text", "note", "ownerUserId", "createdBy", "authorUserId", "parentId", "folderId", "format", "uuid", "src"]) {
        if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "string") throw new Error(`Invalid field: ${key}.${field}`);
      }
      if (key === "agentShards" && (!row.createdBy || !["plain", "markdown", "html"].includes(row.format) || typeof row.body !== "string" || row.body.length > 2_000_000)) throw new Error("Invalid shard");
      if (["personalContacts", "contactFolders", "datapoolFolders", "chatFolders"].includes(key) && !row.ownerUserId) throw new Error(`Missing owner: ${key}`);
      if (key === "agentMessages") validateMessage(row);
    }
    if (key === "agentChats" && Object.entries(value).some(([id, c]) => c?.id !== id || !Array.isArray(c.participants) || c.participants.some(p => !object(p) || typeof p.key !== "string" || !["player", "garden"].includes(p.kind)))) throw new Error("Invalid chats");
    if (key === "appConfig" && Object.values(value).some(v => !object(v))) throw new Error("Invalid app configuration");
    if (key === "storeConfig") for (const field of ["extraPacks", "lockedCategories", "blacklist"]) if (value[field] !== undefined && !Array.isArray(value[field])) throw new Error("Invalid store configuration");
  }
  for (const flags of Object.values(backup.preferences || {})) if (!object(flags)) throw new Error("Invalid preferences");
  for (const key of allowed) if (!Object.hasOwn(backup.data, key)) throw new Error(`Missing section: ${key}`);
  return backup;
}

export async function previewBackup(input, sections, mode = "merge", userMap = {}) {
  if (!game.user.isGM) throw new Error("GM only");
  const backup = validateBackup(input);
  if (!["merge", "replace"].includes(mode) || !Array.isArray(sections) || sections.some(s => !backup.sections.includes(s))) throw new Error("Invalid restore selection");
  checkTree(userMap);
  const sameWorld = backup.worldId === worldId();
  const mapUser = id => {
    const mapped = Object.hasOwn(userMap, id) ? userMap[id] : sameWorld ? id : null;
    return mapped && game.users.get(mapped) ? mapped : null;
  };
  const report = { added: 0, changed: 0, skipped: 0, warnings: [], writes: {}, preferences: {}, ledger: [] };
  const warn = text => { if (!report.warnings.includes(text)) report.warnings.push(text); };
  const uidFields = new Set(["ownerUserId", "createdBy", "authorUserId", "userId", "targetUserId", "sharedBy"]);
  const uidArrays = new Set(["sharedWith", "recipientUserIds", "participantUserIds"]);
  const uidObjects = new Set(["recipients", "recipientFolderIds", "folderIds", "perPlayer", "disabled", "playerMarkup", "playerMaxPrice", "playerMaxRarity"]);
  let hash = 2166136261;
  for (const c of backup.worldId || "foreign") hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  const entityIds = new Set(Object.entries(backup.data).flatMap(([key, value]) => ARRAY_KEYS.has(key) ? value.map(v => v.id).filter(Boolean) : key === "agentChats" ? Object.keys(value) : ["agentMessages", "agentNotifications", "monthlyNotices"].includes(key) ? Object.values(value).flat().map(v => v.id) : []));
  const mapId = id => !sameWorld && entityIds.has(id) ? `import-${hash.toString(36)}-${id}` : id;
  const idFields = new Set(["id", "parentId", "folderId", "chatId", "msgId", "shardId", "contactId", "gardenId", "sourceId", "eventId", "housingId", "lifestyleId", "traumaId"]);
  const remap = async (value, field = "") => {
    if (typeof value === "string") {
      if (uidFields.has(field) && value) {
        const id = mapUser(value);
        if (!id) throw new Error(`User: ${value}`);
        return id;
      }
      if ((field === "key" || field === "senderKey") && value.startsWith("player:")) {
        const id = mapUser(value.slice(7));
        if (!id) throw new Error(`Participant: ${value}`);
        return `player:${id}`;
      }
      if ((field === "key" || field === "senderKey") && value.startsWith("garden:")) return `garden:${mapId(value.slice(7))}`;
      if (field === "importMessage") return value.split(":").map(mapId).join(":");
      if (idFields.has(field)) return mapId(value);
      if (/uuid$/i.test(field) && value) {
        const mapped = sameWorld ? value : userMap[value];
        const doc = mapped ? await fromUuid(mapped).catch(() => null) : null;
        if (!doc) { warn(`UUID unavailable: ${value}`); return ""; }
        return doc.uuid || mapped;
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (uidArrays.has(field)) return value.map(mapUser).filter(Boolean);
      return Promise.all(value.map(v => remap(v)));
    }
    if (value && typeof value === "object") {
      if (field === "reactions") return Object.fromEntries(Object.entries(value).map(([reaction, ids]) => [reaction, ids.map(mapUser).filter(Boolean)]));
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        const id = uidObjects.has(field) ? mapUser(key) : key;
        if (!id) { warn(`User: ${key}`); continue; }
        out[id] = await remap(child, ["folderIds", "recipientFolderIds"].includes(field) ? "folderId" : uidObjects.has(field) ? "" : key);
      }
      return out;
    }
    return value;
  };
  for (const key of sections.flatMap(s => BACKUP_SECTIONS[s])) {
    if (STRING_KEYS.has(key)) {
      if (game.settings.get(MODULE_ID, key) === backup.data[key]) report.skipped++; else report.changed++;
      report.writes[key] = backup.data[key]; continue;
    }
    const current = clone(game.settings.get(MODULE_ID, key) || (ARRAY_KEYS.has(key) ? [] : {}));
    const incoming = backup.data[key];
    const result = mode === "replace" ? (ARRAY_KEYS.has(key) ? [] : {}) : clone(current);
    const rows = ARRAY_KEYS.has(key) ? incoming.map((v, i) => [i, v]) : Object.entries(incoming);
    for (const [id, row] of rows) {
      try {
        let mappedId = USER_MAPS.has(key) ? mapUser(id) : ["agentChats", "agentMessages"].includes(key) ? mapId(id) : id;
        if (key === "chromeLayout" && !sameWorld) {
          const actor = userMap[`Actor.${id}`] ? await fromUuid(userMap[`Actor.${id}`]).catch(() => null) : null;
          if (!actor) throw new Error(`Actor unavailable: Actor.${id}`);
          mappedId = actor.id;
        }
        if (mappedId === null) throw new Error(`User: ${id}`);
        const clean = await remap(row);
        if (key === "toolMacros" && !clean.uuid) throw new Error(`Macro: ${row.uuid}`);
        const index = ARRAY_KEYS.has(key) ? result.findIndex(v => key === "toolMacros" ? v.uuid === clean.uuid && v.ownerUserId === clean.ownerUserId : v.id === clean.id) : mappedId;
        const old = ARRAY_KEYS.has(key) ? current.find(v => key === "toolMacros" ? v.uuid === clean.uuid && v.ownerUserId === clean.ownerUserId : v.id === clean.id) : current[mappedId];
        if (["agentMessages", "agentNotifications", "monthlyNotices"].includes(key)) {
          const list = mode === "merge" ? clone(result[mappedId] || []) : [];
          for (const entry of clean) {
            const oldEntry = (old || []).find(e => e.id === entry.id);
            if (!oldEntry) report.added++; else if (JSON.stringify(oldEntry) !== JSON.stringify(entry)) report.changed++; else report.skipped++;
            const index = list.findIndex(e => e.id === entry.id);
            if (index < 0) list.push(entry); else list[index] = entry;
          }
          result[mappedId] = list.sort((a, b) => a.ts - b.ts);
          if (key === "agentNotifications") result[mappedId] = result[mappedId].slice(-200);
          if (key === "monthlyNotices") result[mappedId] = result[mappedId].slice(-120);
          continue;
        }
        if (old === undefined) report.added++;
        else if (JSON.stringify(old) !== JSON.stringify(clean)) report.changed++;
        else report.skipped++;
        if (ARRAY_KEYS.has(key)) { if (index < 0) result.push(clean); else result[index] = clean; }
        else if (key === "idProfiles" && mode === "merge") result[mappedId] = { ...(result[mappedId] || {}), ...clean };
        else result[mappedId] = clean;
      } catch (error) { report.skipped++; warn(`${key}: ${error.message}`); }
    }
    report.writes[key] = result;
  }
  // Never install messages without their chat, or folder cycles from an edited file.
  const chats = report.writes.agentChats || game.settings.get(MODULE_ID, "agentChats") || {};
  for (const id of Object.keys(report.writes.agentMessages || {})) if (!chats[id]) { delete report.writes.agentMessages[id]; report.skipped++; warn(`Chat unavailable: ${id}`); }
  for (const key of ["datapoolFolders", "contactFolders", "ncpdFolders", "libraryTree"]) {
    const folders = report.writes[key] || [];
    for (const f of folders) {
      const seen = new Set([f.id]);
      let parent = f.parentId;
      while (parent) { if (seen.has(parent)) throw new Error(`Folder cycle: ${key}`); seen.add(parent); parent = folders.find(x => x.id === parent)?.parentId; }
    }
  }
  if (sections.includes("preferences")) for (const [id, flags] of Object.entries(backup.preferences || {})) {
    const mapped = mapUser(id);
    if (!mapped) { report.skipped++; warn(`User: ${id}`); continue; }
    report.preferences[mapped] = Object.fromEntries(Object.entries(flags).filter(([f]) => FLAGS.includes(f)).map(([f, v]) => [f, ["lastRead", "mutedChats", "notificationRead"].includes(f) && v ? Object.fromEntries(Object.entries(v).map(([k, val]) => [mapId(k), val])) : v]));
  }
  if (sections.includes("ledger")) for (const [uuid, rows] of Object.entries(backup.ledgerMetadata || {})) {
    const mapped = sameWorld ? uuid : userMap[uuid];
    const actor = mapped ? await fromUuid(mapped).catch(() => null) : null;
    if (actor?.documentName !== "Actor") { report.skipped += rows.length; warn(`Actor unavailable: ${uuid}`); continue; }
    const systemRows = actor.listRecords?.("wealth") || [];
    const valid = rows.filter(r => systemRows[r.index]?.[0] === r.text && systemRows[r.index]?.[1] === r.reason);
    report.skipped += rows.length - valid.length;
    const current = clone(actor.getFlag(MODULE_ID, "wealthMetadata") || []);
    const merged = mode === "replace" ? [] : current.slice();
    for (const row of valid) {
      const i = merged.findIndex(r => r.index === row.index && r.text === row.text && r.reason === row.reason);
      if (i < 0) { merged.push(row); report.added++; } else { if (JSON.stringify(merged[i]) !== JSON.stringify(row)) report.changed++; else report.skipped++; merged[i] = row; }
    }
    report.ledger.push({ uuid: actor.uuid, value: merged.slice(-500) });
  }
  report.removed = mode === "replace" ? Object.entries(report.writes).reduce((n, [key, value]) => {
    if (STRING_KEYS.has(key)) return n;
    const old = game.settings.get(MODULE_ID, key) || {};
    return n + (Array.isArray(value) ? old.filter(x => !value.some(v => v.id === x.id)).length : Object.keys(old).filter(k => !Object.hasOwn(value, k)).length);
  }, 0) : 0;
  return report;
}

export async function restoreBackup(backup, sections, mode, userMap) {
  const plan = await previewBackup(backup, sections, mode, userMap);
  const before = Object.fromEntries(Object.keys(plan.writes).map(key => [key, clone(game.settings.get(MODULE_ID, key))]));
  const oldFlags = [];
  const oldLedger = [];
  try {
    for (const [key, value] of Object.entries(plan.writes)) await game.settings.set(MODULE_ID, key, value);
    for (const [id, flags] of Object.entries(plan.preferences)) for (const [flag, value] of Object.entries(flags)) {
      const user = game.users.get(id);
      oldFlags.push([user, flag, clone(user.getFlag(MODULE_ID, flag) ?? null)]);
      await user.setFlag(MODULE_ID, flag, value);
    }
    for (const entry of plan.ledger) {
      const actor = await fromUuid(entry.uuid);
      oldLedger.push([actor, clone(actor.getFlag(MODULE_ID, "wealthMetadata") || [])]);
      await actor.setFlag(MODULE_ID, "wealthMetadata", entry.value);
    }
  } catch (error) {
    const rollback = await Promise.allSettled([...Object.entries(before).map(([key, value]) => game.settings.set(MODULE_ID, key, value)), ...oldFlags.map(([u, f, v]) => u.setFlag(MODULE_ID, f, v)), ...oldLedger.map(([actor, value]) => actor.setFlag(MODULE_ID, "wealthMetadata", value))]);
    if (rollback.some(r => r.status === "rejected")) console.error(`${MODULE_ID} | backup rollback incomplete`, rollback);
    throw error;
  }
  return true;
}
