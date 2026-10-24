/* Ephemeral rooms, refereed by the primary GM. No world-setting writes. */
import { MODULE_ID, SOCKET_NAME } from "./constants.js";
import { primaryGM, isPrimaryGM, applyOp } from "./data.js";
import { createRoom, joinRoom, leaveRoom, startRoom, roomInput, tickRoom, roomView, setRoomPaused, NET_GAMES } from "./arcade-network-core.js";

const rooms = new Map(), seen = new Map();
let timer = null, lastPush = 0, epoch = null, serial = 0;
const dirty = new Set();
const client = { rooms: [], room: null, invites: [], hostId: null, received: 0, epoch: 0, serial: 0 };
export function networkState() { return client; }
function changed() { Hooks.callAll(`${MODULE_ID}.arcadeNet`); }
function ownRoom(userId) { return [...rooms.values()].find(r => r.players.some(p => p.id === userId)); }
function lobby() {
  return [...rooms.values()].map(r => ({ id: r.id, kind: r.kind, owner: r.owner, players: r.players.map(p => p.id), phase: r.phase }));
}
function send(userId, extra = {}) {
  const room = ownRoom(userId);
  const packet = { action: "arcadeNet", type: "state", hostId: game.user.id, targetUserId: userId,
    epoch: epoch ??= Date.now(), serial: ++serial,
    rooms: lobby(), room: room ? roomView(room, userId) : null, ...extra };
  if (userId === game.user.id) receivePacket(packet, game.user.id);
  else game.socket.emit(SOCKET_NAME, packet, { recipients: [userId] });
}
function publish(room) { room.players.forEach(p => send(p.id)); }
function publishLobby() { game.users.filter(u => u.active).forEach(u => send(u.id)); }
function allowed(user) {
  if (user.isGM) return true;
  const cfg = game.settings.get(MODULE_ID, "appConfig") || {};
  return !cfg.disabled?.[user.id] && (cfg.perPlayer?.[user.id]?.arcade ?? cfg.player?.arcade) !== false;
}
function hostTick() {
  if (!isPrimaryGM()) {
    clearInterval(timer); timer = null; rooms.clear(); dirty.clear(); seen.clear(); epoch = null; return;
  }
  const now = Date.now();
  let lobbyChanged = false;
  for (const room of rooms.values()) {
    for (const p of [...room.players]) {
      const user = game.users.get(p.id);
      if (!user?.active && !p.disconnectedAt) { p.disconnectedAt = now; dirty.add(room.id); }
      if (user?.active && p.disconnectedAt) { delete p.disconnectedAt; dirty.add(room.id); }
      if (!user || !allowed(user) || (p.disconnectedAt && now - p.disconnectedAt > 30000)) {
        leaveRoom(room, p.id, now); send(p.id); dirty.add(room.id); lobbyChanged = true;
      }
    }
    if (room.phase === "playing") {
      const paused = room.players.some(p => p.disconnectedAt) || room.players.every(p => room.pauseVotes?.includes(p.id));
      if (!!room.paused !== paused) { setRoomPaused(room, paused, now); dirty.add(room.id); }
    }
    if (!room.players.length || now - room.updated > 15 * 60000) {
      rooms.delete(room.id); room.players.forEach(p => send(p.id)); lobbyChanged = true;
    } else if (tickRoom(room, now)) { dirty.add(room.id); if (room.phase === "finished") lobbyChanged = true; }
  }
  for (const [id, at] of seen) if (now - at > 30000) seen.delete(id);
  if (lobbyChanged) publishLobby();
  if (now - lastPush >= 250) {
    for (const id of dirty) { const room = rooms.get(id); if (room) publish(room); }
    dirty.clear(); lastPush = now;
  }
  if (!rooms.size) { clearInterval(timer); timer = null; }
}
function ensureTimer() { if (!timer && rooms.size) timer = setInterval(hostTick, 100); }

function handleRequest(packet) {
  const user = game.users.get(packet.userId);
  if (!user?.active || !allowed(user)) return;
  const now = Date.now();
  if (!timer) for (const [id, at] of seen) if (now - at > 30000) seen.delete(id);
  if (typeof packet.requestId !== "string" || packet.requestId.length > 64) return;
  if (seen.has(packet.requestId)) return;
  seen.set(packet.requestId, now);
  const room = rooms.get(packet.roomId), member = room?.players.find(p => p.id === user.id);
  const reject = () => send(user.id, { error: "AGENTOS.Multiplayer.Unavailable" });
  switch (packet.op) {
    case "sync": send(user.id); return;
    case "create": {
      if (ownRoom(user.id) || rooms.size >= 16) { reject(); break; }
      const id = foundry.utils.randomID(12), fresh = createRoom(id, packet.kind, user.id, now);
      if (!fresh) { reject(); break; }
      rooms.set(id, fresh); ensureTimer(); publishLobby(); break;
    }
    case "join":
      if (ownRoom(user.id) || !room || !joinRoom(room, user.id, now)) { reject(); break; }
      publishLobby(); break;
    case "leave":
      if (!member) { reject(); break; }
      leaveRoom(room, user.id, now);
      if (!room.players.length) rooms.delete(room.id);
      send(user.id); publishLobby(); break;
    case "ready":
      if (!member || room.phase === "playing") { reject(); break; }
      member.ready = !member.ready; room.rev++; room.updated = now; publish(room); break;
    case "pause":
      if (!member || room.phase !== "playing" || typeof packet.paused !== "boolean") { reject(); break; }
      room.pauseVotes = (room.pauseVotes || []).filter(id => id !== user.id);
      if (packet.paused) room.pauseVotes.push(user.id);
      setRoomPaused(room, room.players.some(p => p.disconnectedAt) || room.players.every(p => room.pauseVotes.includes(p.id)), now);
      room.rev++; publish(room); break;
    case "start":
      if (!member || !startRoom(room, user.id, Math.floor(Math.random() * 4294967296), now)) { reject(); break; }
      publishLobby(); break;
    case "input":
      if (!member || !roomInput(room, user.id, packet.round, packet.entries, now)) break;
      if (room.phase === "finished") publishLobby();
      dirty.add(room.id); break;
    case "invite": {
      const target = game.users.get(packet.target);
      if (!member || room.phase === "playing" || !target?.active || !allowed(target) || target.id === user.id) { reject(); break; }
      send(target.id, { invite: { roomId: room.id, from: user.id, kind: room.kind } });
      void applyOp("arcade.inviteNotice", { target: target.id, from: user.id, roomId: room.id, title: NET_GAMES.find(g => g.id === room.kind)?.title || room.kind }, game.user.id);
      break;
    }
    default: break;
  }
}

export function receivePacket(packet, senderId) {
  if (packet.type === "request") {
    if (senderId !== packet.userId) return;
    if (isPrimaryGM()) handleRequest(packet);
    return;
  }
  if (packet.type !== "state" || packet.targetUserId !== game.user.id || packet.hostId !== senderId || senderId !== primaryGM()?.id) return;
  // This also prevents an in-flight game snapshot resurrecting a room after exit.
  if (!Number.isSafeInteger(packet.serial) || !Number.isSafeInteger(packet.epoch)) return;
  if (client.hostId === packet.hostId && (packet.epoch < client.epoch ||
    (packet.epoch === client.epoch && packet.serial <= client.serial))) return;
  client.rooms = Array.isArray(packet.rooms) ? packet.rooms : [];
  client.room = packet.room || null;
  client.hostId = packet.hostId; client.received = Date.now();
  client.epoch = packet.epoch; client.serial = packet.serial;
  if (packet.error) ui.notifications.warn(game.i18n.localize(packet.error));
  if (packet.invite) {
    client.invites = [...client.invites.filter(i => i.roomId !== packet.invite.roomId), packet.invite].slice(-8);
    ui.notifications.info(game.i18n.localize("AGENTOS.Multiplayer.Invited"));
  }
  client.invites = client.invites.filter(i => client.rooms.some(r => r.id === i.roomId && r.phase !== "playing"));
  changed();
}

export function networkRequest(op, payload = {}) {
  if (!primaryGM()) { ui.notifications.warn(game.i18n.localize("AGENTOS.Notify.NoGm")); return false; }
  const packet = { ...payload, action: "arcadeNet", type: "request", op, userId: game.user.id, requestId: foundry.utils.randomID(16) };
  if (isPrimaryGM()) receivePacket(packet, game.user.id);
  else game.socket.emit(SOCKET_NAME, packet, { recipients: [primaryGM().id] });
  return true;
}

export function roomSummary(room) {
  const def = NET_GAMES.find(g => g.id === room.kind);
  return { ...room, title: def?.title || room.kind, max: def?.max || 2,
    ownerName: game.users.get(room.owner)?.name || "?", count: room.players.length,
    joinable: room.phase !== "playing" && room.players.length < (def?.max || 2) };
}
