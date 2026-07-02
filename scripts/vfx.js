/* Holophone "incoming call" VFX — faithful port of the previous build:
 * phone icon + red ring + "CALL" label + eye glints attach to the token,
 * then a symbol-scroll loop types glitch glyphs in a grid next to it.
 * Every effect is .locally(true): each client runs its own copy via the
 * socket, so Sequencer never re-broadcasts (no N×N spam). */

import { MODULE_ID, SOCKET_NAME } from "./constants.js";

const SYMBOLS = [
  "⍰", "⍱", "⍲", "⍽", "⍾", "⍿", "░", "▒", "▓", "≡", "║",
  "⎀", "⎃", "⎅", "⎆", "⎉", "⌷", "⌸", "⌹", "⌻", "⌼", "⌽",
  "☰", "☱", "☲", "☳", "☴", "☵", "☶", "☷",
  "⣹", "⣺", "⣻", "⣼", "⣽", "⣾", "⣿"
];

function callingSet() {
  globalThis.__AgentDeviceCalling = globalThis.__AgentDeviceCalling || new Set();
  return globalThis.__AgentDeviceCalling;
}

function vfxEnabled() {
  try { return game.settings.get(MODULE_ID, "enableCallAnimation") !== false; }
  catch (e) { return false; }
}

function sequencerReady() {
  return typeof globalThis.Sequence === "function" && game.modules.get("sequencer")?.active;
}

function firstAvailable(...candidates) {
  const has = (p) => {
    try { return !!globalThis.Sequencer?.Database?.entryExists?.(p); }
    catch (e) { return true; }
  };
  return candidates.find(has) || null;
}

/** Ring the tokens of the given actor uuids on the current scene (all clients). */
export function triggerCall(actorUuids) {
  if (!vfxEnabled()) return;
  const tokens = (canvas?.tokens?.placeables || []).filter(t => actorUuids.includes(t.actor?.uuid));
  for (const tok of tokens) {
    game.socket.emit(SOCKET_NAME, { action: "holophoneStart", tokenId: tok.id, sceneId: canvas.scene?.id });
    runCallEffectLocal(tok.id, canvas.scene?.id);
    setTimeout(() => {
      game.socket.emit(SOCKET_NAME, { action: "holophoneStop", tokenId: tok.id });
      stopCallEffectLocal(tok.id);
    }, 15000);
  }
}

export async function runCallEffectLocal(tokenId, sceneId) {
  if (!vfxEnabled() || !sequencerReady()) return;
  if (sceneId && canvas.scene?.id !== sceneId) return;
  const tok = canvas.tokens?.get(tokenId);
  if (!tok) return;
  const calling = callingSet();
  if (calling.has(tok.id)) return;
  calling.add(tok.id);

  const style = {
    fill: "white", fontFamily: "Impact", fontSize: 10,
    dropShadow: true, dropShadowAlpha: 0.5, dropShadowBlur: 5, dropShadowDistance: 3
  };
  const textstyle = {
    fill: "#00FCD0", fontFamily: "Impact", fontSize: 6,
    dropShadow: true, dropShadowAlpha: 0.5, dropShadowBlur: 5, dropShadowDistance: 3
  };

  try {
    const ringFile = firstAvailable(
      "jb2a.token_stage.round.red.01.05",
      "jb2a.token_border_circle.static.red.011",
      "jb2a.markers.circle_of_stars.red",
      "jb2a.energy_field.02.below.red"
    );
    const glintFile = firstAvailable(
      "jb2a.twinkling_stars.points04.orange",
      "jb2a.twinkling_stars.points02.orange",
      "jb2a.twinkling_stars.points06.orange"
    );

    const seq = new globalThis.Sequence();

    // Layer 1 — phone icon
    seq.effect()
      .file("https://i.imgur.com/Vif3lSd.png")
      .name("AgentCall")
      .atLocation(tok)
      .locally(true)
      .scaleIn({ x: 0.75, y: 0 }, 50)
      .scaleOut({ x: 0.75, y: 0 }, 50)
      .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: -0.18, y: 0.18 }, gridUnits: true, bindRotation: false })
      .size(0.47, { gridUnits: true })
      .aboveLighting()
      .persist()
      .zIndex(0);

    // Layer 2 — red ring (JB2A with graceful fallback)
    if (ringFile) {
      seq.effect()
        .file(ringFile)
        .name("AgentCall")
        .atLocation(tok)
        .locally(true)
        .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: -0.2, y: 0.2 }, gridUnits: true, bindRotation: false })
        .size(0.5, { gridUnits: true })
        .aboveLighting()
        .persist()
        .zIndex(1);
    }

    // Layer 3 — "CALL" label
    seq.effect()
      .text("CALL", style)
      .name("AgentCall")
      .atLocation(tok)
      .locally(true)
      .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: 0.057, y: -0.025 }, gridUnits: true, bindRotation: false })
      .size(0.015, { gridUnits: true })
      .aboveLighting()
      .persist()
      .zIndex(2);

    // Layers 4 & 5 — eye glints
    if (glintFile) {
      for (const off of [{ x: -0.2, y: -0.16 }, { x: 0.12, y: -0.225 }]) {
        seq.effect()
          .file(glintFile)
          .name("AgentCall")
          .atLocation(tok, { offset: off, gridUnits: true, local: true })
          .locally(true)
          .size({ width: 0.4, height: 0.1 }, { gridUnits: true })
          .aboveLighting()
          .persist()
          .zIndex(0)
          .filter("ColorMatrix", { hue: 25 })
          .filter("Blur", { blurX: 30, blurY: 0 })
          .playbackRate(5)
          .attachTo(tok);
      }
    }

    await seq.play();
    await globalThis.Sequencer.Helpers.wait(750);

    // Symbol-scroll loop: glyphs "type" in a 12-per-row grid until stopped.
    const LOOP_INTERVAL_MS = 200;
    const MAX_ITER = (30 * 60 * 1000) / LOOP_INTERVAL_MS;
    let i = 1, e = 1, safety = 0;
    while (calling.has(tok.id) && canvas.tokens?.get(tok.id) && safety++ < MAX_ITER) {
      if (i === 12 || i === 24) e = 1;
      if (i > 36) {
        i = 1; e = 1;
        await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
      }
      const word = globalThis.Sequencer.Helpers.random_array_element(SYMBOLS, false);
      await new globalThis.Sequence()
        .wait(LOOP_INTERVAL_MS)
        .effect()
          .text(`${word}`, textstyle)
          .name("AgentCallText")
          .atLocation(tok)
          .locally(true)
          .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: 0.3 + (e * 0.075), y: -0.21 + (Math.floor(i / 12) * 0.13) }, gridUnits: true, bindRotation: false })
          .size(0.015, { gridUnits: true })
          .aboveLighting()
          .duration(10000)
          .zIndex(2)
        .play();
      i++;
      e++;
    }

    // Loop exited (stop signal / token gone / safety cap) — sweep both layers.
    calling.delete(tok.id);
    try { await globalThis.Sequencer.Helpers.wait(260); } catch (err) { /* noop */ }
    try {
      await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCall", object: tok });
      await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
    } catch (err) { /* noop */ }
  } catch (err) {
    console.warn(`${MODULE_ID} | holophone animation failed`, err);
    calling.delete(tok.id);
    try {
      await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCall", object: tok });
      await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
    } catch (err2) { /* noop */ }
  }
}

export async function stopCallEffectLocal(tokenId) {
  // Removing the id makes the symbol loop exit; it performs its own sweep.
  callingSet().delete(tokenId);
  if (!sequencerReady()) return;
  const tok = canvas.tokens?.get(tokenId);
  if (!tok) return;
  try {
    await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCall", object: tok });
    await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
  } catch (e) { /* noop */ }
}
