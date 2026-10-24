/* Isolated document/socket doubles. No world server or world files are used. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODULE_ID } from "../scripts/constants.js";
import { deltaWealth, transactions } from "../scripts/wealth.js";
import { applyOp, recurringExpenses, getWorld, mutate, operationStates } from "../scripts/data.js";
import { exportBackup, previewBackup, restoreBackup, validateBackup } from "../scripts/backup.js";
import { history, muted } from "../scripts/apps/notifications.js";
import { createRoom, joinRoom, startRoom, roomInput, tickRoom, legalCells, setRoomPaused } from "../scripts/arcade-network-core.js";
import { initSocket } from "../scripts/socket.js";
import { getData as walletData } from "../scripts/apps/wallet.js";

const clone = v => structuredClone(v);
const get = (o, p) => p.split(".").reduce((v, k) => v?.[k], o);
function set(o, path, v) { const keys = path.split("."); const last = keys.pop(); for (const k of keys) o = o[k] ||= {}; o[last] = v; }
function setup() {
  let next = 0;
  const world = new Map(), documents = new Map(), packets = [], callbacks = new Map();
  const user = (id, isGM = false) => ({ id, name: id, isGM, active: true, flags: {}, getFlag(m, f) { return get(this.flags, f); }, async setFlag(m, f, v) { set(this.flags, f, clone(v)); } });
  const gm = user("gm", true), a = user("a"), b = user("b"), outsider = user("outsider");
  const users = Object.assign([gm, a, b, outsider], { get: id => users.find(u => u.id === id) });
  globalThis.foundry = { utils: { deepClone: clone, randomID: () => String(++next), getProperty: get } };
  globalThis.Hooks = { callAll() {} };
  globalThis.ui = { notifications: { warn() {}, info() {} } };
  globalThis.game = { world: { id: "world" }, user: gm, users, i18n: { localize: k => k, format: (key, values) => `${values.property} ${values.amount ?? ""} => ${values.total}` },
    settings: { get: (m, k) => world.get(k), set: async (m, k, v) => { world.set(k, clone(v)); return v; } },
    socket: { emit: (channel, packet) => packets.push(packet), on: (channel, cb) => callbacks.set(channel, cb) } };
  globalThis.fromUuid = async id => documents.get(id) || null;
  return { gm, a, b, outsider, world, documents, packets, callbacks };
}
function actor(id, value = 1000) {
  const document = { uuid: id, name: id, documentName: "Actor", system: { wealth: { value, transactions: [] } }, flags: {},
    testUserPermission: u => u.id === "a" || u.isGM,
    getFlag(m, f) { return get(this.flags, `${m}.${f}`); },
    listRecords() { return this.system.wealth.transactions; },
    isLedgerProperty() { return true; },
    async update(changes) { await new Promise(r => setTimeout(r, 2)); for (const [path, v] of Object.entries(changes)) set(this, path, clone(v)); return this; }
  };
  // Use the installed system's actual fire-and-forget method.
  const source = readFileSync(new URL("../../../systems/cyberpunk-red-core/modules/actor/cpr-actor.js", import.meta.url), "utf8");
  const start = source.indexOf("  deltaLedgerProperty(prop, value, reason) {");
  const end = source.indexOf("\n  }", start) + 4;
  document.deltaLedgerProperty = new Function("SystemUtils", `return ({${source.slice(start, end)}}).deltaLedgerProperty;`)({ Format: (key, values) => game.i18n.format(key, values) });
  return document;
}

test("wallet keeps a recipient whose assigned character is not loaded on this client", async () => {
  const s = setup();
  s.a.character = actor("Actor.a");
  s.b._source = { character: "b" }; s.b.character = null;
  game.user = s.a;
  const data = await walletData({ state: { transferring: true } });
  assert.ok(data.targets.some(t => t.id === "actor:Actor.b"));
  assert.ok(!data.targets.some(t => t.id === "actor:Actor.a"));
});

test("native CPR ledger update is awaited; language, zero, raw/manual rows and multiline text are preserved", async () => {
  setup(); const a = actor("Actor.a");
  const reason = "<script>unsafe</script>\n" + "long reason ".repeat(100);
  const promise = deltaWealth(a, 0, reason);
  assert.equal(a.getFlag(MODULE_ID, "wealthMetadata"), undefined, "Actual update is still pending");
  await promise;
  assert.equal(transactions(a)[0].amount, 0); assert.equal(transactions(a)[0].total, 1000);
  game.i18n.format = () => "другая локализация";
  await deltaWealth(a, -25, reason);
  a.system.wealth.transactions.push(["wealth set to 0", "manual EN"], ["Неизвестная сумма", "ручная RU"]);
  const rows = transactions(a);
  assert.equal(rows[0].kind, "raw"); assert.equal(rows[0].amount, undefined); assert.equal(rows[0].ts, undefined);
  assert.equal(rows[2].amount, 25); assert.equal(rows[2].reason, reason);
  a.system.wealth.transactions.splice(0, 1);
  assert.equal(transactions(a).at(-1).kind, "raw", "A changed ledger position cannot inherit someone else's metadata");
});

test("Custom rent accepts zero and monthly payment reminders notify selected players without billing or debits", async () => {
  const s = setup();
  s.world.set("housingOptions", [{ id: "house", name: "House", rent: 1500, buy: 20000 }]);
  s.world.set("lifestyleOptions", [{ id: "food", name: "Food", cost: 300 }]);
  s.world.set("traumaOptions", [{ id: "tt", name: "TT", cost: 500 }]);
  s.world.set("idProfiles", { a: { housingId: "house", lifestyleId: "food", traumaId: "tt" } });
  assert.equal(recurringExpenses("a").total, 2300);
  for (const bad of [-1, "nan", "Infinity", false, {}]) assert.equal(await applyOp("id.update", { targetUserId: "a", patch: { housingRent: bad } }, "a"), false);
  assert.equal(await applyOp("id.update", { targetUserId: "b", patch: { housingRent: 0 } }, "a"), false);
  assert.equal(await applyOp("id.update", { targetUserId: "a", patch: { housingRent: 0 } }, "a"), true);
  assert.equal(recurringExpenses("a").total, 800); assert.equal(recurringExpenses("a").parts[0].custom, true);
  const request = { userIds: ["a"] }, wallet = actor("Actor.a", 1000);
  s.documents.set(wallet.uuid, wallet);
  assert.equal(await applyOp("monthly.notify", request, "gm"), true);
  const first = getWorld("agentNotifications").a.find(n => n.kind === "monthly");
  assert.equal(first.amount, 800);
  assert.equal(getWorld("agentNotifications").b, undefined);
  assert.equal(getWorld("monthlyNotices"), undefined);
  assert.equal(await applyOp("monthly.notify", request, "a"), false);
  await applyOp("id.update", { targetUserId: "a", patch: { housingRent: "" } }, "a");
  assert.equal(recurringExpenses("a").total, 2300); assert.equal(getWorld("housingOptions")[0].buy, 20000);
  assert.equal(first.amount, 800, "Existing reminders keep their original amount");
  assert.equal(await applyOp("monthly.notify", request, "gm"), true);
  assert.deepEqual(getWorld("agentNotifications").a.filter(n => n.kind === "monthly").map(n => n.amount), [800, 2300]);
  assert.equal(wallet.system.wealth.value, 1000);
  assert.deepEqual(wallet.system.wealth.transactions, []);
});

test("transfers serialize, deduplicate after a replay, reject mismatches/outsiders and refund a failed credit", async () => {
  const s = setup(), a = actor("Actor.a", 100), b = actor("Actor.b", 0);
  s.documents.set(a.uuid, a); s.documents.set(b.uuid, b);
  const payload = { fromActorUuid: a.uuid, toActorUuid: b.uuid, amount: 60, memo: "test" }, id = `${Date.now()}:transfer`;
  const results = await Promise.all([applyOp("wallet.transfer", payload, "a", id), applyOp("wallet.transfer", payload, "a", id), applyOp("wallet.transfer", payload, "a", `${Date.now()}:second`)]);
  assert.deepEqual(results, [true, true, false]); assert.equal(a.system.wealth.value, 40); assert.equal(b.system.wealth.value, 60);
  assert.equal(await applyOp("wallet.transfer", { ...payload, amount: 1 }, "a", id), false);
  assert.equal(await applyOp("wallet.transfer", { ...payload, amount: 1 }, "outsider"), false);
  assert.equal(await applyOp("wallet.transfer", { ...payload, amount: Infinity }, "a"), false);
  assert.equal(await applyOp("wallet.transfer", { ...payload, amount: 1, toActorUuid: a.uuid }, "a"), false);
  b.update = async () => { throw new Error("credit rejected"); };
  assert.equal(await applyOp("wallet.transfer", { ...payload, amount: 10 }, "a"), null);
  assert.equal(a.system.wealth.value, 40, "Source refunded after a failed target update");
  s.world.set("appConfig", { disabled: { a: true } });
  assert.equal(await applyOp("wallet.transfer", { ...payload, amount: 1 }, "a"), false);
});

test("paying a Garden NPC without a wealth ledger debits once without a failed credit or refund", async () => {
  const s = setup(), a = actor("Actor.a", 100);
  const npc = actor("Actor.npc", 0);
  delete npc.system.wealth;
  npc.isLedgerProperty = () => false;
  npc.update = async () => { throw new Error("NPC has no wallet to update"); };
  s.documents.set(a.uuid, a); s.documents.set(npc.uuid, npc);
  assert.equal(await applyOp("wallet.transfer", { fromActorUuid: a.uuid, toActorUuid: npc.uuid, amount: 20, memo: "NPC payment" }, "a"), true);
  assert.equal(a.system.wealth.value, 80);
  assert.equal(a.system.wealth.transactions.length, 1);
  assert.ok(!a.system.wealth.transactions.some(row => row[1].includes("refund")));
});

test("GM awards selected or all assigned characters, including offline users, once per actor in native money and IP ledgers", async () => {
  const s = setup(), a = actor("Actor.a", 100), b = actor("Actor.b", 200);
  s.a.character = a; s.b.character = b; s.b.active = false; s.outsider.character = a;
  for (const doc of [a, b]) { doc.system.improvementPoints = { value: 10, transactions: [] }; s.documents.set(doc.uuid, doc); }
  const data = await walletData({ state: { award: { resource: "wealth", actorUuids: [] } } });
  assert.deepEqual(data.awardTargets.map(t => t.uuid), [a.uuid, b.uuid]);
  assert.ok(data.awardTargets[0].name.includes("outsider"));
  const payout = { actorUuids: [a.uuid, a.uuid, b.uuid], resource: "wealth", amount: 50, senderName: "Fixer", memo: "Job" }, id = `${Date.now()}:award`;
  assert.equal(await applyOp("wallet.gmAward", payout, "gm", id), true);
  assert.equal(await applyOp("wallet.gmAward", payout, "gm", id), true);
  assert.equal(a.system.wealth.value, 150); assert.equal(b.system.wealth.value, 250);
  assert.equal(a.system.wealth.transactions.length, 1); assert.equal(b.system.wealth.transactions.length, 1);
  assert.equal(await applyOp("wallet.gmAward", { actorUuids: [b.uuid], resource: "improvementPoints", amount: 25, memo: "Session" }, "gm"), true);
  assert.equal(a.system.improvementPoints.value, 10); assert.equal(b.system.improvementPoints.value, 35);
  assert.equal(b.system.improvementPoints.transactions.length, 1);
  assert.equal(b.getFlag(MODULE_ID, "wealthMetadata").length, 1);
  assert.equal(a.system.wealth.value, 150); assert.equal(b.system.wealth.value, 250);
  for (const bad of [0, -1, 1.5, Infinity, "50"]) assert.equal(await applyOp("wallet.gmAward", { ...payout, amount: bad }, "gm"), false);
  assert.equal(await applyOp("wallet.gmAward", payout, "a"), false);
  assert.equal(await applyOp("wallet.gmAward", { ...payout, actorUuids: [a.uuid, "Actor.unassigned"] }, "gm"), false);
  assert.equal(await applyOp("wallet.gmAward", { ...payout, resource: "hp" }, "gm"), false);
  assert.equal(a.system.wealth.value, 150);
});

test("a failed batch award restores earlier native ledger writes and money metadata", async () => {
  const s = setup(), a = actor("Actor.a", 100), b = actor("Actor.b", 200);
  s.a.character = a; s.b.character = b;
  s.documents.set(a.uuid, a); s.documents.set(b.uuid, b);
  b.update = async () => { throw new Error("Award credit rejected"); };
  assert.equal(await applyOp("wallet.gmAward", { actorUuids: [a.uuid, b.uuid], resource: "wealth", amount: 50 }, "gm"), false);
  assert.equal(a.system.wealth.value, 100); assert.equal(b.system.wealth.value, 200);
  assert.deepEqual(a.system.wealth.transactions, []); assert.deepEqual(a.getFlag(MODULE_ID, "wealthMetadata"), []);
});

test("cards are authoritative snapshots; viewing does not import; repeated import, replies, reactions and pins keep rights", async () => {
  const s = setup();
  s.world.set("agentChats", { chat: { id: "chat", participants: [{ kind: "player", key: "player:a", userId: "a" }, { kind: "player", key: "player:b", userId: "b" }] } });
  s.world.set("agentShards", [{ id: "shard", title: "Original", createdBy: "a", body: "<b>safe frame</b>", format: "html" }]);
  s.world.set("personalContacts", [{ id: "contact", name: "Contact", note: "Private", ownerUserId: "a" }]);
  const payload = { chatId: "chat", senderKey: "player:a", text: "Card", attachment: { kind: "shard", id: "shard", snapshot: { body: "forged" } } };
  const id = await applyOp("msg.send", payload, "a");
  assert.equal(typeof id, "string"); assert.equal(getWorld("agentMessages").chat[0].attachment.snapshot.body, "<b>safe frame</b>");
  assert.equal(getWorld("agentShards").length, 1, "Sending a card creates no recipient shard");
  s.world.set("agentShards", []);
  const importPayload = { chatId: "chat", msgId: id };
  assert.equal(await applyOp("msg.importAttachment", importPayload, "outsider"), false);
  const first = await applyOp("msg.importAttachment", importPayload, "b");
  assert.equal(await applyOp("msg.importAttachment", importPayload, "b"), first); assert.equal(getWorld("agentShards").length, 1);
  assert.equal(getWorld("agentShards")[0].body, "<b>safe frame</b>", "Deleted source does not break a delivered snapshot");
  const reply = await applyOp("msg.send", { chatId: "chat", senderKey: "player:b", text: "Reply", replyTo: id }, "b");
  assert.equal(await applyOp("msg.pin", { chatId: "chat", msgId: reply, pinned: true }, "b"), false);
  assert.equal(await applyOp("msg.pin", { chatId: "chat", msgId: reply, pinned: true }, "gm"), true);
  for (let i = 0; i < 2; i++) await applyOp("msg.react", { chatId: "chat", msgId: reply, reaction: "👍", active: true }, "a");
  assert.deepEqual(getWorld("agentMessages").chat[1].reactions["👍"], ["a"]);
  await applyOp("msg.delete", importPayload, "gm");
  assert.equal(getWorld("agentMessages").chat[0].replyTo.text, "Card");
  assert.equal(await applyOp("msg.send", { ...payload, attachment: { kind: "contact", id: "hidden-garden" } }, "a"), false);
  assert.equal(await applyOp("msg.send", { ...payload, attachment: { kind: "image", src: "javascript:alert(1)" } }, "a"), false);
});

test("backup validation, merge, replace, foreign user mapping, stable IDs, folder relations and rollback", async () => {
  const s = setup();
  for (const key of ["agentShards", "datapoolFolders", "personalContacts", "contactFolders", "gardenContacts"]) s.world.set(key, []);
  s.world.set("personalContacts", [{ id: "ct", name: "Contact", ownerUserId: "a", folderId: "folder" }]);
  s.world.set("contactFolders", [{ id: "folder", name: "Folder", ownerUserId: "a", parentId: null }]);
  const backup = exportBackup(["contacts", "datapool"]);
  assert.equal(backup.files, "references-only"); assert.equal(backup.data.wealth, undefined);
  await restoreBackup(backup, ["contacts"], "merge", {}); await restoreBackup(backup, ["contacts"], "merge", {});
  assert.equal(getWorld("personalContacts").length, 1);
  assert.throws(() => validateBackup({ ...backup, version: 99 }));
  assert.throws(() => validateBackup(JSON.parse(JSON.stringify(backup).replace('"name":"Contact"', '"__proto__":{"polluted":true},"name":"Contact"'))));
  const foreign = { ...backup, worldId: "otherWorld" };
  const missing = await previewBackup(foreign, ["contacts"], "merge", {});
  assert.equal(missing.added, 0); assert.ok(missing.warnings.length > 0);
  await restoreBackup(foreign, ["contacts"], "merge", { a: "b" }); await restoreBackup(foreign, ["contacts"], "merge", { a: "b" });
  assert.equal(getWorld("personalContacts").length, 2);
  const imported = getWorld("personalContacts").find(c => c.ownerUserId === "b");
  assert.equal(getWorld("contactFolders").find(f => f.id === imported.folderId).ownerUserId, "b");
  const cycle = clone(backup); cycle.data.contactFolders[0].parentId = "folder";
  await assert.rejects(previewBackup(cycle, ["contacts"], "merge", {}), /cycle/);
  const before = getWorld("personalContacts");
  const realSet = game.settings.set; let failed = false;
  game.settings.set = async (m, key, value) => { if (key === "contactFolders" && !failed) { failed = true; throw new Error("write failure"); } return realSet(m, key, value); };
  await assert.rejects(restoreBackup(backup, ["contacts"], "replace", {}), /write failure/);
  assert.deepEqual(getWorld("personalContacts"), before);
});

test("full metadata backup includes file references and matched ledger metadata without changing system money", async () => {
  const s = setup(), a = actor("Actor.a", 100);
  const arrays = ["chatFolders", "agentShards", "datapoolFolders", "personalContacts", "contactFolders", "gardenContacts", "housingOptions", "lifestyleOptions", "traumaOptions", "ncpdRecords", "ncpdFolders", "mapMarkers", "libraryTree", "toolMacros"];
  const objects = ["agentChats", "agentMessages", "idProfiles", "monthlyNotices", "agentNotifications", "storeConfig", "appConfig", "chromeLayout"];
  arrays.forEach(k => s.world.set(k, [])); objects.forEach(k => s.world.set(k, {}));
  s.world.set("mapImagePath", "maps/my city.png"); s.world.set("librarySourceUrl", "");
  s.documents.set(a.uuid, a); game.actors = [a];
  a.setFlag = async (module, flag, value) => a.update({ [`flags.${module}.${flag}`]: value });
  await deltaWealth(a, -10, "Metadata backup");
  const backup = exportBackup(); validateBackup(backup);
  assert.equal(backup.data.mapImagePath, "maps/my city.png"); assert.equal(backup.ledgerMetadata[a.uuid].length, 1);
  assert.equal(backup.data["system.wealth.value"], undefined);
  await a.setFlag(MODULE_ID, "wealthMetadata", []);
  await restoreBackup(backup, backup.sections, "merge", {});
  assert.equal(a.system.wealth.value, 90); assert.equal(a.system.wealth.transactions.length, 1);
  assert.equal(a.getFlag(MODULE_ID, "wealthMetadata").length, 1);
});

test("socket mutation uses the v12 authenticated sender; no-GM and persistent notification preferences", async () => {
  const s = setup(); initSocket();
  const receive = [...s.callbacks.values()][0];
  const packet = { action: "mutate", op: "chatFolder.create", payload: { name: "Folder" }, userId: "a", requestId: `${Date.now()}:socket` };
  await receive(packet); assert.ok(!getWorld("chatFolders"), "A claimed userId is insufficient");
  await receive(packet, "outsider"); assert.ok(!getWorld("chatFolders"), "A mismatched server sender is rejected");
  await receive(packet, "a"); await receive(packet, "a"); assert.equal(getWorld("chatFolders").length, 1);
  s.gm.active = false; game.user = s.a;
  assert.equal(await mutate("chatFolder.create", { name: "Offline" }), false);
  assert.equal(operationStates().at(-1).status, "noGM");
  s.world.set("agentNotifications", { a: [{ id: "n", kind: "message", chatId: "chat", ts: 1 }] });
  await s.a.setFlag(MODULE_ID, "mutedChats", { chat: true });
  assert.equal(muted(history()[0]), true); assert.equal(history()[0].read, false);
  await s.a.setFlag(MODULE_ID, "notificationRead", { n: true }); assert.equal(history()[0].read, true);
});

function match(kind) { const r = createRoom("room", kind, "a", 1000); joinRoom(r, "b", 1000); r.players.forEach(p => p.ready = true); startRoom(r, "a", 42, 1000); return r; }
function move(r, userId, cell) { roomInput(r, userId, r.round, [{ seq: r.players.find(p => p.id === userId).seq + 1, cell }], 2000); }
test("FOUR LINK rejects wrong turns, detects a win; Reversi captures, passes and finishes with a consistent result", () => {
  const four = match("connect4"); move(four, "b", 1); assert.ok(four.game.cells.every(v => !v));
  for (let i = 0; i < 3; i++) { move(four, "a", 0); move(four, "b", 1); } move(four, "a", 0);
  assert.equal(four.winner, "a"); assert.equal(four.phase, "finished");
  const r = match("reversi"); assert.equal(legalCells(r).length, 4);
  let n = 0;
  while (r.phase === "playing" && n++ < 100) { const cells = legalCells(r); assert.ok(cells.length); move(r, r.game.turn, cells[0]); }
  assert.equal(r.phase, "finished"); assert.ok(["a", "b", null].includes(r.winner));
  const counts = [1, 2].map(c => r.game.cells.filter(v => v === c).length);
  assert.equal(r.winner, counts[0] === counts[1] ? null : counts[0] > counts[1] ? "a" : "b");
});
test("authoritative Tetris gravity advances without a mounted client, and shared pause shifts both clocks", () => {
  setup(); const r = match("tetris");
  tickRoom(r, 1650); assert.equal(r.game.boards.a.piece.y, 1); assert.equal(r.game.boards.b.piece.y, 1);
  setRoomPaused(r, true, 1700); tickRoom(r, 10000);
  assert.equal(r.game.boards.a.piece.y, 1);
  assert.equal(roomInput(r, "a", 1, [{ seq: 1, move: "drop" }], 5000), false);
  setRoomPaused(r, false, 10000); tickRoom(r, 10600);
  assert.equal(r.game.boards.a.piece.y, 2); assert.equal(r.game.boards.b.piece.y, 2);
});
