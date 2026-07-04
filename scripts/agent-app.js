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
import * as StoreApp from "./apps/store.js";
import * as IdApp from "./apps/id.js";
import * as NcpdApp from "./apps/ncpd.js";
import * as GardenApp from "./apps/garden.js";
import * as LibraryApp from "./apps/library.js";
import * as ToolsApp from "./apps/tools.js";
import * as ArcadeApp from "./apps/arcade.js";
import * as AdminApp from "./apps/admin.js";
import * as SettingsApp from "./apps/settings.js";

const IMPL = {
  chat: ChatApp, datapool: DatapoolApp, wallet: WalletApp,
  contacts: ContactsApp, map: MapApp, bio: BioApp, chrome: ChromeApp, radio: RadioApp, store: StoreApp,
  id: IdApp, ncpd: NcpdApp, garden: GardenApp, library: LibraryApp,
  tools: ToolsApp, arcade: ArcadeApp, admin: AdminApp, settings: SettingsApp
};

export class AgentOSApplication extends Application {

  constructor(options = {}) {
    super(options);
    this.currentApp = null;      // null => home screen
    this.state = {};             // transient per-app state
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
    if (this.isDisabled && appId !== "settings") {
      AgentAudio.play("error");
      return;
    }
    const prev = this.currentApp;
    if (prev && IMPL[prev]?.onClose) IMPL[prev].onClose(this);
    this.currentApp = appId;
    this.state = {};
    AgentAudio.play("tap");
    this.render(false);
  }

  goHome() {
    if (this.currentApp && IMPL[this.currentApp]?.onClose) IMPL[this.currentApp].onClose(this);
    this.currentApp = null;
    this.state = {};
    AgentAudio.play("tap");
    this.render(false);
  }

  openChatThread(chatId) {
    if (this.currentApp && this.currentApp !== "chat" && IMPL[this.currentApp]?.onClose) {
      IMPL[this.currentApp].onClose(this);
    }
    this.currentApp = "chat";
    this.state = { chatId };
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

  async getData() {
    // Jammed device: kick the user out of any app except settings.
    if (this.isDisabled && this.currentApp && this.currentApp !== "settings") {
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

    const appDef = this.currentApp ? APPS.find(a => a.id === this.currentApp) : null;
    const viewTitle = this.currentApp
      ? (appDef ? loc(appDef.labelKey) : loc("AGENTOS.App.settings"))
      : "";

    return {
      moduleId: MODULE_ID,
      view,
      viewTitle,
      mode: this.deviceMode,
      theme: this.theme,
      zoom: this.zoom,
      disabled: this.isDisabled,
      isGM: game.user.isGM,
      identity,
      totalUnreads,
      apps: this.visibleApps().map(a => ({
        id: a.id,
        icon: a.icon,
        color: a.color || "#2ff5d0",
        label: loc(`AGENTOS.AppShort.${a.id}`),
        badge: a.id === "chat" && totalUnreads > 0 ? totalUnreads : 0
      })),
      viewData
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

    /* The device top bar is the drag handle (the Foundry header is hidden).
     * Draggable must receive the outer .app element, not the inner content. */
    const handle = html.find(".agentos-titlebar")[0];
    if (handle && this.element?.length) new Draggable(this, this.element, handle, false);

    if (this.currentApp && IMPL[this.currentApp]?.activateListeners) {
      IMPL[this.currentApp].activateListeners(this, html);
    }
  }

  async close(options) {
    if (this.currentApp && IMPL[this.currentApp]?.onClose) IMPL[this.currentApp].onClose(this);
    // Radio may keep playing after close (per its in-app toggle); let it decide.
    RadioApp.onDeviceClose?.();
    return super.close(options);
  }
}
