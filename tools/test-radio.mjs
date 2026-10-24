/* Deterministic playback tests: no network, no audio device, no live world. */
import test from "node:test";
import assert from "node:assert/strict";
import * as Radio from "../scripts/apps/radio.js";
import { MODULE_ID } from "../scripts/constants.js";

test("personal radio sync can be disabled, survives GM commands, and rejoins the current broadcast", async () => {
  const flags = { radioKeepPlaying: true };
  const hooks = new Map();
  const world = { radioBroadcast: { active: true, slug: "nightride", playing: true, ts: 1 } };
  let audio, writes = 0;
  globalThis.Hooks = { once() {}, on: (name, fn) => hooks.set(name, fn) };
  globalThis.Application = class {};
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
  globalThis.foundry = { utils: { deepClone: structuredClone, debounce: fn => fn } };
  globalThis.game = {
    user: {
      id: "player", isGM: false,
      getFlag: (module, key) => flags[key],
      setFlag: async (module, key, value) => {
        flags[key] = value;
        hooks.get("updateUser")(game.user, { flags: { [module]: { [key]: value } } });
      }
    },
    settings: {
      get: (module, key) => key === "globalPlaylistVolume" ? 0.5 : key === "radioVolume" ? 60 : world[key] ?? false,
      set: async () => { writes++; }
    },
    i18n: { localize: key => key }
  };
  globalThis.ui = { notifications: { info() {}, warn() {} } };
  globalThis.document = {
    body: { appendChild() {} },
    createElement: tag => {
      assert.equal(tag, "audio");
      audio = new class extends EventTarget {
        async play() { this.dispatchEvent(new Event("playing")); }
        pause() { this.dispatchEvent(new Event("pause")); }
        removeAttribute(key) { if (key === "src") this.src = ""; }
        load() {}
      }();
      return audio;
    }
  };
  globalThis.EventSource = class { addEventListener() {} };
  await import("../scripts/main.js");
  const handlers = new Map();
  const app = { currentApp: "radio", rendered: true, renders: 0, render() { this.renders++; } };
  const html = { on: (event, selector, fn) => handlers.set(selector, fn) };
  const click = (action, slug) => handlers.get(`[data-action='${action}']`)({ currentTarget: { dataset: { slug } } });
  const data = () => Radio.getData(app);
  const command = state => {
    world.radioBroadcast = { ...world.radioBroadcast, ...state, ts: world.radioBroadcast.ts + 1 };
    hooks.get("updateSetting")({ key: `${MODULE_ID}.radioBroadcast` });
  };
  Radio.activateListeners(app, html);
  Radio.syncBroadcast();
  assert.equal((await data()).stationName, "NIGHTRIDE FM");
  assert.equal((await data()).locked, true);
  assert.equal(audio.volume, 0.3, "Foundry music volume still multiplies personal volume");
  await click("radio-play", "datawave");
  assert.equal((await data()).stationName, "NIGHTRIDE FM", "Follow mode still blocks manual switching");
  const renders = app.renders;
  await click("radio-follow-toggle");
  assert.equal(flags.radioIgnoreBroadcast, true);
  assert.equal((await data()).followGM, false);
  assert.equal((await data()).locked, false);
  assert.equal((await data()).broadcastActive, true, "GM broadcast remains visibly active");
  assert.ok(app.renders > renders, "The real updateUser hook refreshes the open radio");
  await click("radio-play", "datawave");
  command({ slug: "chillsynth" });
  command({ playing: false });
  command({ active: false });
  assert.equal((await data()).stationName, "DATAWAVE", "GM changes, stop and release cannot interrupt local music");
  command({ active: true, playing: true, slug: "rektory" });
  Radio.onClose(); Radio.onDeviceClose();
  Radio.activateListeners(app, html);
  Radio.syncBroadcast();
  assert.equal((await data()).stationName, "DATAWAVE", "Personal choice survives closing and reopening the device");
  await click("radio-follow-toggle");
  assert.equal(flags.radioIgnoreBroadcast, false);
  assert.equal((await data()).stationName, "REKTORY", "Rejoining adopts the latest station, not the station when opting out");
  assert.equal((await data()).locked, true);
  await click("radio-stop");
  Radio.syncBroadcast();
  assert.equal((await data()).hasStation, false, "Existing per-command local stop still works");
  command({ slug: "chillsynth" });
  assert.equal((await data()).stationName, "CHILLSYNTH", "A newer command resumes followers");
  await click("radio-follow-toggle");
  await click("radio-play", "horrorsynth");
  command({ playing: false });
  assert.equal((await data()).stationName, "HORRORSYNTH");
  await click("radio-follow-toggle");
  assert.equal((await data()).hasStation, false, "Rejoining also adopts a currently stopped GM broadcast");
  command({ active: false });
  await click("radio-play", "ebsm");
  await click("radio-follow-toggle");
  await click("radio-follow-toggle");
  assert.equal((await data()).stationName, "EBSM", "Sync changes with no active broadcast leave local playback alone");
  const otherUser = { id: "other" };
  hooks.get("updateUser")(otherUser, { flags: { [MODULE_ID]: { radioIgnoreBroadcast: true } } });
  assert.equal((await data()).stationName, "EBSM");
  assert.equal(writes, 0, "Personal sync never writes world settings or changes the GM broadcast");
  game.user.isGM = true;
  command({ active: true, playing: true, slug: "rekt" });
  assert.equal((await data()).stationName, "EBSM", "Broadcast reconciliation must not override the GM's local player");
  assert.equal((await data()).takeover, true);
  const preference = flags.radioIgnoreBroadcast;
  await click("radio-follow-toggle");
  assert.equal(flags.radioIgnoreBroadcast, preference, "Personal follow toggle is player-only");
  Radio.onClose();
});
