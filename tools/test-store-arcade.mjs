/* Regression checks for availability, checkout quantities and public records.
 * These are document mocks, not a live Foundry integration test. */
import test from "node:test";
import assert from "node:assert/strict";
import { availableToPlayer, itemRarity, deliverStoreItems } from "../scripts/store-rules.js";
import { leaderboardRows } from "../scripts/apps/arcade.js";
import { getData as storeData, invalidateCatalog } from "../scripts/apps/store.js";
import { applyOp } from "../scripts/data.js";

function foundryMocks(config, buyer, docs = []) {
  const player = { id: "player", name: "Player", isGM: false, character: buyer };
  globalThis.foundry = { utils: { deepClone: clone, getProperty: (object, key) => key.split(".").reduce((o, part) => o?.[part], object) } };
  globalThis.Hooks = { callAll() {} };
  globalThis.game = {
    user: player,
    users: Object.assign([player], { get: id => id === player.id ? player : null }),
    settings: { get: () => config }, packs: new Map(), socket: { emit() {} },
    i18n: { localize: key => key }
  };
  globalThis.fromUuid = async uuid => uuid === "Actor.buyer" ? buyer : docs.find(d => d.uuid === uuid);
}

const clone = value => structuredClone(value);
function item(name = "Ammo", amount = 10, extra = {}, type = "ammo", flags = {}) {
  const data = { _id: "source", name, type, system: { amount, price: { market: 10 }, equipped: "owned", ...extra }, flags };
  return { id: "source", type, name, system: data.system, toObject: () => clone(data) };
}
function actor(items = []) {
  let nextId = 0;
  return {
    items, creates: 0, updates: 0,
    async createEmbeddedDocuments(kind, data, options) {
      assert.equal(kind, "Item");
      assert.equal(options.CPRsplitStack, true);
      assert.equal(options.createInstalled, true);
      this.creates++;
      return data.map(d => {
        assert.equal(d._id, undefined);
        const created = { id: `new-${++nextId}`, type: d.type, system: d.system, toObject: () => clone(d) };
        this.items.push(created);
        return created;
      });
    },
    async updateEmbeddedDocuments(kind, updates) {
      assert.equal(kind, "Item");
      this.updates++;
      for (const update of updates) this.items.find(i => i.id === update._id).system.amount = update["system.amount"];
    },
    async deleteEmbeddedDocuments(kind, ids) { this.items = this.items.filter(i => !ids.includes(i.id)); }
  };
}

test("RED rarity boundaries, including intermediate prices and Super Luxury", () => {
  for (const [price, expected] of [[0, "free"], [1, "dirtCheap"], [5, "dirtCheap"], [10, "cheap"], [499, "premium"], [500, "expensive"], [9999, "luxury"], [90000, "superLuxury"]]) {
    assert.equal(itemRarity(price), expected);
  }
});

test("rarity overrides, unlimited option and explicit deprecated price caps", () => {
  assert.equal(availableToPlayer({ price: 499 }, {}, "player"), true);
  assert.equal(availableToPlayer({ price: 500 }, {}, "player"), false);
  const cfg = { maxRarity: "expensive", playerMaxRarity: { player: "luxury", other: "" } };
  assert.equal(availableToPlayer({ price: 6000 }, cfg, "player"), true);
  assert.equal(availableToPlayer({ price: 10000 }, cfg, "player"), false);
  assert.equal(availableToPlayer({ price: 100000 }, cfg, "other"), true);
  assert.equal(availableToPlayer({ price: 101 }, { maxRarity: "", maxPrice: 100 }, "player"), false);
  assert.equal(availableToPlayer({ price: 101 }, { maxPrice: 100, playerMaxPrice: { player: 0 } }, "player"), true);
});

test("closed-sheet purchases add pack quantities to existing carried/loaded ammunition", async () => {
  const existing = item("Ammo", 3, { equipped: "carried" }, "ammo", { core: { sourceId: "Compendium.ammo" } });
  existing.system.isInstalled = true;
  // isInstalled is a CPR getter, not a stored system field.
  const base = existing.toObject;
  existing.toObject = () => { const data = base(); delete data.system.isInstalled; return data; };
  const buyer = actor([existing]);
  await deliverStoreItems(buyer, [item(), item()]);
  assert.equal(buyer.items.length, 1);
  assert.equal(existing.system.amount, 23);
  assert.equal(existing.system.equipped, "carried");
  assert.equal(buyer.updates, 1);
});

test("duplicate purchases in one cart form a single new stack", async () => {
  const buyer = actor();
  await deliverStoreItems(buyer, [item(), item(), item()]);
  assert.equal(buyer.items.length, 1);
  assert.equal(buyer.items[0].system.amount, 30);
  assert.equal(buyer.creates, 1);
});

test("different upgrades, installed gear, effects and non-stackable items stay separate", async () => {
  const existing = item("Gear", 2, { installedItems: { list: ["upgrade"] } }, "gear");
  const buyer = actor([existing]);
  await deliverStoreItems(buyer, [item("Gear", 1, { installedItems: { list: [] } }, "gear")]);
  assert.equal(buyer.items.length, 2);
  const installed = item("Chip", 1, {}, "gear");
  installed.system.isInstalled = true;
  const buyer2 = actor([installed]);
  await deliverStoreItems(buyer2, [item("Chip", 1, {}, "gear")]);
  assert.equal(buyer2.items.length, 2);
  const nonStack = item("Weapon", undefined, {}, "weapon");
  delete nonStack.system.amount;
  await deliverStoreItems(buyer2, [nonStack, nonStack]);
  assert.equal(buyer2.items.length, 4);
  const modified = item("Ammo");
  const base = modified.toObject;
  modified.toObject = () => ({ ...base(), effects: [{ name: "modified" }] });
  const buyer3 = actor([modified]);
  await deliverStoreItems(buyer3, [item()]);
  assert.equal(buyer3.items.length, 2);
});

test("failed update rolls back new items and restores old quantities", async () => {
  const existing = item("Ammo", 3);
  const buyer = actor([existing]);
  const update = buyer.updateEmbeddedDocuments;
  let fail = true;
  buyer.updateEmbeddedDocuments = async function (...args) {
    await update.apply(this, args);
    if (fail) { fail = false; throw new Error("test failure"); }
  };
  await assert.rejects(deliverStoreItems(buyer, [item(), item("Other")]));
  assert.equal(existing.system.amount, 3);
  assert.equal(buyer.items.length, 1);
});

test("leaderboard includes GMs, hides opted-out users, sorts and handles ties", () => {
  globalThis.game = { user: { id: "me" } };
  const user = (id, value, hidden = false, isGM = false) => ({ id, name: id, isGM, getFlag: (mod, key) => key === "arcadeScoresHidden" ? hidden : { mine: value, snake: value } });
  const users = [user("me", 20), user("gm", 10, false, true), user("tie", 20), user("secret", 1, true), user("bad", Infinity)];
  const rows = leaderboardRows("mine", users);
  assert.deepEqual(rows.map(r => r.id), ["gm", "me", "tie"]);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 2]);
  assert.equal(rows[0].gm, true);
  assert.equal(rows[1].mine, true);
  assert.equal(leaderboardRows("snake", users)[0].value, 20);
});

test("type searches span enabled sources without replacing custom compendium tabs", async () => {
  foundryMocks({ maxRarity: "", extraPacks: ["custom.mixed"] }, { uuid: "Actor.buyer", system: { wealth: { value: 1000 } } });
  const entry = (id, name, type) => ({ _id: id, name, type, system: { price: { market: 100 } } });
  game.packs.set("cyberpunk-red-core.core_cyberware", {
    documentName: "Item", metadata: { label: "Cyberware" },
    getIndex: async () => [entry("core", "Core implant", "cyberware")]
  });
  game.packs.set("custom.mixed", {
    documentName: "Item", metadata: { label: "Mixed" },
    getIndex: async () => [entry("extra", "Extra implant", "cyberware"), entry("gear", "Extra gear", "gear")]
  });
  invalidateCatalog();
  let loaded;
  const loading = new Promise(resolve => { loaded = resolve; });
  const app = { state: { category: "Mixed" }, currentApp: "store", rendered: true, render: loaded };
  await storeData(app);
  await loading;
  let data = await storeData(app);
  assert.ok(data.categories.some(c => c.id === "Mixed"));
  assert.equal(data.items.length, 2);
  app.state.browseMode = "types";
  app.state.itemType = "cyberware";
  data = await storeData(app);
  assert.deepEqual(data.items.map(i => i.name).sort(), ["Core implant", "Extra implant"]);
  app.state.typeSearch = "Extra";
  data = await storeData(app);
  assert.deepEqual(data.items.map(i => i.name), ["Extra implant"]);
  app.state.browseMode = "sources";
  data = await storeData(app);
  assert.equal(data.items.length, 2);
});

test("server checkout serializes purchases for one actor and revalidates rarity/sources", async () => {
  const buyer = actor([item("Ammo", 3)]);
  buyer.system = { wealth: { value: 1000 } };
  buyer.testUserPermission = () => true;
  buyer.deltaLedgerProperty = async (prop, delta) => { buyer.system.wealth.value += delta; };
  const doc = item();
  Object.assign(doc, { documentName: "Item", pack: "cyberpunk-red-core.core_ammo", uuid: "Compendium.cyberpunk-red-core.core_ammo.Item.source" });
  const cfg = { maxRarity: "premium" };
  foundryMocks(cfg, buyer, [doc]);
  game.user = { id: "gm", isGM: true };
  const settings = new Map([["storeConfig", cfg]]);
  game.settings.get = (module, key) => settings.get(key);
  game.settings.set = async (module, key, value) => settings.set(key, value);
  foundry.utils.randomID = () => String(Math.random());
  const order = { actorUuid: "Actor.buyer", itemUuids: [doc.uuid] };
  const results = await Promise.all([applyOp("store.checkout", order, "player"), applyOp("store.checkout", order, "player")]);
  assert.deepEqual(results, [true, true]);
  assert.equal(buyer.system.wealth.value, 980);
  assert.equal(buyer.items[0].system.amount, 23);
  doc.system.price.market = 500;
  assert.equal(await applyOp("store.checkout", order, "player"), false);
  assert.equal(buyer.system.wealth.value, 980);
  doc.system.price.market = 10;
  doc.pack = "disabled.pack";
  assert.equal(await applyOp("store.checkout", order, "player"), false);
  assert.equal(buyer.items[0].system.amount, 23);
});
