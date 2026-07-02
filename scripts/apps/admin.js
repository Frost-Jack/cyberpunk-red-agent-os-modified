/* Sys Admin (GM only): global Agent configuration. */

import { MODULE_ID, APPS, STORE_CATEGORIES } from "../constants.js";
import * as Data from "../data.js";
import { invalidateCatalog } from "./store.js";
import { AgentAudio } from "../audio.js";

function storeCfg() {
  return foundry.utils.mergeObject({
    maxPrice: 100, sourceFilter: "all", lockedCategories: [],
    blacklist: [], extraPacks: [], markup: 0, playerMaxPrice: {}
  }, Data.getWorld("storeConfig") || {});
}

async function saveStoreCfg(patch) {
  const cfg = { ...storeCfg(), ...patch };
  await game.settings.set(MODULE_ID, "storeConfig", cfg);
  invalidateCatalog();
}

export async function getData(app) {
  if (!game.user.isGM) return {};
  const st = app.state;
  const cfg = storeCfg();
  const appCfg = Data.getWorld("appConfig") || {};

  const players = game.users.filter(u => !u.isGM);
  const appPlayerId = st.appPlayerId || players[0]?.id || "";
  const perPlayer = (appCfg.perPlayer || {})[appPlayerId] || {};
  const playerGlobal = appCfg.player || {};

  const extraPackChoices = game.packs
    .filter(p => p.documentName === "Item" && !p.collection.startsWith("cyberpunk-red-core."))
    .map(p => ({
      id: p.collection,
      label: `${p.metadata.label} (${p.collection})`,
      enabled: (cfg.extraPacks || []).includes(p.collection)
    }));

  return {
    mapImagePath: game.settings.get(MODULE_ID, "mapImagePath"),
    maxPrice: cfg.maxPrice,
    playerPrices: game.users.filter(u => !u.isGM).map(u => ({
      id: u.id,
      name: u.name,
      value: (cfg.playerMaxPrice || {})[u.id] ?? ""
    })),
    markup: cfg.markup,
    sourceFilter: cfg.sourceFilter,
    categories: STORE_CATEGORIES.map(c => ({
      id: c, locked: (cfg.lockedCategories || []).includes(c)
    })),
    blacklist: cfg.blacklist || [],
    extraPackChoices,
    appRows: APPS.filter(a => !a.gmOnly).map(a => ({
      id: a.id,
      label: game.i18n.localize(a.labelKey),
      gmOn: (appCfg.gm || {})[a.id] !== false,
      playerOn: playerGlobal[a.id] !== false
    })),
    appPlayers: players.map(p => ({ id: p.id, name: p.name, selected: p.id === appPlayerId })),
    appPlayerId,
    playerDisabled: !!(appCfg.disabled || {})[appPlayerId],
    hasPlayerOverrides: Object.keys(perPlayer).length > 0,
    perPlayerRows: appPlayerId ? APPS.filter(a => !a.gmOnly).map(a => ({
      id: a.id,
      label: game.i18n.localize(a.labelKey),
      on: perPlayer[a.id] !== undefined ? perPlayer[a.id] !== false : playerGlobal[a.id] !== false,
      overridden: perPlayer[a.id] !== undefined
    })) : []
  };
}

export function activateListeners(app, html) {
  if (!game.user.isGM) return;
  const st = app.state;

  /* Preserve scroll position across re-renders (the old version jumped to top). */
  const scroller = html.find(".agentos-app-body")[0];
  if (scroller) {
    if (st._scroll) scroller.scrollTop = st._scroll;
    scroller.addEventListener("scroll", () => { st._scroll = scroller.scrollTop; });
  }

  html.on("click", "[data-action='admin-map-pick']", async () => {
    const path = await app.pickFile("image");
    if (!path) return;
    await game.settings.set(MODULE_ID, "mapImagePath", path);
    app.render(false);
  });

  html.on("change", "[name='admin-max-price']", async (ev) => {
    await saveStoreCfg({ maxPrice: Math.max(0, Number(ev.currentTarget.value || 0)) });
  });

  /* Per-player price cap. Empty input → fall back to the global cap. */
  html.on("change", "[data-action='admin-player-price']", async (ev) => {
    const userId = ev.currentTarget.dataset.userId;
    const raw = String(ev.currentTarget.value).trim();
    const cfg = storeCfg();
    const map = { ...(cfg.playerMaxPrice || {}) };
    if (raw === "") delete map[userId];
    else map[userId] = Math.max(0, Number(raw) || 0);
    await saveStoreCfg({ playerMaxPrice: map });
  });

  html.on("change", "[name='admin-markup']", async (ev) => {
    await saveStoreCfg({ markup: Math.max(0, Number(ev.currentTarget.value || 0)) });
  });

  html.on("change", "[name='admin-source-filter']", async (ev) => {
    await saveStoreCfg({ sourceFilter: ev.currentTarget.value });
  });

  html.on("change", "[data-action='admin-cat-toggle']", async (ev) => {
    const cat = ev.currentTarget.dataset.cat;
    const cfg = storeCfg();
    const locked = new Set(cfg.lockedCategories || []);
    if (ev.currentTarget.checked) locked.add(cat); else locked.delete(cat);
    await saveStoreCfg({ lockedCategories: [...locked] });
  });

  html.on("change", "[data-action='admin-pack-toggle']", async (ev) => {
    const packId = ev.currentTarget.dataset.packId;
    const cfg = storeCfg();
    const packs = new Set(cfg.extraPacks || []);
    if (ev.currentTarget.checked) packs.add(packId); else packs.delete(packId);
    await saveStoreCfg({ extraPacks: [...packs] });
  });

  html.on("click", "[data-action='admin-blacklist-remove']", async (ev) => {
    const uuid = ev.currentTarget.dataset.uuid;
    const cfg = storeCfg();
    await saveStoreCfg({ blacklist: (cfg.blacklist || []).filter(b => b.uuid !== uuid) });
    app.render(false);
  });

  /* Drag an Item from a compendium into the blacklist dropzone. */
  const dropzone = html.find(".agentos-blacklist-drop")[0];
  if (dropzone) {
    dropzone.addEventListener("dragover", (ev) => { ev.preventDefault(); dropzone.classList.add("over"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
    dropzone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      dropzone.classList.remove("over");
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "Item" || !data.uuid) return;
        const doc = await fromUuid(data.uuid);
        if (!doc) return;
        const cfg = storeCfg();
        if ((cfg.blacklist || []).some(b => b.uuid === data.uuid)) return;
        await saveStoreCfg({ blacklist: [...(cfg.blacklist || []), { uuid: data.uuid, name: doc.name }] });
        AgentAudio.play("tap");
        app.render(false);
      } catch (e) { /* not an item drop */ }
    });
  }

  html.on("change", "[data-action='admin-app-toggle']", async (ev) => {
    const appId = ev.currentTarget.dataset.appId;
    const role = ev.currentTarget.dataset.role; // 'gm' | 'player'
    const cfg = foundry.utils.deepClone(Data.getWorld("appConfig") || {});
    cfg[role] = cfg[role] || {};
    cfg[role][appId] = ev.currentTarget.checked;
    await game.settings.set(MODULE_ID, "appConfig", cfg);
  });

  /* ---- per-player app overrides ---- */

  html.on("change", "[name='admin-app-player']", (ev) => {
    st.appPlayerId = ev.currentTarget.value;
    app.render(false);
  });

  html.on("change", "[data-action='admin-app-player-toggle']", async (ev) => {
    const appId = ev.currentTarget.dataset.appId;
    const userId = ev.currentTarget.dataset.userId;
    const cfg = foundry.utils.deepClone(Data.getWorld("appConfig") || {});
    cfg.perPlayer = cfg.perPlayer || {};
    cfg.perPlayer[userId] = cfg.perPlayer[userId] || {};
    cfg.perPlayer[userId][appId] = ev.currentTarget.checked;
    await game.settings.set(MODULE_ID, "appConfig", cfg);
  });

  /* Kill switch: cuts the player's Agent OS entirely (static + NET OFF). */
  html.on("change", "[data-action='admin-agent-disable']", async (ev) => {
    const userId = ev.currentTarget.dataset.userId;
    const cfg = foundry.utils.deepClone(Data.getWorld("appConfig") || {});
    cfg.disabled = cfg.disabled || {};
    cfg.disabled[userId] = ev.currentTarget.checked;
    await game.settings.set(MODULE_ID, "appConfig", cfg);
  });

  html.on("click", "[data-action='admin-app-player-reset']", async (ev) => {
    const userId = ev.currentTarget.dataset.userId;
    const cfg = foundry.utils.deepClone(Data.getWorld("appConfig") || {});
    if (cfg.perPlayer) delete cfg.perPlayer[userId];
    await game.settings.set(MODULE_ID, "appConfig", cfg);
  });
}
