/* NC Mart: catalog from system compendium packs, cart, checkout.
 * Clicking an item opens its native system sheet from the compendium. */

import { PACK_CATEGORIES, STORE_CATEGORIES, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";
import { availableToPlayer } from "../store-rules.js";

let _catalog = null;      // [{uuid, name, img, price, category}]
let _loading = false;
let _catalogSources = "";
let _generation = 0;

async function loadCatalog(app, cfg, sourceKey) {
  if (_catalog || _loading) return;
  _loading = true;
  const generation = _generation;
  try {
    const packIds = [...new Set([...Object.keys(PACK_CATEGORIES), ...(cfg.extraPacks || [])])];
    const items = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, packIds.length) }, async () => {
      while (next < packIds.length && generation === _generation) {
        const packId = packIds[next++];
        const pack = game.packs.get(packId);
        if (!pack || pack.documentName !== "Item") continue;
        const category = PACK_CATEGORIES[packId] || String(pack.metadata.label || "Extra").trim() || "Extra";
        try {
          const index = await pack.getIndex({ fields: ["system.price.market", "system.core", "img", "type"] });
          for (const e of index) {
            if (e.system?.core) continue;
            const price = Number(foundry.utils.getProperty(e, "system.price.market") || 0);
            if (!(price > 0)) continue;
            items.push({
              uuid: `Compendium.${packId}.Item.${e._id}`,
              name: e.name,
              img: e.img || "icons/svg/item-bag.svg",
              price,
              type: e.type,
              category,
              isCore: !!PACK_CATEGORIES[packId]
            });
          }
        } catch (e) { console.warn(`AgentOS | cannot index ${packId}`, e); }
      }
    }));
    if (generation === _generation) {
      items.sort((a, b) => a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid));
      _catalog = items;
      _catalogSources = sourceKey;
    }
  } catch (e) {
    console.error("AgentOS | store catalog load failed", e);
    if (generation === _generation) { _catalog = []; _catalogSources = sourceKey; }
  } finally {
    _loading = false;
    if (app.rendered && app.currentApp === "store") app.render(false);
  }
}

export function invalidateCatalog() {
  _catalog = null;
  _generation++;
}

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const cfg = Data.getWorld("storeConfig") || {};
  const sourceKey = JSON.stringify([...new Set(cfg.extraPacks || [])].sort());
  if (_catalog && _catalogSources !== sourceKey) invalidateCatalog();

  if (!_catalog) {
    loadCatalog(app, cfg, sourceKey);
    return { loading: true };
  }

  const locked = cfg.lockedCategories || [];
  const blacklist = (cfg.blacklist || []).map(b => b.uuid);
  let items = _catalog.filter(i => {
    if (locked.includes(i.category)) return false;
    if (blacklist.includes(i.uuid)) return false;
    if (!isGM && !availableToPlayer(i, cfg, game.user.id)) return false;
    if (cfg.sourceFilter === "core" && !i.isCore) return false;
    if (cfg.sourceFilter === "extra" && i.isCore) return false;
    return true;
  });

  const present = new Set(items.map(i => i.category));
  const customCats = [...present].filter(c => !STORE_CATEGORIES.includes(c)).sort((a, b) => a.localeCompare(b));
  const categories = [
    ...STORE_CATEGORIES.filter(c => !locked.includes(c) && present.has(c)),
    ...customCats
  ];
  const byType = st.browseMode === "types";
  const tabs = byType ? [...new Set(items.map(i => i.type))].sort() : categories;
  const chosen = byType ? st.itemType : st.category;
  const activeCat = tabs.includes(chosen) ? chosen : (tabs[0] || "");
  const searchValue = (byType ? st.typeSearch : st.search) || "";
  const search = searchValue.toLowerCase();

  items = items.filter(i => (byType ? i.type : i.category) === activeCat);
  if (search) items = items.filter(i => i.name.toLowerCase().includes(search));

  let buyer = null;
  if (isGM) {
    if (st.buyerUuid) buyer = await fromUuid(st.buyerUuid);
  } else {
    buyer = game.user.character;
  }

  /* Markup follows the BUYER (the player owning the target actor), so a
   * per-player markup shows even when a GM shops on their behalf.
   * Empty per-player value → the global markup. */
  const buyerUserId = buyer
    ? (game.users.find(u => !u.isGM && u.character?.uuid === buyer.uuid)?.id || null)
    : null;
  const perPlayer = (cfg.playerMarkup || {})[buyerUserId];
  const markup = Number(perPlayer ?? cfg.markup ?? 0);

  const priced = (p) => Math.max(0, Math.ceil(p * (1 + markup / 100)));
  const cart = (st.cart || []).map(uuid => _catalog.find(i => i.uuid === uuid)).filter(Boolean);
  const total = cart.reduce((a, i) => a + priced(i.price), 0);

  return {
    loading: false,
    isGM,
    byType,
    categories: tabs.map(c => ({ id: c, label: byType ? game.i18n.localize(`CPR.global.itemTypes.${c}`) : c, active: c === activeCat })),
    items: items.slice(0, 300).map(i => ({ ...i, shownPrice: priced(i.price) })),
    search: searchValue,
    cart: cart.map(i => ({ ...i, shownPrice: priced(i.price) })),
    cartCount: cart.length,
    cartOpen: !!st.cartOpen,
    total,
    buyerName: buyer?.name || "",
    buyerUuid: buyer?.uuid || "",
    balance: buyer ? Data.actorWealth(buyer) : 0,
    canBuy: !!buyer && cart.length > 0 && Data.actorWealth(buyer) >= total,
    buyers: isGM ? game.users.filter(u => !u.isGM && u.character).map(u => ({
      uuid: u.character.uuid,
      name: `${u.character.name} (${u.name})`,
      selected: u.character.uuid === st.buyerUuid
    })) : []
  };
}

export function activateListeners(app, html) {
  const st = app.state;

  // Cached indexes can finish before Application v1 finishes its first render.
  // Its activateListeners runs before RENDERED; refresh after that stack returns.
  if (!_loading && html.find(".agentos-store-loading").length) queueMicrotask(() => {
    if (app.rendered && app.currentApp === "store") app.render(false);
  });

  /* Preserve the list scroll across re-renders and category switches. */
  const scroller = html.find(".agentos-store-catalog")[0] || html.find(".agentos-app-body")[0];
  if (scroller) {
    if (st._scroll) scroller.scrollTop = st._scroll;
    scroller.addEventListener("scroll", () => { st._scroll = scroller.scrollTop; });
  }

  /* Preserve the CATEGORY STRIP's horizontal scroll too — clicking a tab
   * re-renders and used to snap the strip back to the start. */
  const catsNav = html.find(".agentos-store-cats")[0];
  const scrollKey = st.browseMode === "types" ? "_typeCatsScroll" : "_catsScroll";
  if (catsNav) {
    if (st[scrollKey]) catsNav.scrollLeft = st[scrollKey];
    catsNav.addEventListener("scroll", () => { st[scrollKey] = catsNav.scrollLeft; });
  }

  html.on("click", "[data-action='store-browse-mode']", (ev) => {
    st.browseMode = ev.currentTarget.dataset.mode;
    app.render(false);
  });

  html.on("click", "[data-action='store-cats-scroll']", (ev) => {
    const nav = html.find(".agentos-store-cats")[0];
    if (nav) nav.scrollBy({ left: Number(ev.currentTarget.dataset.dir) * 140, behavior: "smooth" });
  });

  html.on("click", "[data-action='store-cat']", (ev) => {
    st[st.browseMode === "types" ? "itemType" : "category"] = ev.currentTarget.dataset.cat;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("input", "[name='store-search']", foundry.utils.debounce((ev) => {
    st[st.browseMode === "types" ? "typeSearch" : "search"] = ev.target.value;
    st.focusSearch = true;
    app.render(false);
  }, 250));
  html.find("[name='store-search']").on("blur", () => { st.focusSearch = false; });
  if (st.focusSearch) {
    const inp = html.find("[name='store-search']")[0];
    if (inp) {
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* noop */ }
    }
  }

  html.on("click", "[data-action='store-view-item']", async (ev) => {
    ev.stopPropagation();
    const doc = await fromUuid(ev.currentTarget.dataset.uuid);
    if (doc) doc.sheet.render(true);
  });

  html.on("click", "[data-action='store-add']", (ev) => {
    ev.stopPropagation();
    st.cart = st.cart || [];
    st.cart.push(ev.currentTarget.dataset.uuid);
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='store-remove']", (ev) => {
    const uuid = ev.currentTarget.dataset.uuid;
    st.cart = st.cart || [];
    const idx = st.cart.indexOf(uuid);
    if (idx >= 0) st.cart.splice(idx, 1);
    app.render(false);
  });

  html.on("click", "[data-action='store-cart-toggle']", () => {
    st.cartOpen = !st.cartOpen;
    app.render(false);
  });

  html.on("change", "[name='store-buyer']", (ev) => {
    st.buyerUuid = ev.currentTarget.value;
    app.render(false);
  });

  html.on("click", "[data-action='store-checkout']", async (ev) => {
    const actorUuid = ev.currentTarget.dataset.actorUuid;
    const itemUuids = (st.cart || []).slice();
    if (!actorUuid || !itemUuids.length) return AgentAudio.play("error");
    if (st.checkingOut) return;
    st.checkingOut = true;
    const result = await app.mutate("store.checkout", { actorUuid, itemUuids });
    st.checkingOut = false;
    if (!result) return;
    st.cart = (st.cart || []).slice(itemUuids.length);
    st.cartOpen = false;
    app.render(false);
    if (game.user.isGM) {
      if (result) { ui.notifications.info(loc("AGENTOS.Store.OrderSent")); AgentAudio.play("cash"); }
    } else {
      // Relayed to the GM for validation — confirmation arrives via notify.
      ui.notifications.info(loc("AGENTOS.Store.OrderSent"));
      AgentAudio.play("tap");
    }
  });
}
