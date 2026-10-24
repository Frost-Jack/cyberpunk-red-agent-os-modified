/* Data/refresh/catalog regression checks with Foundry mocks, not a live world. */
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import * as Data from "../scripts/data.js";
import { getData as storeData, invalidateCatalog, activateListeners as wireStore } from "../scripts/apps/store.js";
import { MODULE_ID } from "../scripts/constants.js";

function setup(world = {}) {
  const flags = {};
  const player = {
    id: "player", isGM: false, character: { uuid: "Actor.player" },
    getFlag: (module, key) => flags[key],
    setFlag: async (module, key, value) => { flags[key] = value; }
  };
  globalThis.game = {
    user: player,
    users: Object.assign([player], { get: id => id === "player" ? player : null }),
    packs: new Map(), settings: { get: (module, key) => world[key] },
    i18n: { localize: key => key }
  };
  globalThis.foundry = { utils: {
    deepClone: value => structuredClone(value),
    debounce: fn => fn,
    getProperty: (object, key) => key.split(".").reduce((o, k) => o?.[k], object)
  } };
  return flags;
}

test("unreads read history once without cloning it; returned threads remain isolated", async () => {
  const world = {
    agentChats: {
      joined: { id: "joined", ts: 1, participants: [{ key: "player:player" }] },
      private: { id: "private", ts: 1, participants: [] }
    },
    agentMessages: {
      joined: [
        { ts: 1, authorUserId: "other", senderKey: "player:other", body: "old" },
        { ts: 2, authorUserId: "player", senderKey: "player:player", body: "mine" },
        { ts: 3, authorUserId: "gm", senderKey: "garden:npc", body: "GM line" },
        { ts: 4, authorUserId: "other", senderKey: "player:other", body: "incoming" }
      ],
      private: [{ ts: 4, authorUserId: "other", body: "private" }]
    }
  };
  const flags = setup(world);
  flags.lastRead = { joined: 1 };
  let fullCopies = 0, threadCopies = 0, reads = 0;
  game.settings.get = (module, key) => { if (key === "agentMessages") reads++; return world[key]; };
  foundry.utils.deepClone = value => {
    if (value === world.agentMessages) fullCopies++;
    if (value === world.agentMessages.joined) threadCopies++;
    return structuredClone(value);
  };
  assert.deepEqual(Data.unreadCounts(), { joined: 2 });
  assert.equal(reads, 1);
  assert.equal(fullCopies, 0);
  assert.equal(threadCopies, 0);
  const thread = Data.getMessages("joined");
  thread[0].body = "changed";
  thread.push({ ts: 9 });
  assert.equal(world.agentMessages.joined[0].body, "old");
  assert.equal(world.agentMessages.joined.length, 4);
  assert.equal(threadCopies, 1);
  assert.equal(fullCopies, 0);
  const last = Data.getLastMessage("joined");
  last.body = "changed preview";
  assert.equal(world.agentMessages.joined.at(-1).body, "incoming");
  assert.equal(threadCopies, 1, "Chat previews must not copy a full thread");
  game.user.id = "gm";
  game.user.isGM = true;
  assert.deepEqual(Data.unreadCounts(), { joined: 2, private: 1 });
  await Data.markChatRead("joined");
  assert.equal(Data.unreadCounts().joined, 0);
  world.agentMessages.joined.push({ ts: Date.now() + 10, authorUserId: "other" });
  assert.equal(Data.unreadCounts().joined, 1, "No stale count after history changes");
});

test("settings and notifications refresh only affected views and coalesce bursts", async () => {
  setup({ soundsEnabled: false, messageIndicatorEnabled: false });
  const hooks = new Map(), queues = [];
  globalThis.Application = class { static RENDER_STATES = { RENDERING: 1 }; };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
  globalThis.Hooks = { once() {}, on: (name, fn) => hooks.set(name, fn) };
  foundry.utils.debounce = fn => {
    let args;
    queues.push(() => { if (args) { const latest = args; args = null; fn(...latest); } });
    return (...values) => { args = values; };
  };
  await import("../scripts/main.js");
  const app = { rendered: true, currentApp: "datapool", state: { composing: true, compose: { body: "draft" } }, renders: 0, render() { this.renders++; } };
  globalThis.AgentOS = { ui: app };
  const flush = () => queues.forEach(fn => fn());
  const setting = key => hooks.get("updateSetting")({ key: `${MODULE_ID}.${key}` });
  setting("agentMessages");
  await hooks.get(`${MODULE_ID}.notify`)({ kind: "message", authorUserId: "player", participantUserIds: ["player"] });
  flush();
  assert.equal(app.renders, 0);
  assert.equal(app.state.compose.body, "draft");
  setting("agentShards"); setting("datapoolFolders"); flush();
  assert.equal(app.renders, 1, "One render for a burst of relevant changes");
  app.renders = 0;
  app.currentApp = "arcade"; app.state = { game: "snake" };
  setting("agentMessages"); setting("gardenContacts"); setting("agentShards"); flush();
  assert.equal(app.renders, 0, "Other apps' activity must not interrupt a game");
  setting("appConfig"); flush();
  assert.equal(app.renders, 1, "Jamming/visibility must update any open app");
  app.renders = 0;
  app.currentApp = null;
  setting("agentMessages"); flush();
  assert.equal(app.renders, 1, "Home still updates its unread badge");
  app.currentApp = "chat"; app.renders = 0;
  setting("agentMessages"); app.currentApp = "datapool"; flush();
  assert.equal(app.renders, 0, "An old pending refresh must not repaint a new view");
  app.currentApp = "radio";
  setting("radioVolume"); flush();
  assert.equal(app.renders, 0, "Volume sliders update locally without rebuilding the DOM");
  app.currentApp = "map";
  setting("mapMarkerScale"); flush();
  assert.equal(app.renders, 0);
  app.currentApp = "chrome";
  hooks.get("updateActor")({ uuid: "Actor.npc" }); flush();
  assert.equal(app.renders, 0);
  hooks.get("updateActor")({ uuid: "Actor.player" }); flush();
  assert.equal(app.renders, 1);
  app.renders = 0;
  hooks.get("updateItem")({ type: "cyberware", parent: { documentName: "Actor", uuid: "Actor.npc" } }); flush();
  assert.equal(app.renders, 0);
  hooks.get("updateItem")({ parent: { documentName: "Actor", uuid: "Actor.player" } }); flush();
  assert.equal(app.renders, 1);
  app.renders = 0;
  app.currentApp = "store"; app.state = {};
  hooks.get("updateActor")({ uuid: "Actor.player" }); flush();
  assert.equal(app.renders, 1, "Displayed buyer balance stays live");
  app.renders = 0;
  app.rendered = false; app._state = Application.RENDER_STATES.RENDERING;
  app.currentApp = "chat";
  setting("agentMessages");
  app.rendered = true; flush();
  assert.equal(app.renders, 1, "Relevant changes arriving mid-render are not dropped");
  app.renders = 0;
  app.currentApp = "store";
  hooks.get("updateItem")({ pack: "cyberpunk-red-core.core_gear" }); flush();
  assert.equal(app.renders, 1, "Compendium edits invalidate and refresh the catalog");
  app.renders = 0;
  app.currentApp = "chat"; app.state = { chatId: "joined" };
  const incoming = { kind: "message", chatId: "joined", authorUserId: "other", participantUserIds: ["other"] };
  await hooks.get(`${MODULE_ID}.notify`)(incoming); flush();
  assert.equal(app.renders, 0, "Non-members receive no notification refresh");
  game.user.id = "gm"; game.user.isGM = true;
  await hooks.get(`${MODULE_ID}.notify`)(incoming); flush();
  assert.equal(app.renders, 1, "The observing GM still refreshes and marks an open chat read");
  assert.ok(game.user.getFlag(MODULE_ID, "lastRead").joined > 0);
});

test("catalog loads up to four indexes at once and keeps its cache for pricing changes", async () => {
  const cfg = { maxRarity: "", extraPacks: Array.from({ length: 8 }, (_, i) => `custom.pack${i}`) };
  setup({ storeConfig: cfg });
  let active = 0, peak = 0, calls = 0;
  for (const packId of cfg.extraPacks) game.packs.set(packId, {
    documentName: "Item", metadata: { label: packId },
    getIndex: async () => {
      calls++; peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return [{ _id: packId, name: packId, type: "gear", system: { price: { market: 100 } } }];
    }
  });
  invalidateCatalog();
  let done;
  const loaded = new Promise(resolve => { done = resolve; });
  const app = { state: {}, currentApp: "store", rendered: true, render: done };
  assert.equal((await storeData(app)).loading, true);
  await loaded;
  assert.equal(peak, 4);
  assert.equal(calls, 8);
  assert.equal((await storeData(app)).loading, false);
  cfg.markup = -20;
  assert.equal((await storeData(app)).items[0].shownPrice, 80);
  assert.equal(calls, 8, "Price changes do not reload compendium indexes");
  cfg.extraPacks = [];
  const refreshed = new Promise(resolve => { app.render = resolve; });
  assert.equal((await storeData(app)).loading, true);
  await refreshed;
  assert.equal((await storeData(app)).categories.length, 0, "Disabled sources disappear on every client");
});

test("catalog completion does not repaint closed or unrelated apps", async () => {
  for (const closed of [false, true]) {
    setup({ storeConfig: { extraPacks: ["custom.slow"] } });
    let release;
    game.packs.set("custom.slow", { documentName: "Item", metadata: { label: "Slow" }, getIndex: () => new Promise(resolve => { release = resolve; }) });
    invalidateCatalog();
    const app = { state: {}, rendered: true, currentApp: "store", renders: 0, render() { this.renders++; } };
    await storeData(app);
    if (closed) app.rendered = false;
    else app.currentApp = "datapool";
    release([]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.renders, 0);
  }
});

test("fast catalog completion during Foundry v12 render cannot leave a loading screen", async () => {
  setup({ storeConfig: {} });
  invalidateCatalog();
  const app = { state: {}, currentApp: "store", rendered: false, renders: 0, render() { this.renders++; } };
  assert.equal((await storeData(app)).loading, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.renders, 0);
  const collection = length => Object.assign([], { length, on() {} });
  const html = { find: selector => collection(selector === ".agentos-store-loading" ? 1 : 0), on() {} };
  wireStore(app, html);
  // Application v12 sets RENDERED synchronously after activateListeners returns.
  app.rendered = true;
  await Promise.resolve();
  assert.equal(app.renders, 1);
  assert.equal((await storeData(app)).loading, false);
});

test("invalidating an in-flight catalog discards its stale results", async () => {
  const cfg = { maxRarity: "", extraPacks: ["custom.old"] };
  setup({ storeConfig: cfg });
  let release;
  game.packs.set("custom.old", { documentName: "Item", metadata: { label: "Old" }, getIndex: () => new Promise(resolve => { release = resolve; }) });
  invalidateCatalog();
  const app = { state: {}, currentApp: "store", rendered: true, render() {} };
  await storeData(app);
  cfg.extraPacks = [];
  invalidateCatalog();
  release([{ _id: "old", name: "Old", type: "gear", system: { price: { market: 10 } } }]);
  await new Promise(resolve => setImmediate(resolve));
  const loaded = new Promise(resolve => { app.render = resolve; });
  assert.equal((await storeData(app)).loading, true);
  await loaded;
  assert.equal((await storeData(app)).items.length, 0);
});

test("a failed compendium does not discard the rest of the catalog", async () => {
  setup({ storeConfig: { maxRarity: "", extraPacks: ["custom.bad", "custom.good"] } });
  game.packs.set("custom.bad", { documentName: "Item", metadata: { label: "Bad" }, getIndex: async () => { throw new Error("offline"); } });
  game.packs.set("custom.good", { documentName: "Item", metadata: { label: "Good" }, getIndex: async () => [{ _id: "good", name: "Good", type: "gear", system: { price: { market: 100 } } }] });
  invalidateCatalog();
  let done;
  const loaded = new Promise(resolve => { done = resolve; });
  const app = { state: {}, rendered: true, currentApp: "store", render: done };
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await storeData(app);
    await loaded;
    assert.deepEqual((await storeData(app)).items.map(item => item.name), ["Good"]);
    assert.equal(warnings.length, 1);
  } finally { console.warn = warn; }
});

if (process.argv.includes("--benchmark")) {
  test("synthetic unread benchmark (milliseconds, not live-world latency)", () => {
    for (const count of [10, 25, 50]) {
      const world = { agentChats: {}, agentMessages: {} };
      for (let c = 0; c < count; c++) {
        const id = `chat-${c}`;
        world.agentChats[id] = { id, ts: c + 1, participants: [] };
        world.agentMessages[id] = Array.from({ length: 100 }, (_, m) => ({ id: `${c}-${m}`, ts: m + 1, authorUserId: "player", body: "sample message ".repeat(64) }));
      }
      setup(world); game.user.isGM = true; game.user.id = "gm";
      const previous = () => Object.fromEntries(Data.allChats().map(chat => [chat.id,
        structuredClone(world.agentMessages)[chat.id].filter(m => m.ts > 0 && m.authorUserId !== "gm").length
      ]));
      const median = fn => {
        const times = [];
        for (let run = 0; run < 4; run++) {
          const start = performance.now(); fn(); times.push(performance.now() - start);
        }
        times.shift(); times.sort((a, b) => a - b);
        return +times[1].toFixed(3);
      };
      assert.deepEqual(Data.unreadCounts(), previous());
      console.log(JSON.stringify({ clone: "structuredClone fixture", chats: count, messages: count * 100, beforeMs: median(previous), afterMs: median(Data.unreadCounts) }));
    }
  });
}
