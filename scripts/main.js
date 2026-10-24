/* Cyberpunk Agent OS — entry point: settings, hooks, notifications. */

import { MODULE_ID, TPL, DEFAULT_HOUSING, DEFAULT_LIFESTYLES, DEFAULT_TRAUMA, PACK_CATEGORIES } from "./constants.js";
import { AgentAudio } from "./audio.js";
import { initSocket } from "./socket.js";
import { AgentOSApplication } from "./agent-app.js";
import { syncBroadcast, applyVolume } from "./apps/radio.js";
import { invalidateCatalog } from "./apps/store.js";
import { muted, history as notificationHistory } from "./apps/notifications.js";

const WORLD_OBJECTS = {
  agentChats: {},
  agentMessages: {},
  chatFolders: [],
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
  operationReceipts: {},
  agentNotifications: {},
  monthlyNotices: {},
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
  game.settings.register(MODULE_ID, "toktikVolume", {
    scope: "client", config: false, type: Number, default: 100
  });
  game.settings.register(MODULE_ID, "toktikLastStart", {
    scope: "client", config: false, type: String, default: ""
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
    "shell", "home", "chat", "chat-thread", "chat-row", "datapool", "datapool-folder", "datapool-row", "shard-reader", "wallet",
    "contacts", "contact-folder", "contact-row", "map", "bio", "chrome", "chrome-item", "chrome-panel", "chrome-merged-stub", "radio", "store", "id", "ncpd", "ncpd-folder", "ncpd-card", "garden",
    "library", "tools", "tools-card", "arcade", "arcade-network", "admin", "settings", "backup", "notifications", "toktik"
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

/* Only refresh views that consume the changed data. Home owns the chat badge. */
const SETTING_VIEWS = {
  agentChats: ["home", "chat"], agentMessages: ["home", "chat"], chatFolders: ["chat"],
  gardenContacts: ["garden", "chat", "datapool", "wallet"],
  agentShards: ["datapool"], datapoolFolders: ["datapool"],
  personalContacts: ["contacts", "map"], contactFolders: ["contacts", "map"],
  mapMarkers: ["map", "contacts"], mapImagePath: ["map", "contacts", "admin"],
  ncpdRecords: ["ncpd"], ncpdFolders: ["ncpd"],
  idProfiles: ["home", "id", "bio", "chrome", "chat", "wallet", "datapool"],
  housingOptions: ["id", "wallet"], lifestyleOptions: ["id", "wallet"], traumaOptions: ["id", "bio", "wallet"],
  monthlyNotices: ["wallet"], agentNotifications: ["notifications", "home"],
  storeConfig: ["store", "admin"], libraryTree: ["library"], toolMacros: ["tools"],
  chromeLayout: ["chrome"], radioBroadcast: ["radio"]
};

const _rerenderDebounced = foundry.utils.debounce((target, view) => {
  // A delayed refresh must not interrupt a view the user has since opened.
  if (target?.rendered && target.currentApp === view) target.render(false);
}, 100);

function refreshViews(views) {
  const app = globalThis.AgentOS?.ui;
  if (!app || (!app.rendered && app._state !== Application.RENDER_STATES.RENDERING)) return;
  if (views && !views.includes(app.currentApp || "home") && !(app.currentApp === "chat" && views.includes(app.sideApp?.currentApp))) return;
  _rerenderDebounced(app, app.currentApp);
}

Hooks.on("updateSetting", (setting) => {
  if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;
  // GM radio takeover: reconcile local playback with the broadcast even when
  // the Radio app isn't open, so players follow the GM's station live.
  if (setting.key === `${MODULE_ID}.radioBroadcast`) syncBroadcast();
  const key = setting.key.slice(MODULE_ID.length + 1);
  if (key === "agentNotifications") refreshNotificationBadge();
  // Visibility/jamming changes affect the shell itself, regardless of the view.
  // Local sliders/checkboxes already update their own DOM without a re-render.
  refreshViews(key === "appConfig" ? null : (SETTING_VIEWS[key] || []));
});

/* Radio volume tracks Foundry's global music (playlist) volume — re-apply the
 * scaled stream volume live whenever the player drags that slider. */
Hooks.on("globalPlaylistVolumeChanged", () => applyVolume());

/* User flags already sync through Foundry; don't interrupt a running game. */
Hooks.on("updateUser", (user, changes) => {
  const flags = changes.flags?.[MODULE_ID];
  if (!flags) return;
  if (user.id === game.user.id && ("notificationRead" in flags || "notificationCleared" in flags)) refreshNotificationBadge();
  if (user.id === game.user.id && "radioIgnoreBroadcast" in flags) syncBroadcast();
  if (!("arcadeScores" in flags || "arcadeScoresHidden" in flags)) return;
  const app = globalThis.AgentOS?.ui;
  if (app?.rendered && app.currentApp === "arcade" && !app.state.game) refreshViews(["arcade"]);
});

function refreshNotificationBadge() {
  const badge = globalThis.AgentOS?.ui?.element?.find(".agentos-notification-count")[0];
  if (!badge) return;
  const count = notificationHistory().filter(n => !n.read).length;
  badge.textContent = String(count); badge.hidden = !count;
}

function actorIsDisplayed(actor, app) {
  if (!actor) return false;
  const selected = app.currentApp === "store" ? app.state.buyerUuid : app.state.actorUuid;
  if (!game.user.isGM) return game.user.character?.uuid === actor.uuid;
  if (selected) return selected === actor.uuid;
  if (app.currentApp === "store") return false;
  return game.users.some(u => !u.isGM && u.character?.uuid === actor.uuid);
}

/* Live wallet / biomonitor sync. */
Hooks.on("updateActor", (actor) => {
  const app = globalThis.AgentOS?.ui;
  if (!app?.rendered || !["wallet", "bio", "chrome", "store"].includes(app.currentApp)) return;
  if (actorIsDisplayed(actor, app)) refreshViews([app.currentApp]);
});

/* Compendium edits invalidate the catalog. Embedded item edits refresh only
 * the implant viewer for the actor currently on screen. */
const _itemRefresh = (item) => {
  if (item?.pack && (PACK_CATEGORIES[item.pack] || (game.settings.get(MODULE_ID, "storeConfig")?.extraPacks || []).includes(item.pack))) {
    invalidateCatalog();
    refreshViews(["store"]);
  }
  const app = globalThis.AgentOS?.ui;
  if (!app?.rendered || app.currentApp !== "chrome") return;
  if (item?.parent?.documentName === "Actor" && actorIsDisplayed(item.parent, app)) refreshViews(["chrome"]);
};
Hooks.on("createItem", _itemRefresh);
Hooks.on("updateItem", _itemRefresh);
Hooks.on("deleteItem", _itemRefresh);

/* Client-side notifications (fired locally on GM, via socket elsewhere). */
const shownNotifications = new Set();
Hooks.on(`${MODULE_ID}.notify`, async (data) => {
  const app = globalThis.AgentOS?.ui;
  const isGM = game.user.isGM;
  if (data.eventId) {
    if (shownNotifications.has(data.eventId)) return;
    shownNotifications.add(data.eventId);
    while (shownNotifications.size > 500) shownNotifications.delete(shownNotifications.values().next().value);
  }
  if (app?.isDisabled || muted(data)) return;

  const forMe = (ids) => Array.isArray(ids) && ids.includes(game.user.id);

  if (data.kind === "message") {
    // A recipient is a chat participant; the GM observes every chat.
    const isRecipient = forMe(data.participantUserIds) || isGM;
    if (!isRecipient) return;
    // The author's own client (player OR GM speaking as an NPC) gets no ping.
    if (data.authorUserId === game.user.id) { refreshViews(["home", "chat"]); return; }
    const viewingThread = app?.rendered && app.currentApp === "chat" && app.state.chatId === data.chatId;
    if (viewingThread) {
      const { markChatRead } = await import("./data.js");
      await markChatRead(data.chatId);
    } else {
      AgentAudio.play("message");
      showToast(`${data.senderName}`, data.preview, () => {
        const ui2 = globalThis.AgentOS?.ui;
        if (!ui2) return;
        ui2.openChatThread(data.chatId);
        ui2.render(true);
      });
    }
    refreshViews(["home", "chat"]);
  } else if (data.kind === "shard") {
    if (forMe(data.recipientUserIds)) {
      AgentAudio.play("message");
      showToast(game.i18n.localize("AGENTOS.Notify.NewShard"), data.title);
    }
    refreshViews(["datapool"]);
  } else if (data.kind === "transfer") {
    if (forMe(data.recipientUserIds)) {
      AgentAudio.play("cash");
      showToast(game.i18n.localize("AGENTOS.Notify.TransferIn"),
        `${data.fromName}: ${data.amount}€$`);
    }
    if (forMe(data.recipientUserIds) || isGM) refreshViews(["wallet", "store"]);
  } else if (data.kind === "purchase") {
    if (forMe(data.recipientUserIds)) AgentAudio.play("cash");
    if (forMe(data.recipientUserIds) || isGM) refreshViews(["wallet", "store"]);
  } else if (["monthly", "object", "invite"].includes(data.kind)) {
    if (forMe(data.recipientUserIds)) {
      AgentAudio.play("message");
      const body = data.kind === "monthly" ? game.i18n.format("AGENTOS.Expenses.PaymentReminder", { amount: data.amount ?? 0 }) : data.title || data.period || "";
      showToast(game.i18n.localize(`AGENTOS.Notifications.Category.${data.kind}`), body, () => {
        app?.openApp("notifications"); app?.render(true);
      });
    }
    refreshViews(["notifications", "wallet"]);
  } else if (data.kind === "contactShared") {
    if (forMe(data.recipientUserIds)) {
      AgentAudio.play("message");
      showToast(game.i18n.localize("AGENTOS.Notify.ContactShared"), data.name);
    }
    if (forMe(data.recipientUserIds) || isGM) refreshViews(["contacts", "map"]);
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
