/* User ID: identity card, proxy ID, Housing & Lifestyle. */

import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const players = game.users.filter(u => !u.isGM);

  let targetUserId = isGM ? (st.targetUserId || players[0]?.id || null) : game.user.id;
  const user = targetUserId ? game.users.get(targetUserId) : null;
  const actor = user?.character || null;
  const prof = targetUserId ? Data.idProfile(targetUserId) : {};

  const housing = Data.getWorld("housingOptions") || [];
  const lifestyle = Data.getWorld("lifestyleOptions") || [];
  const trauma = Data.getWorld("traumaOptions") || [];

  return {
    isGM,
    noTarget: !user,
    targetUserId,
    players: isGM ? players.map(p => ({
      id: p.id, name: p.name, active: p.id === targetUserId
    })) : [],
    realName: prof.realName || actor?.name || user?.name || "—",
    realImg: actor?.img || "icons/svg/mystery-man.svg",
    proxyName: prof.proxyName || "",
    proxyImg: prof.proxyImg || "",
    hasProxy: !!prof.proxyName,
    publicName: Data.playerIdentity(targetUserId || "").name,
    publicImg: Data.playerIdentity(targetUserId || "").img,
    subtitle: prof.subtitle || "Citizen Priority A+",
    sinStatus: prof.sinStatus || "Registered",
    clearance: prof.clearance || "NC Citizen",
    housing,
    lifestyle,
    trauma,
    housingId: prof.housingId || "",
    lifestyleId: prof.lifestyleId || "",
    traumaId: prof.traumaId || "",
    housingName: housing.find(h => h.id === prof.housingId)?.name || "—",
    lifestyleName: lifestyle.find(l => l.id === prof.lifestyleId)?.name || "—",
    traumaName: trauma.find(t => t.id === prof.traumaId)?.name || "—",
    editingOptions: isGM && !!st.editingOptions
  };
}

export function activateListeners(app, html) {
  const st = app.state;
  const isGM = game.user.isGM;

  html.on("click", "[data-action='id-select-user']", (ev) => {
    st.targetUserId = ev.currentTarget.dataset.userId;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='id-proxy-img']", async (ev) => {
    const targetUserId = ev.currentTarget.dataset.userId;
    const path = await app.pickFile("image");
    if (!path) return;
    await app.mutate("id.update", { targetUserId, patch: { proxyImg: path } });
  });

  html.on("click", "[data-action='id-proxy-clear']", async (ev) => {
    const targetUserId = ev.currentTarget.dataset.userId;
    await app.mutate("id.update", { targetUserId, patch: { proxyName: "", proxyImg: "" } });
  });

  html.on("click", "[data-action='id-save']", async (ev) => {
    const targetUserId = ev.currentTarget.dataset.userId;
    const patch = {
      proxyName: String(html.find("[name='id-proxy-name']").val() || "").trim(),
      realName: String(html.find("[name='id-real-name']").val() || "").trim(),
      housingId: String(html.find("[name='id-housing']").val() || ""),
      lifestyleId: String(html.find("[name='id-lifestyle']").val() || ""),
      traumaId: String(html.find("[name='id-trauma']").val() || "")
    };
    if (isGM) {
      patch.subtitle = String(html.find("[name='id-subtitle']").val() || "");
      patch.sinStatus = String(html.find("[name='id-sin']").val() || "");
      patch.clearance = String(html.find("[name='id-clearance']").val() || "");
    }
    await app.mutate("id.update", { targetUserId, patch });
    AgentAudio.play("tap");
  });

  /* ---- Housing / Lifestyle management (GM) ---- */

  html.on("click", "[data-action='id-options-toggle']", () => {
    st.editingOptions = !st.editingOptions;
    app.render(false);
  });

  html.on("click", "[data-action='housing-add']", async () => {
    const name = String(html.find("[name='housing-name']").val() || "").trim();
    const rent = Number(html.find("[name='housing-rent']").val() || 0);
    const buy = Number(html.find("[name='housing-buy']").val() || 0);
    if (!name) return AgentAudio.play("error");
    await app.mutate("housing.save", { option: { name, rent, buy } });
  });

  html.on("click", "[data-action='housing-delete']", async (ev) => {
    await app.mutate("housing.delete", { optionId: ev.currentTarget.dataset.optionId });
  });

  html.on("click", "[data-action='lifestyle-add']", async () => {
    const name = String(html.find("[name='lifestyle-name']").val() || "").trim();
    const cost = Number(html.find("[name='lifestyle-cost']").val() || 0);
    if (!name) return AgentAudio.play("error");
    await app.mutate("lifestyle.save", { option: { name, cost } });
  });

  html.on("click", "[data-action='lifestyle-delete']", async (ev) => {
    await app.mutate("lifestyle.delete", { optionId: ev.currentTarget.dataset.optionId });
  });

  html.on("click", "[data-action='trauma-add']", async () => {
    const name = String(html.find("[name='trauma-name']").val() || "").trim();
    const cost = Number(html.find("[name='trauma-cost']").val() || 0);
    const tier = String(html.find("[name='trauma-tier']").val() || "silver");
    if (!name) return AgentAudio.play("error");
    await app.mutate("trauma.save", { option: { name, cost, tier } });
  });

  html.on("click", "[data-action='trauma-delete']", async (ev) => {
    await app.mutate("trauma.delete", { optionId: ev.currentTarget.dataset.optionId });
  });
}
