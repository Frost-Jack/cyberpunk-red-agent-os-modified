/* Biomonitor: live vitals from the CPR actor + Trauma Team membership card. */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

/** Trauma Team subscription of the player owning the given actor. */
function traumaOf(actor) {
  const owner = game.users.find(u => !u.isGM && u.character?.uuid === actor?.uuid);
  if (!owner) return null;
  const prof = Data.idProfile(owner.id);
  if (!prof.traumaId) return null;
  const opt = (Data.getWorld("traumaOptions") || []).find(t => t.id === prof.traumaId);
  if (!opt) return null;
  return {
    name: opt.name,
    tier: opt.tier === "platinum" ? "platinum" : "silver",
    isPlatinum: opt.tier === "platinum",
    holderName: prof.realName || actor.name
  };
}

function vitals(actor) {
  const hp = actor.system?.derivedStats?.hp || { value: 0, max: 1 };
  const hum = actor.system?.derivedStats?.humanity || { value: 0, max: 1 };
  const death = actor.system?.derivedStats?.deathSave || { value: 0, penalty: 0 };
  const hpPct = Math.max(0, Math.min(100, Math.round((hp.value / Math.max(1, hp.max)) * 100)));
  const humPct = Math.max(0, Math.min(100, Math.round((hum.value / Math.max(1, hum.max)) * 100)));

  const injuries = (actor.itemTypes?.criticalInjury || []).map(i => ({
    name: i.name,
    location: i.system?.location || ""
  }));

  const armorId = actor.system?.externalData?.currentArmorBody?.id;
  const armor = armorId ? actor.items.get(armorId) : null;
  const headId = actor.system?.externalData?.currentArmorHead?.id;
  const helmet = headId ? actor.items.get(headId) : null;

  const pulse = hpPct >= 100 ? 72 : Math.round(72 + (100 - hpPct) * 0.9);

  return {
    hpCurrent: hp.value, hpMax: hp.max, hpPct,
    hpState: hpPct > 50 ? "ok" : (hpPct > 25 ? "warn" : "crit"),
    woundState: hpPct >= 100 ? "stable" : (hp.value > 0 ? "wounded" : "critical"),
    humCurrent: hum.value, humMax: hum.max, humPct,
    humState: humPct > 50 ? "ok" : (humPct > 25 ? "warn" : "crit"),
    deathPenalty: death.basePenalty ?? death.penalty ?? 0,
    pulse,
    injuries,
    bodySp: armor ? (armor.system?.bodyLocation?.sp ?? 0) - (armor.system?.bodyLocation?.ablation ?? 0) : 0,
    headSp: helmet ? (helmet.system?.headLocation?.sp ?? 0) - (helmet.system?.headLocation?.ablation ?? 0) : 0,
    bodyArmorName: armor?.name || "",
    headArmorName: helmet?.name || ""
  };
}

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;

  let actor = null;
  if (isGM) {
    if (st.actorUuid) actor = await fromUuid(st.actorUuid);
  } else {
    actor = game.user.character;
  }

  if (isGM && !actor) {
    return {
      listMode: true,
      subjects: game.users.filter(u => !u.isGM && u.character).map(u => {
        const v = vitals(u.character);
        return {
          actorUuid: u.character.uuid,
          name: Data.playerIdentity(u.id).name,
          img: Data.playerIdentity(u.id).img,
          userName: u.name,
          hpPct: v.hpPct,
          hpState: v.hpState
        };
      })
    };
  }

  if (!actor) return { noActor: true };

  return {
    listMode: false,
    isGM,
    actorName: actor.name,
    actorImg: actor.img,
    actorUuid: actor.uuid,
    trauma: traumaOf(actor),
    ttBlank: `modules/${MODULE_ID}/assets/TTCardFiles/TraumaTeamCardBlank.png`,
    ...vitals(actor)
  };
}

export function activateListeners(app, html) {
  const st = app.state;

  html.on("click", "[data-action='bio-select']", (ev) => {
    st.actorUuid = ev.currentTarget.dataset.actorUuid;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='bio-back']", () => {
    app.state = {};
    app.render(false);
  });

  /* Trauma Team emergency call — a styled whisper to the GM(s). */
  html.on("click", "[data-action='tt-call']", async (ev) => {
    const actorUuid = ev.currentTarget.dataset.actorUuid;
    const actor = await fromUuid(actorUuid);
    if (!actor) return;
    const trauma = traumaOf(actor);
    if (!trauma) return;
    const v = actor.system?.derivedStats?.hp || { value: 0, max: 1 };
    const tierColor = trauma.isPlatinum ? "#e5c558" : "#c0c8d0";
    const tierName = trauma.isPlatinum
      ? loc("AGENTOS.Id.TierPlatinum")
      : loc("AGENTOS.Id.TierSilver");
    const esc = Handlebars.escapeExpression;
    const content = `
      <div style="border: 2px solid #b3151d; border-radius: 8px; background: #100507; padding: 10px 12px; font-family: monospace;">
        <div style="color: #ff2a2a; font-weight: 900; letter-spacing: 2px; font-size: 1.05em;">
          ✚ TRAUMA TEAM INTERNATIONAL
        </div>
        <div style="color: ${tierColor}; font-size: 0.8em; letter-spacing: 1px; margin-bottom: 6px;">
          ${esc(tierName.toUpperCase())} // ${esc(loc("AGENTOS.Bio.TTIncoming"))}
        </div>
        <div style="color: #f2eef0;">${esc(loc("AGENTOS.Bio.TTClient"))}: <b>${esc(trauma.holderName)}</b></div>
        <div style="color: #f2eef0;">${esc(loc("AGENTOS.Bio.TTPackage"))}: ${esc(trauma.name)}</div>
        <div style="color: #f2eef0;">HP: ${v.value} / ${v.max}</div>
        <div style="color: #9b8f96; font-size: 0.75em; margin-top: 6px;">${esc(loc("AGENTOS.Bio.TTEta"))}</div>
      </div>`;
    await ChatMessage.create({
      content,
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
    AgentAudio.play("message");
    ui.notifications.info(loc("AGENTOS.Bio.TTSent"));
  });
}
