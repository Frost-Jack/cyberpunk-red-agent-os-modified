/* The Agent device shell application (Application v1).
 * Routes between app views; each app lives in scripts/apps/<id>.js and
 * exports getData(app) / activateListeners(app, html) / onClose?(app).
 *
 * The Foundry window header is hidden by CSS — the device draws its own
 * top bar with macOS-style lights (close) and a settings gear, and the
 * whole bar acts as the drag handle. The chassis footprint is FIXED per
 * device mode; there is no runtime zoom/resize. */

import { MODULE_ID, TPL, APPS, THEMES, DEVICE_MODES, loc } from "./constants.js";
import { AgentAudio } from "./audio.js";
import * as Data from "./data.js";

import * as ChatApp from "./apps/chat.js";
import * as DatapoolApp from "./apps/datapool.js";
import * as WalletApp from "./apps/wallet.js";
import * as ContactsApp from "./apps/contacts.js";
import * as MapApp from "./apps/map.js";
import * as BioApp from "./apps/bio.js";
import * as ChromeApp from "./apps/chrome.js";
import * as RadioApp from "./apps/radio.js";
import * as TokTikApp from "./apps/toktik.js";
import * as StoreApp from "./apps/store.js";
import * as IdApp from "./apps/id.js";
import * as NcpdApp from "./apps/ncpd.js";
import * as GardenApp from "./apps/garden.js";
import * as LibraryApp from "./apps/library.js";
import * as ToolsApp from "./apps/tools.js";
import * as ArcadeApp from "./apps/arcade.js";
import * as AdminApp from "./apps/admin.js";
import * as SettingsApp from "./apps/settings.js";
import * as BackupApp from "./apps/backup.js";
import * as NotificationsApp from "./apps/notifications.js";

const IMPL = {
  chat: ChatApp, datapool: DatapoolApp, wallet: WalletApp,
  contacts: ContactsApp, map: MapApp, bio: BioApp, chrome: ChromeApp, radio: RadioApp, toktik: TokTikApp, store: StoreApp,
  id: IdApp, ncpd: NcpdApp, garden: GardenApp, library: LibraryApp,
  tools: ToolsApp, arcade: ArcadeApp, admin: AdminApp, settings: SettingsApp, backup: BackupApp, notifications: NotificationsApp
};

export class AgentOSApplication extends Application {

  constructor(options = {}) {
    super(options);
    this.currentApp = null;      // null => home screen
    this.state = {};             // transient per-app state
    this._appStates = new Map();
    this._viewMemory = new Map();
    this.sideApp = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "agentos-device",
      template: TPL("shell"),
      classes: ["agentos-window"],
      popOut: true,
      resizable: false,
      minimizable: false,
      title: "AGENT",
      width: 450,
      height: 762
    });
  }

  /** Fixed window footprint for the current device mode and scale:
   *  chassis×zoom + 8px border + 52px content gutter. Applied only when
   *  mode or scale actually changes, so view switches and background
   *  re-renders can never resize or collapse the window. */
  _ensureWindowSize() {
    const key = `${this.deviceMode}:${this.zoom}`;
    if (this._sizedKey === key) return;
    this._sizedKey = key;
    const dims = DEVICE_MODES[this.deviceMode];
    const w = Math.round(dims.w * this.zoom) + 60;
    const h = Math.round(dims.h * this.zoom) + 62;
    const el = this.element?.[0];
    if (el) {
      el.style.minWidth = `${w}px`;
      el.style.minHeight = `${h}px`;
    }
    this.setPosition({ width: w, height: h });
  }

  /* ---------------- device prefs ---------------- */

  setPosition(position = {}) {
    const dims = DEVICE_MODES[this.deviceMode];
    return super.setPosition({ ...position,
      width: Math.round(dims.w * this.zoom) + 60,
      height: Math.round(dims.h * this.zoom) + 62
    });
  }

  get deviceMode() {
    const m = game.user.getFlag(MODULE_ID, "agentMode");
    return ["phone", "tablet", "pc"].includes(m) ? m : "phone";
  }

  get theme() {
    const t = game.user.getFlag(MODULE_ID, "agentTheme");
    return THEMES.some(x => x.id === t) ? t : "red";
  }

  /** Size modifier chosen in the device settings (not a drag-resize). */
  get zoom() {
    const z = Number(game.user.getFlag(MODULE_ID, "agentZoom"));
    return (z >= 0.6 && z <= 1.6) ? z : 1;
  }

  /* ---------------- helpers ---------------- */

  /** GM kill switch: the player's Agent is jammed (static, NET OFF). */
  get isDisabled() {
    if (game.user.isGM) return false;
    const cfg = Data.getWorld("appConfig") || {};
    return !!(cfg.disabled || {})[game.user.id];
  }

  visibleApps() {
    const cfg = Data.getWorld("appConfig") || {};
    const isGM = game.user.isGM;
    const roleCfg = (isGM ? cfg.gm : cfg.player) || {};
    const perPlayer = isGM ? {} : ((cfg.perPlayer || {})[game.user.id] || {});
    return APPS.filter(a => {
      if (a.gmOnly) return isGM;
      // A per-player override (if set) beats the global role setting.
      if (!isGM && perPlayer[a.id] !== undefined) return perPlayer[a.id] !== false;
      return roleCfg[a.id] !== false;
    });
  }

  openApp(appId) {
    if ((appId === "admin" || appId === "backup") && !game.user.isGM) return;
    if (this.isDisabled && appId !== "settings") {
      AgentAudio.play("error");
      return;
    }
    const prev = this.currentApp;
    this._captureView();
    if (prev) this._appStates.set(prev, this.state);
    if (prev && IMPL[prev]?.onClose) IMPL[prev].onClose(this);
    this.currentApp = appId;
    this.state = this._appStates.get(appId) || {};
    AgentAudio.play("tap");
    this.render(false);
  }

  goHome() {
    this._captureView();
    if (this.currentApp) this._appStates.set(this.currentApp, this.state);
    if (this.currentApp && IMPL[this.currentApp]?.onClose) IMPL[this.currentApp].onClose(this);
    this.currentApp = null;
    this.state = {};
    AgentAudio.play("tap");
    this.render(false);
  }

  openChatThread(chatId) {
    this._captureView();
    if (this.currentApp) this._appStates.set(this.currentApp, this.state);
    if (this.currentApp && this.currentApp !== "chat" && IMPL[this.currentApp]?.onClose) {
      IMPL[this.currentApp].onClose(this);
    }
    this.currentApp = "chat";
    const saved = this._appStates.get("chat");
    this.state = saved?.chatId === chatId ? saved : { chatId };
  }

  openSideApp(id = "datapool", state) {
    if (this.isDisabled || !["datapool", "contacts", "map", "store"].includes(id) || !this.visibleApps().some(a => a.id === id)) return;
    if (this.sideApp) { this.sideApp._captureView(); IMPL[this.sideApp.currentApp]?.onClose?.(this.sideApp); }
    else this.state._composeBeforeSide = this.state.composeFocus;
    const side = Object.create(this);
    Object.defineProperty(side, "element", { get: () => this.element?.find(".agentos-side-pane") });
    side.currentApp = id; side.state = state || this._appStates.get(`side:${id}`) || {};
    side._displayContextKey = `side:${id}`;
    this._appStates.set(`side:${id}`, side.state);
    side.render = () => { if (this.currentApp === "chat" && this.sideApp === side) this.render(false); };
    side.openApp = (next) => this.openSideApp(next);
    side.openSideApp = (next, data) => this.openSideApp(next, data);
    side.shareToChat = attachment => this.shareToChat(attachment);
    this.sideApp = side;
    this.render(false);
  }

  async shareToChat(attachment) {
    if (this.isDisabled) return;
    let chatId = this.currentApp === "chat" ? this.state.chatId : null;
    if (!chatId) {
      const chats = game.user.isGM ? Data.allChats() : Data.chatsForUser(game.user.id);
      if (!chats.length) return ui.notifications.warn(loc("AGENTOS.Chat.Empty"));
      chatId = await new Promise(resolve => new Dialog({ title: loc("AGENTOS.Navigation.Share"),
        content: `<select name="card-chat">${chats.map(c => `<option value="${Handlebars.escapeExpression(c.id)}">${Handlebars.escapeExpression(c.name || c.participants.map(p => Data.participantIdentity(c, p.key).name).join(", "))}</option>`).join("")}</select>`,
        buttons: { send: { label: loc("AGENTOS.Common.Ok"), callback: h => resolve(h.find("select").val()) } }, close: () => resolve(null)
      }).render(true));
    }
    if (!chatId) return;
    this.openChatThread(chatId);
    this.state.attachment = attachment;
    this.state.draftChat = chatId;
    this.state.composeFocus = true;
    if (this.deviceMode === "phone") this.sideApp = null;
    this.render(false);
  }

  _captureView() {
    if (!this._displayContextKey || !this.element?.length) return;
    const body = this.element.find(".agentos-app-body").first()[0];
    if (!body) return;
    const fields = [...body.querySelectorAll("input[name],textarea[name],select[name]")].filter(e => e.type !== "file" && e.name !== "chat-input").map(e => ({ name: e.name, value: e.value, checked: e.checked, type: e.type }));
    const active = document.activeElement;
    this._viewMemory.set(this._displayContextKey, { fields, scroll: body.scrollTop, focus: body.contains(active) ? active.name : null, selection: active?.selectionStart == null ? null : [active.selectionStart, active.selectionEnd] });
  }

  async mutate(op, payload) {
    const ok = await Data.mutate(op, payload);
    if (ok === false) AgentAudio.play("error");
    return ok;
  }

  /** Dialog with a single text input. Returns string or null. */
  async promptText(title, initial = "", placeholder = "") {
    return new Promise((resolve) => {
      const dlg = new Dialog({
        title,
        content: `<input type="text" name="agentos-prompt" style="width:100%" value="${Handlebars.escapeExpression(initial)}" placeholder="${Handlebars.escapeExpression(placeholder)}"/>`,
        buttons: {
          ok: {
            label: loc("AGENTOS.Common.Ok"),
            callback: (html) => resolve(String(html.find('[name="agentos-prompt"]').val() ?? ""))
          },
          cancel: { label: loc("AGENTOS.Common.Cancel"), callback: () => resolve(null) }
        },
        default: "ok",
        close: () => resolve(null)
      });
      dlg.render(true);
    });
  }

  async confirm(title, content = "") {
    return Dialog.confirm({ title, content: content ? `<p>${Handlebars.escapeExpression(content)}</p>` : "" });
  }

  /** FilePicker helper. type: 'image' | 'audio' | 'video' | 'imagevideo' | 'any' */
  async pickFile(type = "image") {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const fp = new FilePicker({ type, callback: (path) => done(path) });
      // FilePicker never invokes an options.close callback — hook close() so
      // cancelling the dialog still settles the promise (callback wins the race).
      const origClose = fp.close.bind(fp);
      fp.close = async (options) => {
        const r = await origClose(options);
        setTimeout(() => done(null), 50);
        return r;
      };
      fp.render(true);
    });
  }

  /** Upload an OS file (from drag & drop) into the module uploads folder.
   *  Returns the server path or null. */
  async uploadFile(file) {
    const dir = `${MODULE_ID}-uploads`;
    try {
      try { await FilePicker.createDirectory("data", dir); } catch (e) { /* exists */ }
      const result = await FilePicker.upload("data", dir, file, {});
      return result?.path || null;
    } catch (e) {
      console.warn(`${MODULE_ID} | upload failed`, e);
      ui.notifications.warn(loc("AGENTOS.Notify.UploadFailed"));
      return null;
    }
  }

  /* ---------------- rendering ---------------- */

  async _render(force = false, options = {}) {
    const states = Application.RENDER_STATES;
    if (this._state === states.RENDERING) {
      const queued = this._agentRenderQueue || { force: false, options: {} };
      this._agentRenderQueue = { force: queued.force || force, options: { ...queued.options, ...options } };
      return;
    }
    try { await super._render(force, options); }
    finally {
      const queued = this._agentRenderQueue;
      this._agentRenderQueue = null;
      if (queued && this._state === states.RENDERED) this.render(queued.force, queued.options);
    }
  }

  async getData() {
    this._captureView();
    this.sideApp?._captureView();
    // Jammed device: kick the user out of any app except settings.
    if (this.isDisabled && this.currentApp && this.currentApp !== "settings") {
      IMPL[this.currentApp]?.onClose?.(this);
      this.currentApp = null;
      this.state = {};
    }
    const view = this.currentApp || "home";
    const impl = this.currentApp ? IMPL[this.currentApp] : null;
    const unreads = Data.unreadCounts();
    const totalUnreads = Object.values(unreads).reduce((a, b) => a + b, 0);
    const identity = game.user.isGM
      ? { name: "SYS ADMIN", img: game.user.avatar }
      : Data.playerIdentity(game.user.id);

    let viewData = {};
    if (impl?.getData) viewData = (await impl.getData(this)) || {};
    this._displayContextKey = `${view}:${this.state.actorUuid || this.state.targetUserId || this.state.shardId || this.state.chatId || ""}`;
    const side = view === "chat" && this.sideApp && !this.isDisabled && this.visibleApps().some(a => a.id === this.sideApp.currentApp) ? this.sideApp : null;
    const sideData = side ? await IMPL[side.currentApp].getData(side) : null;
    if (side) side._displayContextKey = `side:${side.currentApp}:${side.state.actorUuid || side.state.shardId || ""}`;

    const appDef = this.currentApp ? APPS.find(a => a.id === this.currentApp) : null;
    const viewTitle = this.currentApp
      ? (appDef ? loc(appDef.labelKey) : loc("AGENTOS.App.settings"))
      : "";

    return {
      moduleId: MODULE_ID,
      view,
      viewTitle: this.currentApp === "backup" ? loc("AGENTOS.Backup.Title") : this.currentApp === "notifications" ? loc("AGENTOS.Notifications.Title") : viewTitle,
      mode: this.deviceMode,
      theme: this.theme,
      zoom: this.zoom,
      disabled: this.isDisabled,
      isGM: game.user.isGM,
      identity,
      totalUnreads,
      notificationCount: NotificationsApp.history().filter(n => !n.read).length,
      apps: this.visibleApps().map(a => ({
        id: a.id,
        icon: a.icon,
        color: a.color || "#2ff5d0",
        label: loc(`AGENTOS.AppShort.${a.id}`),
        badge: a.id === "chat" && totalUnreads > 0 ? totalUnreads : 0
      })),
      viewData,
      sideView: side?.currentApp, sideData,
      sideApps: this.visibleApps().filter(a => ["datapool", "contacts", "map", "store"].includes(a.id)).map(a => ({ id: a.id, label: loc(a.labelKey), selected: a.id === side?.currentApp }))
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._ensureWindowSize();

    html.on("click", "[data-action='open-app']", (ev) => {
      ev.preventDefault();
      this.openApp(ev.currentTarget.dataset.appId);
    });
    html.on("click", "[data-action='go-home']", (ev) => {
      ev.preventDefault();
      this.goHome();
    });
    html.on("click", "[data-action='device-close']", (ev) => {
      ev.preventDefault();
      AgentAudio.play("tap");
      this.close();
    });
    html.on("click", "[data-action='open-settings']", (ev) => {
      ev.preventDefault();
      this.openApp("settings");
    });
    html.on("click", "[data-action='open-notifications']", () => this.openApp("notifications"));
    html.on("click", "[data-action='chat-side-toggle']", () => {
      if (this.sideApp) { this.sideApp._captureView(); IMPL[this.sideApp.currentApp]?.onClose?.(this.sideApp); this.sideApp = null; this.state.composeFocus = this.state._composeBeforeSide; this.render(false); }
      else this.openSideApp();
    });
    html.on("change", "[name='side-app']", ev => this.openSideApp(ev.currentTarget.value));
    const cardData = el => ({ kind: el.dataset.objectKind, id: el.dataset.objectId, uuid: el.dataset.uuid, x: Number(el.dataset.x), y: Number(el.dataset.y) });
    html.find("[data-action='share-object']").on("click", ev => { ev.stopPropagation(); this.shareToChat(cardData(ev.currentTarget)); });
    html[0]?.addEventListener("dragstart", ev => {
      const el = ev.target.closest("[data-card-drag]");
      if (!el) return;
      ev.stopPropagation(); ev.dataTransfer.setData("text/plain", JSON.stringify(cardData(el))); ev.dataTransfer.effectAllowed = "copy";
    }, true);

    /* The device top bar is the drag handle (the Foundry header is hidden).
     * Draggable must receive the outer .app element, not the inner content. */
    const handle = html.find(".agentos-titlebar")[0];
    if (handle && this.element?.length) new Draggable(this, this.element, handle, false);

    if (this.currentApp && IMPL[this.currentApp]?.activateListeners) {
      IMPL[this.currentApp].activateListeners(this, html.find(".agentos-app-frame").first());
    }
    if (this.currentApp === "chat" && this.sideApp) IMPL[this.sideApp.currentApp].activateListeners(this.sideApp, html.find(".agentos-side-pane"));
    this._restoreView(html);
    if (this.currentApp === "chat" && this.sideApp) this.sideApp._restoreView(html.find(".agentos-side-pane"));
  }

  _restoreView(html) {
    const memory = this._viewMemory.get(this._displayContextKey);
    const body = html.find(".agentos-app-body").first()[0];
    if (memory && body) {
      body.scrollTop = memory.scroll;
      for (const e of body.querySelectorAll("input[name],textarea[name],select[name]")) {
        const field = memory.fields.find(f => f.name === e.name && (e.type !== "checkbox" || f.value === e.value));
        if (field && !e.disabled && !e.hasAttribute("data-agentos-controlled")) { if (["checkbox", "radio"].includes(e.type)) e.checked = field.checked; else e.value = field.value; }
        if (e.name === memory.focus) { e.focus({ preventScroll: true }); if (memory.selection && e.setSelectionRange && ["text", "search", "textarea"].includes(e.type)) e.setSelectionRange(...memory.selection); }
      }
    }
  }

  async close(options) {
    if (this.sideApp) IMPL[this.sideApp.currentApp]?.onClose?.(this.sideApp);
    if (this.currentApp && IMPL[this.currentApp]?.onClose) IMPL[this.currentApp].onClose(this);
    // Radio may keep playing after close (per its in-app toggle); let it decide.
    RadioApp.onDeviceClose?.();
    return super.close(options);
  }
}
