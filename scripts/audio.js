/* Synthesized UI sounds (WebAudio, no asset files). */

import { MODULE_ID } from "./constants.js";

export const AgentAudio = {
  _ctx: null,

  _enabled() {
    try { return game.settings.get(MODULE_ID, "soundsEnabled") !== false; }
    catch (e) { return true; }
  },

  _ac() {
    if (this._ctx) return this._ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._ctx = AC ? new AC() : null;
    } catch (e) { this._ctx = null; }
    return this._ctx;
  },

  /** type: 'tap' | 'message' | 'error' | 'cash' | 'boot' */
  play(type = "tap") {
    if (!this._enabled()) return;
    const ctx = this._ac();
    if (!ctx) return;
    try { if (ctx.state === "suspended") ctx.resume(); } catch (e) { /* noop */ }
    const now = ctx.currentTime;
    const make = (freq, start, dur, peak, wave = "sine") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + start); osc.stop(now + start + dur + 0.02);
    };
    switch (type) {
      case "message":
        make(660, 0, 0.18, 0.06, "sine");
        make(880, 0.10, 0.22, 0.05, "sine");
        break;
      case "error":
        make(220, 0, 0.22, 0.05, "square");
        break;
      case "cash":
        make(1046, 0, 0.10, 0.05, "triangle");
        make(1318, 0.08, 0.16, 0.05, "triangle");
        break;
      case "boot":
        make(392, 0, 0.14, 0.04, "sine");
        make(523, 0.10, 0.14, 0.04, "sine");
        make(784, 0.20, 0.24, 0.05, "sine");
        break;
      default:
        make(520, 0, 0.07, 0.035, "sine");
    }
  }
};
