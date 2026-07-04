/* Chrome: cyberware / implant viewer. Read-only against the CPR actor, plus a
 * module-owned display layout (side swap + pairing) that never touches the
 * character sheet. Reads the actor's installed cyberware (item.type ===
 * "cyberware"), grouped by system.type, resolving foundational bases and the
 * items nested in their option slots.
 *
 * CPR data model:
 *   system.type            -> body-slot category (cyberEye, cyberArm, ...)
 *   system.isFoundational  -> provides option slots (a "base")
 *   system.installedItems  -> { list:[ids], slots, usedSlots, allowed, allowedTypes }
 *   system.size            -> how many option slots an item consumes
 *   system.isInstalledInActor -> truly active on the character (nesting-aware)
 *
 * Only foundational cyberware may hold expansions, so slot rows are shown only
 * for foundational bases. Slot dots are coloured by what occupies them:
 * cyberware (accent), upgrade (gold), free (empty).
 *
 * Display layout is stored in world setting `chromeLayout[actorId]`:
 *   { sides:  { "<unitId>": "left"|"right" },   // forced side override
 *     paired: { "cyberEye": true, ... } }        // merged into one panel
 */

import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

/* Fallback FA glyph per category when an item has no bespoke image. */
const CAT_ICON = {
  neuralWare:        "fa-brain",
  cyberAudioSuite:   "fa-headphones",
  cyberEye:          "fa-eye",
  cyberArm:          "fa-hand",
  cyberLeg:          "fa-shoe-prints",
  cyberwareInternal: "fa-lungs",
  cyberwareExternal: "fa-diagram-project",
  borgware:          "fa-robot",
  fashionware:       "fa-shirt"
};

/* Images we treat as "no real icon" -> replace with a category glyph. */
function isDefaultImg(img) {
  if (!img) return true;
  return /Default_Cyberware\.svg$/i.test(img)
    || /icons\/svg\/(item-bag|mystery-man|upgrade|aura)\.svg$/i.test(img);
}

/** Number of distinct palette colours available for installed implants. */
const SLOT_COLORS = 8;

/** Build a display node for one cyberware item, recursing into its slots.
 *  `colorIdx` is the palette slot assigned to THIS item (so its own row marker
 *  and the dots it occupies on the parent base share one colour). */
function buildItem(item, actor, catType, depth = 0, colorIdx = -1) {
  const sys = item.system || {};
  const container = sys.installedItems || {};
  const childIds = Array.isArray(container.list) ? container.list : [];
  const childItems = childIds.map(id => actor.items.get(id)).filter(Boolean);

  const foundational = !!sys.isFoundational;
  const allowed = !!container.allowed;
  const slots = Number(container.slots || 0);
  // Only foundational bases with option slots enabled may be expanded.
  const hasSlots = foundational && allowed && slots > 0;

  // Assign each direct child its own palette colour (cycled), then build them
  // with that colour so the child's row marker matches the base's slot dots.
  const childColor = new Map();
  childItems.forEach((c, i) => childColor.set(c.id, i % SLOT_COLORS));
  const children = childItems.map(c => buildItem(c, actor, catType, depth + 1, childColor.get(c.id)));

  // Colour the slot dots by which implant occupies them (per-item colour).
  const slotDots = [];
  if (hasSlots) {
    for (const c of childItems) {
      const size = Math.max(1, Number(c.system?.size || 1));
      for (let i = 0; i < size; i++) slotDots.push({ colorIdx: childColor.get(c.id), free: false });
    }
    while (slotDots.length < slots) slotDots.push({ colorIdx: -1, free: true });
    if (slotDots.length > slots) slotDots.length = slots; // guard against overfill
  }

  const size = Math.max(1, Number(sys.size || 1));

  return {
    id: item.id,
    name: item.name,
    img: item.img,
    useIcon: isDefaultImg(item.img),
    iconClass: CAT_ICON[catType] || "fa-microchip",
    isUpgrade: item.type === "itemUpgrade",
    colorIdx,                       // this item's own palette colour (-1 = none)
    hasColor: colorIdx >= 0,
    size,
    // size dots shown on installed children (how many slots it occupies) —
    // always shown for nested items, even when it is a single slot.
    sizeDots: depth > 0
      ? Array.from({ length: size }, () => ({ colorIdx, free: false }))
      : [],
    isFoundational: foundational,
    hasSlots,
    slots,
    used: Number(container.usedSlots || 0),
    slotDots,
    depth,
    children
  };
}

/** All cyberware of one system.type installed & active on the actor. */
function itemsOfType(actor, type) {
  return (actor.itemTypes?.cyberware || []).filter(i => {
    const sys = i.system || {};
    if (sys.type !== type) return false;
    return sys.isInstalledInActor ?? sys.isInstalled ?? false;
  });
}

/** Count of implants for the summary — excludes CPR's built-in "core"
 *  containers (hidden internal/external/fashionware bases baked into the
 *  sheet), which aren't real chrome the character chose to install. */
function implantCount(actor) {
  return (actor.itemTypes?.cyberware || []).filter(i => {
    const sys = i.system || {};
    if (sys.core) return false;
    return (sys.isInstalledInActor ?? sys.isInstalled) ?? false;
  }).length;
}

/** Foundational "units" and baseless items of one type, as display nodes. */
function unitsOfType(actor, type) {
  const all = itemsOfType(actor, type);
  const bases = all.filter(i => i.system?.isFoundational);

  const claimed = new Set();
  const collect = (item) => {
    for (const id of item.system?.installedItems?.list || []) {
      claimed.add(id);
      const child = actor.items.get(id);
      if (child) collect(child);
    }
  };
  bases.forEach(collect);

  const baseless = all.filter(i => !i.system?.isFoundational && !claimed.has(i.id));

  // A "unit" is one draggable/assignable card: a base (with its tree) or a
  // single baseless item. unitId is the item id either way.
  return [
    ...bases.map(b => ({ id: b.id, base: buildItem(b, actor, type), baseless: [] })),
    ...baseless.map(b => ({ id: b.id, base: null, baseless: [buildItem(b, actor, type)] }))
  ];
}

/** Wrap a set of units into a panel payload for the template. */
function makePanel(type, labelKey, units, opts = {}) {
  return {
    type,
    labelKey,
    empty: units.length === 0,
    // units carry their own id so each card is individually draggable
    units: units.map(u => ({ id: u.id, base: u.base, baseless: u.baseless })),
    count: units.reduce((n, u) => n + (u.base ? 1 : 0) + u.baseless.length, 0),
    ...opts
  };
}

/** A plain (non-paired) category panel. */
function panel(actor, type, labelKey) {
  return makePanel(type, labelKey, unitsOfType(actor, type), { paired: false });
}

/**
 * Paired type -> right / left panels, honouring the saved layout:
 *  - `paired[type]` collapses both sides into ONE merged panel;
 *  - `sides[unitId]` forces a unit onto a given side;
 *  - otherwise units alternate right, left, right… by discovery order.
 */
function pairPanels(actor, type, keys, layout) {
  const units = unitsOfType(actor, type);
  const canEdit = actor.isOwner || game.user.isGM;

  if (layout.paired?.[type]) {
    const p = makePanel(`${type}-paired`, keys.paired, units, {
      paired: true, side: "paired", pairType: type, canEdit
    });
    // `merged` fills the LEFT column's cell; `placeholder` keeps the RIGHT
    // column's cell so no panel below either column shifts up.
    return { merged: p, placeholder: { pairType: type, canEdit, splitLabel: keys.left } };
  }

  const forced = layout.sides || {};
  const right = [], left = [];
  let flip = 0;
  for (const u of units) {
    const side = forced[u.id] || (flip++ % 2 === 0 ? "right" : "left");
    (side === "left" ? left : right).push(u);
  }

  const wrap = (side, key, us) => makePanel(`${type}-${side[0]}`, key, us, {
    paired: false, side, pairType: type, canEdit,
    // the merge button lives on the LEFT panel of a pair
    mergeable: side === "left" && canEdit && units.length > 0
  });

  return { right: wrap("right", keys.right, right), left: wrap("left", keys.left, left) };
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
        const id = Data.playerIdentity(u.id);
        return { actorUuid: u.character.uuid, name: id.name, img: id.img, userName: u.name, count: implantCount(u.character) };
      })
    };
  }

  if (!actor) return { noActor: true };

  const layout = (Data.getWorld("chromeLayout") || {})[actor.id] || { sides: {}, paired: {} };
  const canEdit = actor.isOwner || isGM;

  const hum = actor.system?.derivedStats?.humanity || { value: 0, max: 1 };
  const humPct = Math.max(0, Math.min(100, Math.round((hum.value / Math.max(1, hum.max)) * 100)));

  // Cyberpsychosis: escalating portrait corruption as Humanity drops.
  //   0: none (>=30)  1: faint (29-20)  2: split/jitter (19-10)
  //   3: heavy + slot glitch (9-0)      4: critical / errors (<0)
  const hv = Number(hum.value);
  const psychoLevel = hv < 0 ? 4 : hv <= 9 ? 3 : hv <= 19 ? 2 : hv <= 29 ? 1 : 0;

  const eyes = pairPanels(actor, "cyberEye", {
    right: "AGENTOS.Chrome.RightEye", left: "AGENTOS.Chrome.LeftEye", paired: "AGENTOS.Chrome.PairedEye"
  }, layout);
  const arms = pairPanels(actor, "cyberArm", {
    right: "AGENTOS.Chrome.RightArm", left: "AGENTOS.Chrome.LeftArm", paired: "AGENTOS.Chrome.PairedArm"
  }, layout);
  const legs = pairPanels(actor, "cyberLeg", {
    right: "AGENTOS.Chrome.RightLeg", left: "AGENTOS.Chrome.LeftLeg", paired: "AGENTOS.Chrome.PairedLeg"
  }, layout);

  const total = implantCount(actor);

  return {
    listMode: false,
    isGM,
    canEdit,
    actorName: actor.name,
    actorImg: actor.img,
    actorUuid: actor.uuid,
    humCurrent: hum.value,
    humMax: hum.max,
    humPct,
    humState: humPct > 50 ? "ok" : (humPct > 25 ? "warn" : "crit"),
    psychoLevel,
    psychoGlitch: psychoLevel >= 3,   // heavy glitch also flickers around slots
    total,
    // top-center
    neural: panel(actor, "neuralWare", "AGENTOS.Chrome.Neural"),
    audio: panel(actor, "cyberAudioSuite", "AGENTOS.Chrome.Audio"),
    // paired groups (each is either {merged} or {right,left})
    eyes, arms, legs,
    // fixed single-side columns
    internal: panel(actor, "cyberwareInternal", "AGENTOS.Chrome.Internal"),
    borg: panel(actor, "borgware", "AGENTOS.Chrome.Borg"),
    external: panel(actor, "cyberwareExternal", "AGENTOS.Chrome.External"),
    fashion: panel(actor, "fashionware", "AGENTOS.Chrome.Fashion")
  };
}

/* ---------------- layout mutations ---------------- */

async function currentActor(app) {
  return app.state.actorUuid ? await fromUuid(app.state.actorUuid) : game.user.character;
}

async function saveLayout(app, actor, mutateFn) {
  const all = Data.getWorld("chromeLayout") || {};
  const layout = all[actor.id] || { sides: {}, paired: {} };
  layout.sides = layout.sides || {};
  layout.paired = layout.paired || {};
  mutateFn(layout);
  await app.mutate("chrome.setLayout", { actorUuid: actor.uuid, layout });
  app.render(false);
}

export function activateListeners(app, html) {
  const st = app.state;

  html.on("click", "[data-action='chrome-select']", (ev) => {
    st.actorUuid = ev.currentTarget.dataset.actorUuid;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='chrome-back']", () => {
    app.state = {};
    app.render(false);
  });

  html.on("click", "[data-action='chrome-item']", async (ev) => {
    const actor = await currentActor(app);
    const item = actor?.items.get(ev.currentTarget.dataset.itemId);
    if (item?.sheet) { AgentAudio.play("tap"); item.sheet.render(true); }
  });

  /* Merge / split the two sides of a paired type. */
  html.on("click", "[data-action='chrome-merge']", async (ev) => {
    ev.stopPropagation();
    const type = ev.currentTarget.dataset.pairType;
    const actor = await currentActor(app);
    if (!type || !actor) return;
    AgentAudio.play("tap");
    await saveLayout(app, actor, (l) => { l.paired[type] = true; });
  });
  html.on("click", "[data-action='chrome-split']", async (ev) => {
    ev.stopPropagation();
    const type = ev.currentTarget.dataset.pairType;
    const actor = await currentActor(app);
    if (!type || !actor) return;
    AgentAudio.play("tap");
    await saveLayout(app, actor, (l) => { delete l.paired[type]; });
  });

  /* Drag a unit card between the left / right panels of the same type. */
  html.on("dragstart", "[data-chrome-unit]", (ev) => {
    const el = ev.currentTarget;
    ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({
      chromeUnit: el.dataset.chromeUnit,
      pairType: el.dataset.pairType
    }));
    ev.originalEvent.dataTransfer.effectAllowed = "move";
  });

  const panels = html.find("[data-chrome-drop]");
  panels.on("dragover", (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.add("drop-over");
  });
  panels.on("dragleave", (ev) => ev.currentTarget.classList.remove("drop-over"));
  panels.on("drop", async (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.remove("drop-over");
    let data;
    try { data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain")); }
    catch (e) { return; }
    if (!data?.chromeUnit) return;
    const drop = ev.currentTarget.dataset;
    if (drop.pairType !== data.pairType) return;         // only within the same type
    if (!drop.chromeDrop) return;
    const actor = await currentActor(app);
    if (!actor) return;
    AgentAudio.play("tap");
    await saveLayout(app, actor, (l) => { l.sides[data.chromeUnit] = drop.chromeDrop; });
  });
}
