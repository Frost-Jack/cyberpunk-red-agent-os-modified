/* Shared constants for Cyberpunk Agent OS. */

export const MODULE_ID = "cyberpunk-red-agent-os-modified";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const TPL = (name) => `modules/${MODULE_ID}/templates/${name}.hbs`;

/* App registry. `gmOnly` apps never appear for players; visibility of the rest
 * is controlled by the GM through the Sys Admin app (world setting appConfig).
 * Settings is NOT a home tile — it opens from the gear in the device top bar.
 * Icons are Font Awesome glyphs coloured by the app's purpose. */
export const APPS = [
  { id: "chat",     icon: "fa-comment-dots",       color: "#38d4ff", labelKey: "AGENTOS.App.chat" },     // связь — неоново-голубой
  { id: "datapool", icon: "fa-envelope-open-text", color: "#2ff5d0", labelKey: "AGENTOS.App.datapool" }, // данные — бирюзовый
  { id: "wallet",   icon: "fa-credit-card",        color: "#ffd23f", labelKey: "AGENTOS.App.wallet" },   // деньги — золотой
  { id: "contacts", icon: "fa-address-book",       color: "#ff9d3c", labelKey: "AGENTOS.App.contacts" }, // записная книжка — оранжевый
  { id: "map",      icon: "fa-map-location-dot",   color: "#3df58a", labelKey: "AGENTOS.App.map" },      // навигация — зелёный
  { id: "bio",      icon: "fa-heart-pulse",        color: "#ff2b55", labelKey: "AGENTOS.App.bio" },      // витальность — красный
  { id: "chrome",   icon: "fa-microchip",          color: "#ff3b30", labelKey: "AGENTOS.App.chrome" },   // импланты — кровавый неон
  { id: "radio",    icon: "fa-radio",              color: "#b06bff", labelKey: "AGENTOS.App.radio" },    // радио — синтвейв-фиолет
  { id: "store",    icon: "fa-cart-shopping",      color: "#ff4fd8", labelKey: "AGENTOS.App.store" },    // рынок — неоново-розовый
  { id: "id",       icon: "fa-id-card",            color: "#7a6bff", labelKey: "AGENTOS.App.id" },       // документ — индиго
  { id: "ncpd",     icon: "fa-building-shield",    color: "#38b6ff", labelKey: "AGENTOS.App.ncpd" },     // полиция — холодный синий
  { id: "garden",   icon: "fa-seedling",           color: "#b6ff6b", labelKey: "AGENTOS.App.garden" },   // сеть контактов — салатовый
  { id: "library",  icon: "fa-book-open",          color: "#ffa361", labelKey: "AGENTOS.App.library" },  // книги — тёплый янтарь
  { id: "tools",    icon: "fa-terminal",           color: "#4dffb0", labelKey: "AGENTOS.App.tools" },    // дэймоны — токсично-зелёный
  { id: "arcade",   icon: "fa-gamepad",            color: "#c850ff", labelKey: "AGENTOS.App.arcade" },   // игры — пурпурный
  { id: "admin",    icon: "fa-screwdriver-wrench", color: "#d8eef5", labelKey: "AGENTOS.App.admin", gmOnly: true } // системный — стальной
];

export const THEMES = [
  { id: "red",       labelKey: "AGENTOS.Theme.red" },
  { id: "cyber2077", labelKey: "AGENTOS.Theme.cyber2077" },
  { id: "netgreen",  labelKey: "AGENTOS.Theme.netgreen" },
  { id: "arasaka",   labelKey: "AGENTOS.Theme.arasaka" },
  { id: "synthwave", labelKey: "AGENTOS.Theme.synthwave" },
  { id: "chrome",    labelKey: "AGENTOS.Theme.chrome" },
  { id: "militech",  labelKey: "AGENTOS.Theme.militech" },
  { id: "kitsch",    labelKey: "AGENTOS.Theme.kitsch" },
  { id: "nomad",     labelKey: "AGENTOS.Theme.nomad" },
  { id: "trauma",    labelKey: "AGENTOS.Theme.trauma" }
];

export const DEVICE_MODES = {
  phone:  { w: 390,  h: 700 },
  tablet: { w: 680,  h: 790 },
  pc:     { w: 1020, h: 640 }
};

export const DEFAULT_TRAUMA = [
  { id: "tt_silver", name: "Trauma Team Silver Package",               cost: 500,  tier: "silver" },
  { id: "tt_plat",   name: "Trauma Team Executive (Platinum) Package", cost: 1000, tier: "platinum" }
];

export const DEFAULT_LIFESTYLES = [
  { id: "ls_kibble",  name: "Kibble",         cost: 100 },
  { id: "ls_generic", name: "Generic Prepak", cost: 300 },
  { id: "ls_good",    name: "Good Prepak",    cost: 600 },
  { id: "ls_fresh",   name: "Fresh Food",     cost: 1500 }
];

export const DEFAULT_HOUSING = [
  { id: "h_wild",      name: "Living in the Wilderness",          rent: 0,     buy: 0 },
  { id: "h_street",    name: "Living on the Street",              rent: 0,     buy: 0 },
  { id: "h_vehicle",   name: "Living in a Vehicle",               rent: 0,     buy: 0 },
  { id: "h_cube",      name: "Cube Hotel",                        rent: 500,   buy: 0 },
  { id: "h_cargo",     name: "Cargo Container",                   rent: 1000,  buy: 15000 },
  { id: "h_studio",    name: "Studio Apartment",                  rent: 1500,  buy: 25000 },
  { id: "h_twobed",    name: "Two-Bedroom Apartment",             rent: 2500,  buy: 35000 },
  { id: "h_conapt",    name: "Corporate Conapt",                  rent: 0,     buy: 0 },
  { id: "h_upscale",   name: "Upscale Conapt",                    rent: 7500,  buy: 85000 },
  { id: "h_pent",      name: "Luxury Penthouse",                  rent: 15000, buy: 150000 },
  { id: "h_beaver",    name: "Corporate Beaverville House",       rent: 0,     buy: 200000 },
  { id: "h_mcmansion", name: "Corporate Beaverville McMansion",   rent: 0,     buy: 500000 }
];

/* Compendium pack -> store category. Extra packs configured by the GM are
 * appended with the "Extra" category unless their id matches a known suffix. */
export const PACK_CATEGORIES = {
  "cyberpunk-red-core.core_weapons":         "Weapons",
  "cyberpunk-red-core.core_weapons-branded": "Weapons",
  "cyberpunk-red-core.core_ammo":            "Ammo",
  "cyberpunk-red-core.core_armor":           "Armor",
  "cyberpunk-red-core.core_clothing":        "Clothing",
  "cyberpunk-red-core.core_gear":            "Gear",
  "cyberpunk-red-core.core_cyberware":       "Cyberware",
  "cyberpunk-red-core.core_drugs":           "Drugs",
  "cyberpunk-red-core.core_programs":        "Programs",
  "cyberpunk-red-core.core_vehicles":        "Vehicles",
  "cyberpunk-red-core.core_upgrades":        "Upgrades",
  "cyberpunk-red-core.black-chrome_weapons":   "Weapons",
  "cyberpunk-red-core.black-chrome_ammo":      "Ammo",
  "cyberpunk-red-core.black-chrome_armor":     "Armor",
  "cyberpunk-red-core.black-chrome_clothing":  "Clothing",
  "cyberpunk-red-core.black-chrome_gear":      "Gear",
  "cyberpunk-red-core.black-chrome_cyberware": "Cyberware",
  "cyberpunk-red-core.black-chrome_vehicles":  "Vehicles",
  "cyberpunk-red-core.black-chrome_upgrades":  "Upgrades"
};

export const STORE_CATEGORIES = [
  "Weapons", "Ammo", "Armor", "Clothing", "Gear",
  "Cyberware", "Drugs", "Programs", "Vehicles", "Upgrades", "Extra"
];

export function loc(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

export function uid(prefix) {
  return `${prefix}_${foundry.utils.randomID(12)}`;
}
