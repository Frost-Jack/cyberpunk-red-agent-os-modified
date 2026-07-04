/* Cyberpunk Agent OS — entry point: settings, hooks, notifications. */

import { MODULE_ID, TPL, DEFAULT_HOUSING, DEFAULT_LIFESTYLES, DEFAULT_TRAUMA } from "./constants.js";
import { AgentAudio } from "./audio.js";
import { initSocket } from "./socket.js";
import { AgentOSApplication } from "./agent-app.js";
import { syncBroadcast, applyVolume } from "./apps/radio.js";

const WORLD_OBJECTS = {
  agentChats: {},
  agentMessages: {},
  gardenContacts: [],
  agentShards: [],
  datapoolFolders: [],
  personalContacts: [],
  contactFolders: [],
  ncpdRecords: [],
  ncpdFolders: [],
  mapMarkers: [],
  idProfiles: {},
  housingOptions: [],
  lifestyleOptions: [],
  traumaOptions: [],
  storeConfig: {},
  appConfig: {},
  libraryTree: [],
  toolMacros: [],
  chromeLayout: {},
  radioBroadcast: { active: false, slug: "", playing: false, ts: 0 }
};

Hooks.once("init", () => {
  for (const [key, def] of Object.entries(WORLD_OBJECTS)) {
    game.settings.register(MODULE_ID, key, {
      scope: "world", config: false,
      type: Object, default: foundry.utils.deepClone(def)
    });
  }
  game.settings.register(MODULE_ID, "mapImagePath", {
    scope: "world", config: false, type: String,
    default: `modules/${MODULE_ID}/assets/night-city-map-red-final-v2.png`
  });
  game.settings.register(MODULE_ID, "defaultsSeeded", {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "librarySourceUrl", {
    scope: "world", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "enableCallAnimation", {
    name: "AGENTOS.Settings.CallAnimation",
    hint: "AGENTOS.Settings.CallAnimationHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "soundsEnabled", {
    name: "AGENTOS.Settings.Sounds",
    hint: "AGENTOS.Settings.SoundsHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "messageIndicatorEnabled", {
    name: "AGENTOS.Settings.MessageIndicator",
    hint: "AGENTOS.Settings.MessageIndicatorHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "radioVolume", {
    scope: "client", config: false, type: Number, default: 60
  });
  game.settings.register(MODULE_ID, "mapMarkerScale", {
    scope: "client", config: false, type: Number, default: 1
  });

  registerHandlebarsHelpers();
  globalThis.AgentOSAudio = AgentAudio;
});

Hooks.once("ready", async () => {
  initSocket();
  globalThis.AgentOS = { ui: new AgentOSApplication() };

  await loadTemplates([
    "shell", "home", "chat", "chat-thread", "datapool", "datapool-folder", "datapool-row", "wallet",
    "contacts", "contact-folder", "contact-row", "map", "bio", "chrome", "chrome-item", "chrome-panel", "chrome-merged-stub", "radio", "store", "id", "ncpd", "ncpd-folder", "ncpd-card", "garden",
    "library", "tools", "tools-card", "arcade", "admin", "settings"
  ].map(TPL));

  // Seed default Housing / Lifestyle options once (GM only).
  if (game.user.isGM && !game.settings.get(MODULE_ID, "defaultsSeeded")) {
    const housing = game.settings.get(MODULE_ID, "housingOptions") || [];
    const lifestyle = game.settings.get(MODULE_ID, "lifestyleOptions") || [];
    if (!housing.length) await game.settings.set(MODULE_ID, "housingOptions", DEFAULT_HOUSING);
    if (!lifestyle.length) await game.settings.set(MODULE_ID, "lifestyleOptions", DEFAULT_LIFESTYLES);
    await game.settings.set(MODULE_ID, "defaultsSeeded", true);
  }

  // Seed Trauma Team packages for any world where they're absent (idempotent).
  if (game.user.isGM) {
    const trauma = game.settings.get(MODULE_ID, "traumaOptions") || [];
    if (!trauma.length) await game.settings.set(MODULE_ID, "traumaOptions", DEFAULT_TRAUMA);
  }

  // One-off price correction for already-seeded worlds (idempotent).
  if (game.user.isGM) {
    const housing = game.settings.get(MODULE_ID, "housingOptions") || [];
    const pent = housing.find(h => h.id === "h_pent" && h.buy === 500000);
    if (pent) {
      pent.buy = 150000;
      await game.settings.set(MODULE_ID, "housingOptions", housing);
    }
  }
});

/* Toolbar button among Foundry's token tools. */
Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.find(c => c.name === "token");
  if (!tokenControls) return;
  tokenControls.tools.push({
    name: "agent-os-app",
    title: game.i18n.localize("AGENTOS.OpenAgent"),
    icon: "fas fa-mobile-screen-button",
    button: true,
    onClick: () => globalThis.AgentOS?.ui?.render(true)
  });
});

/* Re-render the open Agent when any of our world settings changes. */
const _rerenderDebounced = foundry.utils.debounce(() => {
  const app = globalThis.AgentOS?.ui;
  if (app?.rendered) app.render(false);
}, 100);

Hooks.on("updateSetting", (setting) => {
  if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;
  // GM radio takeover: reconcile local playback with the broadcast even when
  // the Radio app isn't open, so players follow the GM's station live.
  if (setting.key === `${MODULE_ID}.radioBroadcast`) syncBroadcast();
  _rerenderDebounced();
});

/* Radio volume tracks Foundry's global music (playlist) volume — re-apply the
 * scaled stream volume live whenever the player drags that slider. */
Hooks.on("globalPlaylistVolumeChanged", () => applyVolume());

/* Live wallet / biomonitor sync. */
Hooks.on("updateActor", (actor) => {
  const app = globalThis.AgentOS?.ui;
  if (!app?.rendered) return;
  if (["wallet", "bio"].includes(app.currentApp)) _rerenderDebounced();
  // Installing a foundational cyberware updates the actor's installedItems.list.
  if (app.currentApp === "chrome") _rerenderDebounced();
});

/* Live Chrome sync — installing / uninstalling / editing cyberware fires
 * item hooks on the actor's embedded items. Refresh the implant viewer. */
const _chromeRefresh = (item) => {
  const app = globalThis.AgentOS?.ui;
  if (!app?.rendered || app.currentApp !== "chrome") return;
  if (item?.type === "cyberware" || item?.parent?.documentName === "Actor") _rerenderDebounced();
};
Hooks.on("createItem", _chromeRefresh);
Hooks.on("updateItem", _chromeRefresh);
Hooks.on("deleteItem", _chromeRefresh);

/* Client-side notifications (fired locally on GM, via socket elsewhere). */
Hooks.on(`${MODULE_ID}.notify`, async (data) => {
  const app = globalThis.AgentOS?.ui;
  const isGM = game.user.isGM;

  const forMe = (ids) => Array.isArray(ids) && ids.includes(game.user.id);

  if (data.kind === "message") {
    const participant = forMe(data.participantUserIds);
    if (!participant && !isGM) return;
    // Author's own client gets no ping.
    if (data.senderKey === `player:${game.user.id}`) { _rerenderDebounced(); return; }
    const viewingThread = app?.rendered && app.currentApp === "chat" && app.state.chatId === data.chatId;
    if (participant && viewingThread) {
      const { markChatRead } = await import("./data.js");
      await markChatRead(data.chatId);
    }
    if (participant && !viewingThread) {
      AgentAudio.play("message");
      showToast(`${data.senderName}`, data.preview, () => {
        const ui2 = globalThis.AgentOS?.ui;
        if (!ui2) return;
        ui2.openChatThread(data.chatId);
        ui2.render(true);
      });
    }
    _rerenderDebounced();
  } else if (data.kind === "shard") {
    if (forMe(data.recipientUserIds)) {
      AgentAudio.play("message");
      showToast(game.i18n.localize("AGENTOS.Notify.NewShard"), data.title);
    }
    _rerenderDebounced();
  } else if (data.kind === "transfer") {
    if (forMe(data.recipientUserIds)) {
      AgentAudio.play("cash");
      showToast(game.i18n.localize("AGENTOS.Notify.TransferIn"),
        `${data.fromName}: ${data.amount}€$`);
    }
    _rerenderDebounced();
  } else if (data.kind === "purchase") {
    if (forMe(data.recipientUserIds)) AgentAudio.play("cash");
    _rerenderDebounced();
  } else if (data.kind === "contactShared") {
    if (forMe(data.recipientUserIds)) {
      AgentAudio.play("message");
      showToast(game.i18n.localize("AGENTOS.Notify.ContactShared"), data.name);
    }
    _rerenderDebounced();
  }
});

/* Floating toast, clickable, auto-dismisses. */
export function showToast(title, body, onClick) {
  try {
    if (game.settings.get(MODULE_ID, "messageIndicatorEnabled") === false) return;
  } catch (e) { /* noop */ }
  const el = document.createElement("div");
  el.className = "agentos-toast";
  el.innerHTML = `<div class="agentos-toast-title"></div><div class="agentos-toast-body"></div>`;
  el.querySelector(".agentos-toast-title").textContent = title || "";
  el.querySelector(".agentos-toast-body").textContent = body || "";
  el.addEventListener("click", () => { el.remove(); onClick?.(); });
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add("fade"); setTimeout(() => el.remove(), 600); }, 7000);
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("agEq", (a, b) => a === b);
  Handlebars.registerHelper("agNeq", (a, b) => a !== b);
  Handlebars.registerHelper("agGt", (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper("agOr", (a, b) => a || b);
  Handlebars.registerHelper("agAnd", (a, b) => a && b);
  Handlebars.registerHelper("agIncludes", (arr, v) => Array.isArray(arr) && arr.includes(v));
  Handlebars.registerHelper("agTime", (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });
  Handlebars.registerHelper("agDate", (ts) => {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString();
  });
  Handlebars.registerHelper("agNum", (n) => Number(n || 0).toLocaleString());
  Handlebars.registerHelper("agConcat", (...args) => args.slice(0, -1).join(""));
}
