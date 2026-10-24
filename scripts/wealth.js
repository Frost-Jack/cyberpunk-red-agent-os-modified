import { MODULE_ID } from "./constants.js";

export const wealth = actor => Number(actor?.system?.wealth?.value ?? 0);
const records = actor => actor?.listRecords?.("wealth") ?? actor?.system?.wealth?.transactions ?? [];

export function transactions(actor) {
  const metadata = actor?.getFlag?.(MODULE_ID, "wealthMetadata") || [];
  const rows = records(actor);
  return rows.map((r, index) => {
    const text = Array.isArray(r) ? String(r[0] ?? "") : String(r ?? "");
    const reason = Array.isArray(r) ? String(r[1] ?? "") : "";
    // Match position AND exact tuple. Deletion/editing in the system ledger
    // invalidates the match instead of attributing another operation's amount.
    const m = metadata.find(m => m.index === index && m.text === text && m.reason === reason);
    return m ? { text, reason, kind: m.delta < 0 ? "minus" : "plus", amount: Math.abs(m.delta), total: m.total, ts: m.ts }
      : { text, reason, kind: "raw" };
  }).reverse();
}

export async function deltaWealth(actor, delta, reason) {
  return deltaLedger(actor, "wealth", delta, reason);
}

export async function deltaLedger(actor, property, delta, reason) {
  if (!Number.isFinite(delta) || typeof actor?.deltaLedgerProperty !== "function") throw new Error("Wealth ledger unavailable");
  let write;
  const system = foundry.utils.deepClone(actor.system?.toObject?.() || actor.system);
  const proxy = new Proxy(actor, {
    get(target, key) {
      if (key === "system") return system;
      if (key !== "update") return Reflect.get(target, key, target);
      return (changes, options) => {
        const rows = changes[`system.${property}.transactions`];
        const row = rows?.at(-1);
        const patch = { ...changes };
        if (row && property === "wealth") patch[`flags.${MODULE_ID}.wealthMetadata`] = [...(actor.getFlag?.(MODULE_ID, "wealthMetadata") || []), {
          index: rows.length - 1, text: String(row[0]), reason: String(row[1] ?? ""), delta,
          total: changes["system.wealth.value"], ts: Date.now()
        }].slice(-500);
        return write = target.update(patch, options);
      };
    }
  });
  const result = actor.deltaLedgerProperty.call(proxy, property, delta, reason);
  if (write) await write;
  else if (result?.then) await result;
  else throw new Error("Wealth write not acknowledged");
}

export function monthlyExpenses(userId, read) {
  const profile = (read("idProfiles") || {})[userId] || {};
  const housing = (read("housingOptions") || []).find(o => o.id === profile.housingId);
  const lifestyle = (read("lifestyleOptions") || []).find(o => o.id === profile.lifestyleId);
  const trauma = (read("traumaOptions") || []).find(o => o.id === profile.traumaId);
  const custom = profile.housingRent !== null && profile.housingRent !== undefined && profile.housingRent !== "";
  const number = v => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
  const parts = [
    { key: "housing", name: housing?.name || (custom ? game.i18n.localize("AGENTOS.Id.Housing") : ""), amount: custom ? number(profile.housingRent) : housing ? number(housing.rent) : null, custom },
    { key: "lifestyle", name: lifestyle?.name || "", amount: lifestyle ? number(lifestyle.cost) : null },
    { key: "trauma", name: trauma?.name || "", amount: trauma ? number(trauma.cost) : null }
  ];
  return { parts, total: parts.reduce((n, p) => n + (p.amount ?? 0), 0), incomplete: parts.some(p => p.amount === null) };
}
