/* RED availability uses its native price categories, not a separate rarity field.
 * Thresholds match cyberpunk-red-core's itemPriceCategoryMap (before markup). */
export const RARITIES = [
  ["free", 0], ["dirtCheap", 5], ["cheap", 10], ["everyday", 20],
  ["costly", 50], ["premium", 100], ["expensive", 500],
  ["veryExpensive", 1000], ["luxury", 5000], ["superLuxury", 10000]
];

export function itemRarity(price) {
  if (price <= 0) return "free";
  return RARITIES.slice(1).reverse().find(([, threshold]) => price >= threshold)?.[0] || "dirtCheap";
}

export function rarityChoices(selected, inherited = false) {
  return [
    ...(inherited ? [{ id: "inherit", label: game.i18n.localize("AGENTOS.Admin.Inherit") }] : []),
    { id: "", label: game.i18n.localize("AGENTOS.Admin.Unlimited") },
    ...RARITIES.map(([id]) => ({ id, label: game.i18n.localize(`CPR.global.priceCategory.${id}`) }))
  ].map(choice => ({ ...choice, selected: choice.id === selected }));
}

export function availableToPlayer(item, cfg, userId) {
  const limit = cfg.playerMaxRarity?.[userId] ?? cfg.maxRarity ?? "premium";
  if (limit && RARITIES.some(([id]) => id === limit)) {
    if (RARITIES.findIndex(([id]) => id === itemRarity(item.price)) > RARITIES.findIndex(([id]) => id === limit)) return false;
  }
  // Explicitly saved legacy caps remain compatible. New stores use rarity only.
  const cap = cfg.playerMaxPrice?.[userId] ?? cfg.maxPrice ?? 0;
  return !(cap > 0 && item.price > cap);
}

/* Only genuinely identical, unmodified stacks are combined. Native CPR stacking
 * depends on an open sheet and can also combine upgraded items by name alone. */
function stackKey(doc) {
  const data = doc.toObject();
  if (!Number.isFinite(data.system?.amount) || (doc.system?.isInstalled && doc.type !== "ammo") ||
      data.system.installedItems?.list?.length || data.system.installedUpgrades?.length ||
      data.effects?.length || data.flags?.cprInstallTree) return null;
  const { amount, equipped, ...system } = data.system;
  const flags = structuredClone(data.flags || {});
  if (flags.core) {
    delete flags.core.sourceId;
    if (!Object.keys(flags.core).length) delete flags.core;
  }
  const ordered = value => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])])) : value;
  return JSON.stringify(ordered({ name: data.name, type: data.type, system, flags }));
}

export async function deliverStoreItems(actor, docs) {
  const stacks = new Map();
  for (const item of actor.items) {
    const key = stackKey(item);
    if (key && !stacks.has(key)) stacks.set(key, { id: item.id, amount: item.system.amount });
  }
  const updates = new Map(), originals = new Map(), creates = [];
  for (const doc of docs) {
    const key = stackKey(doc);
    const existing = key && stacks.get(key);
    const quantity = Math.max(1, doc.system.amount || 1);
    if (existing) {
      if (existing.id) {
        if (!originals.has(existing.id)) originals.set(existing.id, existing.amount);
        existing.amount += quantity;
        updates.set(existing.id, existing.amount);
      } else existing.data.system.amount += quantity;
    } else {
      const data = doc.toObject();
      delete data._id;
      if (Number.isFinite(data.system.amount)) data.system.amount = quantity;
      creates.push(data);
      if (key) stacks.set(key, { data });
    }
  }
  let created = [];
  try {
    if (creates.length) {
      created = await actor.createEmbeddedDocuments("Item", creates, { CPRsplitStack: true, createInstalled: true });
      if (created.length !== creates.length) throw new Error("Store item delivery incomplete");
    }
    if (updates.size) await actor.updateEmbeddedDocuments("Item", [...updates].map(([_id, amount]) => ({ _id, "system.amount": amount })));
  } catch (error) {
    if (created.length) await actor.deleteEmbeddedDocuments("Item", created.map(item => item.id), { deleteInstalled: true });
    if (originals.size) await actor.updateEmbeddedDocuments("Item", [...originals].map(([_id, amount]) => ({ _id, "system.amount": amount })));
    throw error;
  }
}
