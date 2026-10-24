import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
const CATEGORIES = ["message", "shard", "transfer", "purchase", "contactShared", "object", "invite", "monthly"];
export function history() {
  const read = game.user.getFlag(MODULE_ID, "notificationRead") || {};
  const cleared = Number(game.user.getFlag(MODULE_ID, "notificationCleared") || 0);
  return ((Data.getWorld("agentNotifications") || {})[game.user.id] || []).filter(n => n.ts > cleared).map(n => ({ ...n, read: !!read[n.id] }));
}
export function muted(data) {
  return !!game.user.getFlag(MODULE_ID, "notificationMuted")?.[data.kind] || !!(data.chatId && game.user.getFlag(MODULE_ID, "mutedChats")?.[data.chatId]);
}
export function getData() {
  return {
    notifications: history().reverse().map(n => ({ ...n, label: loc(`AGENTOS.Notifications.Category.${n.kind}`), title: n.senderName || n.title || n.name || n.period || n.fromName || n.actorName || "", body: n.kind === "monthly" ? loc("AGENTOS.Expenses.PaymentReminder", { amount: n.amount ?? n.total ?? 0 }) : n.preview || (n.amount ?? n.total ?? "") })),
    categories: CATEGORIES.map(id => ({ id, label: loc(`AGENTOS.Notifications.Category.${id}`), muted: !!game.user.getFlag(MODULE_ID, "notificationMuted")?.[id] }))
  };
}
export function activateListeners(app, html) {
  html.on("click", "[data-action='notification-open']", async ev => {
    const n = history().find(n => n.id === ev.currentTarget.dataset.id);
    if (!n || app.isDisabled) return;
    await game.user.setFlag(MODULE_ID, `notificationRead.${n.id}`, true);
    if (n.chatId) app.openChatThread(n.chatId);
    else if (n.shardId) { app.openApp("datapool"); app.state.shardId = n.shardId; }
    else if (n.contactId) { app.openApp("contacts"); app.state.focusContactId = n.contactId; }
    else if (n.kind === "invite") { app.openApp("arcade"); app.state.arcadeTab = "network"; }
    else { app.openApp("wallet"); if (n.kind === "monthly") app.state.openExpenses = true; }
    app.render(false);
  });
  html.on("click", "[data-action='notification-read']", async () => {
    await game.user.setFlag(MODULE_ID, "notificationRead", Object.fromEntries(history().map(n => [n.id, true]))); app.render(false);
  });
  html.on("click", "[data-action='notification-clear']", async () => {
    await game.user.setFlag(MODULE_ID, "notificationCleared", Date.now());
    await game.user.setFlag(MODULE_ID, "notificationRead", {}); app.render(false);
  });
  html.on("change", "[data-action='notification-mute']", async ev => {
    await game.user.setFlag(MODULE_ID, `notificationMuted.${ev.currentTarget.dataset.category}`, ev.currentTarget.checked);
  });
}
