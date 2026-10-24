/* Module socket router. */

import { MODULE_ID, SOCKET_NAME } from "./constants.js";
import { applyOp, isPrimaryGM, primaryGM, resolveMutation, getChat, getWorld } from "./data.js";
import { runCallEffectLocal, stopCallEffectLocal } from "./vfx.js";
import { receivePacket } from "./arcade-network.js";

export function initSocket() {
  // v12 handleCustomSocket appends this authenticated ID server-side.
  game.socket.on(SOCKET_NAME, async (data, senderId) => {
    if (!data?.action || !game.users.get(senderId)) return;
    switch (data.action) {
      case "arcadeNet":
        receivePacket(data, senderId);
        break;
      case "mutate": {
        // Only the primary GM applies relayed mutations (avoids double-writes).
        if (!isPrimaryGM()) break;
        if (senderId !== data.userId) break;
        const result = await applyOp(data.op, data.payload, senderId, data.requestId);
        if (data.requestId) {
          game.socket.emit(SOCKET_NAME, {
            action: "mutateResult",
            requestId: data.requestId,
            targetUserId: data.userId,
            hostId: game.user.id,
            result: result === null ? null : (typeof result === "string" || typeof result === "boolean") ? result : !!result
          }, { recipients: [senderId] });
        }
        break;
      }
      case "mutateResult":
        if (senderId === primaryGM()?.id && data.hostId === senderId && data.targetUserId === game.user.id) resolveMutation(data.requestId, data.result);
        break;
      case "notify":
        if (senderId !== primaryGM()?.id) break;
        // Toasts are derived from the GM's persisted event, not socket text.
        {
          const events = game.settings.get(MODULE_ID, "agentNotifications")?.[game.user.id] || [];
          const event = events.find(n => n.id === data.eventId);
          if (event) Hooks.callAll(`${MODULE_ID}.notify`, event);
        }
        break;
      case "typing":
      case "typingStop":
        if (getChat(data.chatId)?.participants.some(p => p.userId === senderId)) Hooks.callAll(`${MODULE_ID}.typing`, { ...data, userId: senderId });
        break;
      case "holophoneStart":
        if (canCall(data, senderId)) runCallEffectLocal(data.tokenId, data.sceneId);
        break;
      case "holophoneStop":
        if (canCall(data, senderId)) stopCallEffectLocal(data.tokenId);
        break;
      default:
        break;
    }
  });
}

function canCall(data, senderId) {
  const user = game.users.get(senderId), chat = getChat(data.chatId);
  if (!chat || (!user?.isGM && (!chat.participants.some(p => p.userId === senderId) || getWorld("appConfig")?.disabled?.[senderId]))) return false;
  const token = globalThis.canvas?.tokens?.get(data.tokenId);
  return !!token && chat.participants.some(p => p.actorUuid === token.actor?.uuid);
}

export function emitSocket(data) {
  game.socket.emit(SOCKET_NAME, data);
}
