/* Three independent clients and a document/socket relay in memory.
 * Delays, duplication, reordering and lost confirmations never touch a world. */
import assert from "node:assert/strict";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { MODULE_ID } from "../scripts/constants.js";
import { mutate, operationStates } from "../scripts/data.js";
import { initSocket } from "../scripts/socket.js";

function set(object, path, value, remove = false) {
  const keys = path.split("."), last = keys.pop();
  for (const key of keys) object = object[key] ||= {};
  if (remove) delete object[last]; else object[last] = structuredClone(value);
}
const get = (object, path) => path.split(".").reduce((o, key) => o?.[key], object);
if (!isMainThread) {
  const pending = new Map(), settings = new Map();
  let next = 0, receiver;
  function rpc(method, data) { return new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); parentPort.postMessage({ type: "rpc", id, method, data }); }); }
  const users = Object.assign(["gm", "a", "b"].map(id => ({ id, name: id, isGM: id === "gm", active: true, flags: {},
    getFlag(m, key) { return get(this.flags, key); },
    async setFlag(m, key, value) { return rpc("flag", { userId: id, key, value }); },
    async unsetFlag(m, key) { return rpc("flag", { userId: id, key, remove: true }); }
  })), { get: id => users.find(u => u.id === id) });
  const actors = new Map();
  for (const id of ["a", "b"]) actors.set(`Actor.${id}`, {
    uuid: `Actor.${id}`, documentName: "Actor", name: id, ownerId: id, flags: {}, system: { wealth: { value: id === "a" ? 100 : 0, transactions: [] } },
    getFlag(m, f) { return get(this.flags, `${m}.${f}`); },
    testUserPermission(user) { return user.id === this.ownerId || user.isGM; },
    listRecords() { return this.system.wealth.transactions; },
    update(changes) { return rpc("actor", { uuid: this.uuid, changes }); },
    deltaLedgerProperty(prop, amount, reason) {
      const total = this.system.wealth.value + amount;
      const rows = [...this.system.wealth.transactions, [`wealth delta ${amount} total ${total}`, reason]];
      this.update({ "system.wealth.value": total, "system.wealth.transactions": rows });
      return this.system.wealth;
    }
  });
  const nativeTimeout = globalThis.setTimeout;
  // Production timeout is 15 seconds; shorten only that timeout in this worker.
  globalThis.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 15000 ? 150 : ms, ...args);
  globalThis.foundry = { utils: { deepClone: structuredClone, getProperty: get, randomID: () => `${workerData.id}-${++next}` } };
  globalThis.Hooks = { callAll() {} };
  globalThis.ui = { notifications: { warn() {}, info() {} } };
  globalThis.game = { user: users.get(workerData.id), users, settings: { get: (m, key) => settings.get(key), set: (m, key, value) => rpc("setting", { key, value }) },
    socket: { on: (channel, fn) => { receiver = fn; }, emit: (channel, packet, options) => { parentPort.postMessage({ type: "socket", packet, options }); } },
    i18n: { localize: key => key } };
  globalThis.fromUuid = async uuid => actors.get(uuid) || null;
  initSocket();
  parentPort.on("message", async message => {
    if (message.type === "response") {
      const p = pending.get(message.id); pending.delete(message.id);
      if (message.error) p?.reject(new Error(message.error)); else p?.resolve(message.value);
    } else if (message.type === "setting") settings.set(message.key, message.value);
    else if (message.type === "flag") set(users.get(message.userId).flags, message.key, message.value, message.remove);
    else if (message.type === "actor") for (const [path, value] of Object.entries(message.changes)) set(actors.get(message.uuid), path, value);
    else if (message.type === "active") users.get(message.userId).active = message.active;
    else if (message.type === "socket") await receiver(message.packet, message.senderId);
    else if (message.type === "command") {
      try {
        let value;
        if (message.method === "mutate") value = await mutate(message.data.op, message.data.payload);
        if (message.method === "concurrent") value = await Promise.all([mutate(message.data.op, message.data.payload), mutate(message.data.op, message.data.payload)]);
        if (message.method === "status") value = operationStates().at(-1)?.status;
        if (message.method === "requestId") value = operationStates().at(-1)?.requestId;
        parentPort.postMessage({ type: "done", id: message.id, value });
      } catch (error) { parentPort.postMessage({ type: "done", id: message.id, error: error.message }); }
    }
  });
  parentPort.postMessage({ type: "ready" });
} else {
  const clients = new Map(), commands = new Map(), world = new Map(), timeouts = new Set();
  const funds = { "Actor.a": 100, "Actor.b": 0 };
  let next = 0, dropAcks = false, duplicate = false, holdReceipts = false;
  const broadcast = data => { for (const worker of clients.values()) worker.postMessage(data); };
  const later = (fn, delay) => { const timer = setTimeout(() => { timeouts.delete(timer); fn(); }, delay); timeouts.add(timer); };
  const command = (id, method, data) => new Promise((resolve, reject) => {
    const key = ++next; commands.set(key, { resolve, reject }); clients.get(id).postMessage({ type: "command", id: key, method, data });
  });
  try {
    for (const id of ["gm", "a", "b"]) {
      const worker = new Worker(new URL(import.meta.url), { workerData: { id } }); clients.set(id, worker);
      await new Promise((ready, reject) => {
        worker.on("error", reject);
        worker.on("message", async message => {
          if (message.type === "ready") ready();
          else if (message.type === "done") {
            const p = commands.get(message.id); commands.delete(message.id);
            if (message.error) p?.reject(new Error(message.error)); else p?.resolve(message.value);
          } else if (message.type === "rpc") {
            try {
              const data = message.data;
              if (message.method === "flag") {
                assert.ok(data.userId === id || id === "gm"); broadcast({ type: "flag", ...data });
              } else if (message.method === "setting") {
                assert.equal(id, "gm"); world.set(data.key, structuredClone(data.value));
                if (holdReceipts && data.key === "operationReceipts") clients.get("gm").postMessage({ type: "setting", ...data });
                else broadcast({ type: "setting", ...data });
              } else if (message.method === "actor") {
                assert.equal(id, "gm"); if ("system.wealth.value" in data.changes) funds[data.uuid] = data.changes["system.wealth.value"];
                broadcast({ type: "actor", ...data });
              }
              worker.postMessage({ type: "response", id: message.id, value: true });
            } catch (error) { worker.postMessage({ type: "response", id: message.id, error: error.message }); }
          } else if (message.type === "socket") {
            if (dropAcks && message.packet.action === "mutateResult") return;
            for (const [target, peer] of clients) if (target !== id && (!message.options?.recipients || message.options.recipients.includes(target))) {
              later(() => peer.postMessage({ type: "socket", packet: message.packet, senderId: id }), duplicate ? 25 : 5);
              if (duplicate) later(() => peer.postMessage({ type: "socket", packet: message.packet, senderId: id }), 5);
            }
          }
        });
      });
    }
    duplicate = true;
    const created = await command("a", "concurrent", { op: "chat.create", payload: { name: "Crew", participantKeys: ["player:a", "player:b"] } });
    assert.equal(created[0], created[1]); assert.equal(Object.keys(world.get("agentChats")).length, 1);
    const chatId = created[0];
    const sends = await Promise.all([command("a", "mutate", { op: "msg.send", payload: { chatId, senderKey: "player:a", text: "A" } }), command("b", "mutate", { op: "msg.send", payload: { chatId, senderKey: "player:b", text: "B" } })]);
    assert.ok(sends.every(v => typeof v === "string")); assert.equal(world.get("agentMessages")[chatId].length, 2);
    console.log("PASS: three isolated clients, duplicate/out-of-order packets, concurrent chat writes and single creation");
    dropAcks = true;
    const transfer = { op: "wallet.transfer", payload: { fromActorUuid: "Actor.a", toActorUuid: "Actor.b", amount: 40, memo: "Lost acknowledgement" } };
    const waiting = command("a", "mutate", transfer);
    const requestId = await command("a", "requestId");
    clients.get("a").postMessage({ type: "socket", senderId: "b", packet: { action: "mutateResult", requestId, targetUserId: "a", hostId: "gm", result: false } });
    clients.get("a").postMessage({ type: "socket", senderId: "b", packet: { action: "mutateResult", requestId, targetUserId: "a", hostId: "gm", result: true } });
    assert.equal(await waiting, null, "A player cannot forge an early rejection from the GM");
    assert.equal(await command("a", "status"), "timeout"); assert.deepEqual(funds, { "Actor.a": 60, "Actor.b": 40 });
    world.set("appConfig", { disabled: { a: true } });
    broadcast({ type: "setting", key: "appConfig", value: world.get("appConfig") });
    dropAcks = false;
    assert.equal(await command("a", "mutate", transfer), true);
    assert.equal(await command("a", "status"), "success"); assert.deepEqual(funds, { "Actor.a": 60, "Actor.b": 40 });
    assert.equal(await command("a", "mutate", { ...transfer, payload: { ...transfer.payload, amount: 1, memo: "Blocked device" } }), false);
    assert.equal(await command("a", "status"), "rejected");
    world.set("appConfig", { player: { wallet: false } });
    broadcast({ type: "setting", key: "appConfig", value: world.get("appConfig") });
    assert.equal(await command("a", "mutate", { ...transfer, payload: { ...transfer.payload, amount: 2, memo: "Disabled app" } }), false);
    assert.equal(await command("a", "status"), "rejected");
    assert.deepEqual(funds, { "Actor.a": 60, "Actor.b": 40 });
    world.set("appConfig", {});
    broadcast({ type: "setting", key: "appConfig", value: {} });
    assert.equal(await command("a", "mutate", { op: "chatFolder.create", payload: { name: "Recovered" } }), true);
    console.log("PASS: immediate authenticated rejections for jammed devices/disabled apps; pre-block completed retry returns its original receipt without another transfer");
    holdReceipts = true;
    assert.equal(await command("a", "mutate", { ...transfer, payload: { ...transfer.payload, amount: 5, memo: "Local receipt is unavailable" } }), true);
    assert.equal(await command("a", "status"), "success");
    assert.deepEqual(funds, { "Actor.a": 55, "Actor.b": 45 });
    holdReceipts = false;
    broadcast({ type: "setting", key: "operationReceipts", value: world.get("operationReceipts") });
    console.log("PASS: transfer completes from the authenticated GM response without a local receipt snapshot");
    const forged = { action: "mutate", op: "wallet.gmGrant", payload: { toActorUuid: "Actor.b", amount: 999, senderName: "Spoof" }, userId: "gm", requestId: `${Date.now()}:forged` };
    clients.get("gm").postMessage({ type: "socket", packet: forged, senderId: "a" });
    await command("gm", "status"); assert.equal(funds["Actor.b"], 45);
    broadcast({ type: "active", userId: "gm", active: false });
    assert.equal(await command("b", "mutate", { op: "chatFolder.create", payload: { name: "Offline" } }), false);
    assert.equal(await command("b", "status"), "noGM");
    console.log("PASS: lost confirmation retries the same persisted request, no duplicate debit/credit; forged GM and no-GM paths");
  } finally {
    for (const timer of timeouts) clearTimeout(timer);
    await Promise.all([...clients.values()].map(w => w.terminate()));
  }
}
