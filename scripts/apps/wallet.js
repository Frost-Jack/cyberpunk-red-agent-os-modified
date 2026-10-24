/* Wallet: synced with the CPR character sheet ledger. */

import { loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

function transferTargets(excludeActorUuid) {
  const out = [];
  for (const user of game.users.filter(u => !u.isGM)) {
    const actorUuid = user.character?.uuid || (user._source?.character ? `Actor.${user._source.character}` : null);
    if (!actorUuid || actorUuid === excludeActorUuid) continue;
    const ident = Data.playerIdentity(user.id);
    out.push({ id: `actor:${actorUuid}`, name: ident.name, img: ident.img, sub: user.name });
  }
  for (const g of Data.visibleGardenContacts(game.user.isGM)) {
    out.push({
      id: g.actorUuid ? `actor:${g.actorUuid}` : `garden:${g.id}`,
      name: g.name,
      img: g.img || "icons/svg/mystery-man.svg",
      sub: "Garden"
    });
  }
  return out;
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
      wallets: game.users.filter(u => !u.isGM && u.character).map(u => ({
        userId: u.id,
        actorUuid: u.character.uuid,
        name: Data.playerIdentity(u.id).name,
        img: Data.playerIdentity(u.id).img,
        userName: u.name,
        balance: Data.actorWealth(u.character),
        expenses: Data.recurringExpenses(u.id)
      })),
      award: st.award,
      awardMoney: st.award?.resource === "wealth",
      awardTargets: st.award ? [...new Map(game.users.filter(u => !u.isGM && u.character).map(u => [u.character.uuid, u.character])).values()].map(actor => ({
        uuid: actor.uuid,
        name: `${actor.name} (${game.users.filter(u => !u.isGM && u.character?.uuid === actor.uuid).map(u => u.name).join(", ")})`,
        selected: st.award.actorUuids.includes(actor.uuid)
      })) : []
    };
  }

  if (!actor) return { noActor: true };

  return {
    listMode: false,
    isGM,
    actorName: actor.name,
    actorImg: actor.img,
    actorUuid: actor.uuid,
    balance: Data.actorWealth(actor),
    transactions: Data.actorTransactions(actor).slice(0, 60),
    expenses: Data.recurringExpenses(game.users.find(u => u.character?.uuid === actor.uuid)?.id || game.user.id),
    openExpenses: !!st.openExpenses,
    notices: ((Data.getWorld("monthlyNotices") || {})[game.users.find(u => u.character?.uuid === actor.uuid)?.id || game.user.id] || []).slice().reverse(),
    transferring: !!st.transferring,
    targets: st.transferring ? transferTargets(actor.uuid) : []
  };
}

export function activateListeners(app, html) {
  const st = app.state;
  html.on("click", "[data-action='monthly-send']", async () => {
    const userIds = html.find("[name='monthly-user']:checked").map((_, e) => e.value).get();
    if (!userIds.length) return AgentAudio.play("error");
    await app.mutate("monthly.notify", { userIds });
  });

  html.on("click", "[data-action='wallet-select']", (ev) => {
    st.actorUuid = ev.currentTarget.dataset.actorUuid;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='wallet-back']", () => {
    app.state = {};
    app.render(false);
  });

  /* ---- GM awards to assigned player characters, online or offline ---- */

  html.on("click", "[data-action='gm-award-money'],[data-action='gm-award-ip']", ev => {
    st.award = { resource: ev.currentTarget.dataset.action === "gm-award-money" ? "wealth" : "improvementPoints", actorUuids: [], senderName: "", amount: "", memo: "" };
    app.render(false);
  });

  html.on("click", "[data-action='gm-award-cancel']", () => {
    st.award = null;
    app.render(false);
  });

  html.on("input", "[data-award-field]", ev => { st.award[ev.currentTarget.dataset.awardField] = ev.currentTarget.value; });
  html.on("change", "[data-action='gm-award-all']", ev => {
    html.find("[name='gm-award-target']").prop("checked", ev.currentTarget.checked);
    st.award.actorUuids = html.find("[name='gm-award-target']:checked").map((_, e) => e.value).get();
  });
  html.on("change", "[name='gm-award-target']", () => {
    st.award.actorUuids = html.find("[name='gm-award-target']:checked").map((_, e) => e.value).get();
    syncAwardAll();
  });
  function syncAwardAll() {
    const all = html.find("[data-action='gm-award-all']")[0], count = html.find("[name='gm-award-target']").length;
    if (!all) return;
    all.checked = count > 0 && st.award.actorUuids.length === count;
    all.indeterminate = st.award.actorUuids.length > 0 && st.award.actorUuids.length < count;
  }
  syncAwardAll();
  html.on("click", "[data-action='gm-award-send']", async ev => {
    const award = st.award, amount = Number(award.amount);
    if (!award.actorUuids.length || !Number.isSafeInteger(amount) || amount <= 0) return AgentAudio.play("error");
    const button = ev.currentTarget;
    button.disabled = true;
    const result = await app.mutate("wallet.gmAward", { ...award, amount, senderName: award.senderName.trim(), memo: award.memo.trim() });
    if (result) { st.award = null; AgentAudio.play(award.resource === "wealth" ? "cash" : "tap"); app.render(false); }
    else { button.disabled = false; ui.notifications.warn(loc("AGENTOS.Wallet.AwardFailed")); }
  });

  html.on("click", "[data-action='transfer-open']", () => {
    st.transferring = true;
    app.render(false);
  });

  html.on("click", "[data-action='transfer-cancel']", () => {
    st.transferring = false;
    app.render(false);
  });

  html.on("click", "[data-action='transfer-send']", async (ev) => {
    const fromActorUuid = ev.currentTarget.dataset.actorUuid;
    const target = String(html.find("[name='transfer-target']").val() || "");
    const amount = Math.floor(Number(html.find("[name='transfer-amount']").val() || 0));
    const memoIn = String(html.find("[name='transfer-memo']").val() || "").trim();
    if (!target || !(amount > 0)) return AgentAudio.play("error");

    let toActorUuid = null;
    let memo = memoIn;
    if (target.startsWith("actor:")) toActorUuid = target.slice(6);
    else if (target.startsWith("garden:")) {
      const g = Data.gardenContact(target.slice(7));
      memo = memoIn ? `${g?.name || "?"} — ${memoIn}` : (g?.name || "?");
    }

    const from = await fromUuid(fromActorUuid);
    if (from && Data.actorWealth(from) < amount) {
      ui.notifications.warn(loc("AGENTOS.Wallet.NotEnough"));
      return AgentAudio.play("error");
    }
    const result = await app.mutate("wallet.transfer", { fromActorUuid, toActorUuid, amount, memo });
    if (result) { st.transferring = false; app.render(false); }
    if (game.user.isGM && result) AgentAudio.play("cash");
    else if (!game.user.isGM) AgentAudio.play("tap");
  });
}
