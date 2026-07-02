/* Wallet: synced with the CPR character sheet ledger. */

import { loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

function transferTargets(excludeActorUuid) {
  const out = [];
  for (const user of game.users.filter(u => !u.isGM && u.character)) {
    if (user.character.uuid === excludeActorUuid) continue;
    const ident = Data.playerIdentity(user.id);
    out.push({ id: `actor:${user.character.uuid}`, name: ident.name, img: ident.img, sub: user.name });
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
        balance: Data.actorWealth(u.character)
      })),
      gmTransfer: !!st.gmTransfer,
      gmTargets: st.gmTransfer ? game.users.filter(u => !u.isGM && u.character).map(u => ({
        uuid: u.character.uuid,
        name: `${u.character.name} (${u.name})`
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
    transferring: !!st.transferring,
    targets: st.transferring ? transferTargets(actor.uuid) : []
  };
}

export function activateListeners(app, html) {
  const st = app.state;

  html.on("click", "[data-action='wallet-select']", (ev) => {
    st.actorUuid = ev.currentTarget.dataset.actorUuid;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='wallet-back']", () => {
    app.state = {};
    app.render(false);
  });

  /* ---- GM transfer on behalf of any player ---- */

  html.on("click", "[data-action='gm-transfer-open']", () => {
    st.gmTransfer = true;
    app.render(false);
  });

  html.on("click", "[data-action='gm-transfer-cancel']", () => {
    st.gmTransfer = false;
    app.render(false);
  });

  html.on("click", "[data-action='gm-transfer-send']", async () => {
    const senderName = String(html.find("[name='gm-transfer-sender']").val() || "").trim();
    const toActorUuid = String(html.find("[name='gm-transfer-target']").val() || "");
    const amount = Math.floor(Number(html.find("[name='gm-transfer-amount']").val() || 0));
    const memo = String(html.find("[name='gm-transfer-memo']").val() || "").trim();
    if (!senderName || !toActorUuid || !(amount > 0)) return AgentAudio.play("error");
    st.gmTransfer = false;
    const result = await app.mutate("wallet.gmGrant", { toActorUuid, amount, senderName, memo });
    if (result) AgentAudio.play("cash");
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
    st.transferring = false;
    const result = await app.mutate("wallet.transfer", { fromActorUuid, toActorUuid, amount, memo });
    if (game.user.isGM && result) AgentAudio.play("cash");
    else if (!game.user.isGM) AgentAudio.play("tap");
  });
}
