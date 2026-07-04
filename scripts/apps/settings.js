/* Device settings: mode (phone / tablet / PC), theme, sounds. */

import { MODULE_ID, THEMES, loc } from "../constants.js";
import { AgentAudio } from "../audio.js";
import { applyVolume } from "./radio.js";

export async function getData(app) {
  return {
    modes: ["phone", "tablet", "pc"].map(m => ({
      id: m,
      label: loc(`AGENTOS.Mode.${m}`),
      active: app.deviceMode === m
    })),
    themes: THEMES.map(t => ({
      id: t.id,
      label: loc(t.labelKey),
      active: app.theme === t.id
    })),
    scales: [0.75, 0.85, 1, 1.15, 1.3, 1.5].map(s => ({
      value: s,
      label: `${Math.round(s * 100)}%`,
      active: Math.abs(app.zoom - s) < 0.01
    })),
    soundsEnabled: game.settings.get(MODULE_ID, "soundsEnabled") !== false,
    indicatorEnabled: game.settings.get(MODULE_ID, "messageIndicatorEnabled") !== false,
    radioVolume: Number(game.settings.get(MODULE_ID, "radioVolume") ?? 60)
  };
}

export function activateListeners(app, html) {
  html.on("click", "[data-action='set-mode']", async (ev) => {
    const mode = ev.currentTarget.dataset.mode;
    await game.user.setFlag(MODULE_ID, "agentMode", mode);
    AgentAudio.play("tap");
    app.render(true);
  });

  html.on("click", "[data-action='set-theme']", async (ev) => {
    const theme = ev.currentTarget.dataset.theme;
    await game.user.setFlag(MODULE_ID, "agentTheme", theme);
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='set-scale']", async (ev) => {
    const scale = Number(ev.currentTarget.dataset.scale);
    await game.user.setFlag(MODULE_ID, "agentZoom", scale);
    AgentAudio.play("tap");
    app.render(true);
  });

  html.on("change", "[name='set-sounds']", async (ev) => {
    await game.settings.set(MODULE_ID, "soundsEnabled", ev.currentTarget.checked);
  });

  html.on("change", "[name='set-indicator']", async (ev) => {
    await game.settings.set(MODULE_ID, "messageIndicatorEnabled", ev.currentTarget.checked);
  });

  html.on("input", "[name='set-radio-volume']", async (ev) => {
    const v = Math.max(0, Math.min(100, Number(ev.currentTarget.value) || 0));
    await game.settings.set(MODULE_ID, "radioVolume", v);
    applyVolume();
    const lbl = html.find(".agentos-radio-vol-val")[0];
    if (lbl) lbl.textContent = `${v}%`;
  });
}
