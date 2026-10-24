import { MODULE_ID, loc } from "../constants.js";
import { NET_GAMES, PLAYER_COLORS, DIRECTIONS, stackInput, legalCells } from "../arcade-network-core.js";
import { networkState, networkRequest, roomSummary } from "../arcade-network.js";
import { primaryGM } from "../data.js";
import { pointerFraction } from "./map.js";

let mounted = null;
let subscribed = false;
let stackTimer = null;
let local = { key: "", pending: [], seq: 0, ack: -1, stack: null };
const keyFor = r => r ? `${r.id}:${r.round}` : "";
function layoutKey() {
  const { room, rooms, invites } = networkState();
  return JSON.stringify(room ? [room.id, room.round, room.phase, room.paused, room.pauseVotes, room.players.map(p => [p.id, p.ready, !!p.disconnectedAt])]
    : [rooms, invites]);
}
function updatePrediction() {
  const r = networkState().room;
  if (local.key !== keyFor(r)) local = { key: keyFor(r), pending: [], seq: 0, ack: -1, stack: null };
  const ack = r?.players.find(p => p.id === game.user.id)?.seq ?? 0;
  if (ack !== local.ack || local.rev !== r?.rev) {
    local.rev = r?.rev;
    local.ack = ack;
    local.seq = Math.max(local.seq, ack);
    local.pending = local.pending.filter(e => e.seq > ack);
    if (r?.kind === "tetris" && r.game) {
      local.stack = structuredClone(r.game.boards[game.user.id]);
      local.pending.forEach(e => stackInput(local.stack, e.move));
    }
  }
}
function flush() {
  const r = networkState().room;
  if (r?.phase === "playing" && local.pending.length && primaryGM())
    networkRequest("input", { roomId: r.id, round: r.round, entries: local.pending.slice(0, 32) });
}
function input(move, cell) {
  const r = networkState().room;
  if (r?.phase !== "playing" || r.paused || !primaryGM() || Date.now() - networkState().received > 10000 || local.pending.length >= 64) return;
  updatePrediction();
  if (["fleet", "connect4", "reversi"].includes(r.kind) && (r.game.turn !== game.user.id || local.pending.length)) return;
  const entry = { seq: ++local.seq, move, ...(cell === undefined ? {} : { cell }) };
  local.pending.push(entry);
  if (r.kind === "tetris" && local.stack) stackInput(local.stack, move);
  // Bombs, shots and movement go immediately; Tetris actions can be batched.
  if (r.kind !== "tetris") flush();
  draw();
}
// Closing the cabinet must not pause one participant's Tetris gravity.
function syncStackTimer() {
  const r = networkState().room;
  if (r?.kind !== "tetris" || r.phase !== "playing") {
    clearInterval(stackTimer); stackTimer = null; return;
  }
  if (stackTimer) return;
  let lastSend = 0, lastSync = performance.now();
  stackTimer = setInterval(() => {
    const room = networkState().room;
    if (room?.kind !== "tetris" || room.phase !== "playing") { syncStackTimer(); return; }
    if (!primaryGM()) return;
    const now = performance.now();
    if (now - lastSend >= 250) { lastSend = now; flush(); }
    if (now - lastSync >= 5000) { lastSync = now; networkRequest("sync"); }
  }, 80);
}
function subscribe() {
  if (subscribed) return;
  subscribed = true;
  Hooks.on(`${MODULE_ID}.arcadeNet`, () => {
    updatePrediction();
    syncStackTimer();
    if (!mounted) return;
    if (mounted.key !== layoutKey()) mounted.app.render(false);
    else draw();
  });
}

export function getData() {
  const state = networkState(), room = state.room;
  const players = room?.players.map((p, i) => ({ ...p, name: game.users.get(p.id)?.name || "?", color: PLAYER_COLORS[i], mine: p.id === game.user.id })) || [];
  return {
    onlineGM: !!primaryGM(), games: NET_GAMES,
    rooms: state.rooms.map(roomSummary),
    invites: state.invites.map(i => ({ ...i, name: game.users.get(i.from)?.name || "?", title: NET_GAMES.find(g => g.id === i.kind)?.title })),
    room: room && { ...roomSummary(room), players, waiting: room.phase !== "playing", finished: room.phase === "finished",
      turnBased: ["fleet", "connect4", "reversi"].includes(room.kind),
      pauseRequested: room.pauseVotes?.includes(game.user.id),
      ownerIsMe: room.owner === game.user.id,
      canStart: room.owner === game.user.id && room.phase !== "playing" && players.length >= 2 && players.every(p => p.ready),
      mineReady: players.find(p => p.mine)?.ready,
      result: room.phase === "finished" ? (room.winner ? `${loc("AGENTOS.Multiplayer.Winner")}: ${game.users.get(room.winner)?.name || "?"}` : loc("AGENTOS.Multiplayer.Draw")) : ""
    },
    inviteUsers: game.users.filter(u => u.active && u.id !== game.user.id && !players.some(p => p.id === u.id)).map(u => ({ id: u.id, name: u.name }))
  };
}

export function onClose() {
  if (!mounted) return;
  const previous = mounted;
  mounted = null;
  flush();
  clearInterval(previous.timer);
  document.removeEventListener("keydown", previous.keydown);
  window.removeEventListener("blur", previous.blur);
}

export function activateListeners(app, html) {
  subscribe();
  onClose();
  updatePrediction();
  syncStackTimer();
  html.on("click", "[data-action='net-create']", ev => networkRequest("create", { kind: ev.currentTarget.dataset.kind }));
  html.on("click", "[data-action='net-join']", ev => networkRequest("join", { roomId: ev.currentTarget.dataset.roomId }));
  html.on("click", "[data-action='net-leave']", () => networkRequest("leave", { roomId: networkState().room?.id }));
  html.on("click", "[data-action='net-ready']", () => networkRequest("ready", { roomId: networkState().room?.id }));
  html.on("click", "[data-action='net-start']", () => networkRequest("start", { roomId: networkState().room?.id }));
  html.on("click", "[data-action='net-refresh']", () => networkRequest("sync"));
  html.on("click", "[data-action='net-pause']", () => {
    const room = networkState().room;
    networkRequest("pause", { roomId: room?.id, paused: !room?.pauseVotes?.includes(game.user.id) });
  });
  html.on("click", "[data-action='net-invite']", () => {
    const target = html.find("[name='net-invite-user']").val();
    if (target) networkRequest("invite", { roomId: networkState().room?.id, target });
  });
  const held = new Map();
  const actionKey = key => ({ ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right", ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", " ": "action", x: "drop" })[key];
  const move = key => {
    const r = networkState().room;
    if (!r) return;
    if (r.kind === "tetris") input(key === "up" || key === "action" ? "rotate" : key);
    if (r.kind === "bomber" && (key === "action" || DIRECTIONS[key])) {
      const now = performance.now();
      if (DIRECTIONS[key] && now - (local.lastMove || 0) < 170) return;
      local.lastMove = now;
      input(key === "action" ? "bomb" : key);
    }
  };
  const keydown = ev => {
    if (ev.target?.isContentEditable || ev.target?.closest?.("input,textarea,select")) return;
    const action = actionKey(ev.key.length === 1 ? ev.key.toLowerCase() : ev.key)
      || actionKey(({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", KeyX: "x" })[ev.code]);
    if (!action || networkState().room?.phase !== "playing" || ["fleet", "connect4", "reversi"].includes(networkState().room.kind)) return;
    ev.preventDefault(); move(action);
  };
  document.addEventListener("keydown", keydown);
  const blur = () => held.clear();
  window.addEventListener("blur", blur);
  for (const button of html.find("[data-net-move]")) {
    button.addEventListener("pointerdown", ev => {
      ev.preventDefault(); button.setPointerCapture(ev.pointerId);
      const action = button.dataset.netMove;
      move(action);
      if (DIRECTIONS[action]) held.set(action, performance.now());
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(event, () => held.delete(button.dataset.netMove));
  }
  const canvas = html.find(".agentos-net-canvas")[0];
  canvas?.addEventListener("pointerdown", ev => {
    const kind = networkState().room?.kind;
    if (["connect4", "reversi"].includes(kind)) {
      const { fx, fy } = pointerFraction(ev, canvas);
      const width = kind === "connect4" ? 7 : 8, height = kind === "connect4" ? 6 : 8;
      const x = Math.floor((fx * canvas.width - 5) / (320 / width)), y = Math.floor((fy * canvas.height - 30) / (280 / height));
      if (x >= 0 && x < width && y >= 0 && y < height) input("place", kind === "connect4" ? x : y * 8 + x);
      return;
    }
    if (kind !== "fleet") return;
    const { fx, fy } = pointerFraction(ev, canvas), x = fx * canvas.width - 178, y = fy * canvas.height - 55;
    if (x >= 0 && x < 144 && y >= 0 && y < 144) input("shot", Math.floor(y / 18) * 8 + Math.floor(x / 18));
  });
  let lastSend = 0, lastSync = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    held.forEach((at, action) => { if (now - at >= 180) { held.set(action, now); move(action); } });
    const r = networkState().room;
    if (r?.kind !== "tetris" || r.phase !== "playing") {
      if (now - lastSend >= 250) { lastSend = now; flush(); }
      if (now - lastSync >= 5000) { lastSync = now; networkRequest("sync"); }
    }
    draw();
  }, 80);
  mounted = { app, html, canvas, timer, keydown, blur, key: layoutKey() };
  draw();
  // Avoid synchronous state replies recursively rendering while listeners bind.
  queueMicrotask(() => { if (mounted?.app === app) networkRequest("sync"); });
}

function draw() {
  if (!mounted) return;
  const r = networkState().room, canvas = mounted.canvas;
  const status = mounted.html.find(".agentos-net-status")[0];
  if (status) {
    const stale = Date.now() - networkState().received > 10000;
    status.textContent = !primaryGM() || stale ? loc("AGENTOS.Multiplayer.LinkLost")
      : r?.paused ? loc("AGENTOS.Multiplayer.Paused")
      : local.pending.length >= 32 || (local.pending.length && ["fleet", "connect4", "reversi"].includes(r?.kind)) ? loc("AGENTOS.Multiplayer.WaitingLink")
        : ["fleet", "connect4", "reversi"].includes(r?.kind) && r.phase === "playing" ? `${loc("AGENTOS.Multiplayer.Turn")}: ${game.users.get(r.game.turn)?.name || "?"}`
          : r?.kind === "tetris" && r.phase === "playing" ? `${loc("AGENTOS.Multiplayer.Lines")}: ${local.stack?.lines || 0}/20` : "";
  }
  if (!canvas || !r?.game) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#090f18"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "12px monospace"; ctx.textAlign = "center";
  if (["connect4", "reversi"].includes(r.kind)) {
    const width = r.kind === "connect4" ? 7 : 8, height = r.kind === "connect4" ? 6 : 8;
    const legal = r.kind === "reversi" ? legalCells(r) : [];
    r.game.cells.forEach((value, i) => {
      const x = 5 + (i % width) * 320 / width, y = 30 + Math.floor(i / width) * 280 / height;
      ctx.fillStyle = "#152233"; ctx.fillRect(x + 1, y + 1, 320 / width - 2, 280 / height - 2);
      if (value || legal.includes(i)) {
        ctx.fillStyle = value ? PLAYER_COLORS[value - 1] : "#4b5a6a";
        ctx.beginPath(); ctx.arc(x + 160 / width, y + 140 / height, value ? 12 : 4, 0, Math.PI * 2); ctx.fill();
      }
    });
  }
  if (r.kind === "bomber") {
    r.game.grid.forEach((row, y) => row.forEach((cell, x) => {
      ctx.fillStyle = cell === 1 ? "#344153" : cell === 2 ? "#80542f" : "#111e2b";
      ctx.fillRect(x * 30 + 1, y * 30 + 1, 28, 28);
      if (cell === 2) { ctx.strokeStyle = "#c88c43"; ctx.strokeRect(x * 30 + 5, y * 30 + 5, 20, 20); }
    }));
    for (const f of r.game.fire) { ctx.fillStyle = "#ffb84d"; ctx.fillRect(f.x * 30 + 2, f.y * 30 + 2, 26, 26); }
    for (const b of r.game.bombs) { ctx.fillStyle = "#ff4a65"; ctx.beginPath(); ctx.arc(b.x * 30 + 15, b.y * 30 + 15, 9, 0, Math.PI * 2); ctx.fill(); }
    r.game.bodies.forEach((b, i) => {
      if (!b.alive) return;
      ctx.fillStyle = PLAYER_COLORS[i]; ctx.fillRect(b.x * 30 + 6, b.y * 30 + 5, 18, 21);
      ctx.fillStyle = "#09101a"; ctx.fillRect(b.x * 30 + 8, b.y * 30 + 10, 14, 4);
      if (b.id === game.user.id) { ctx.strokeStyle = "#fff"; ctx.strokeRect(b.x * 30 + 3, b.y * 30 + 3, 24, 24); }
    });
  }
  if (r.kind === "tetris") {
    const opponent = r.players.find(p => p.id !== game.user.id)?.id;
    const paint = (s, ox, size) => {
      if (!s) return;
      const cell = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(ox + x * size + 1, 27 + y * size + 1, size - 2, size - 2); };
      s.board.forEach((row, y) => row.forEach((v, x) => cell(x, y, v ? [...PLAYER_COLORS, "#bb8cff", "#ee6268", "#91ca64"][v - 1] : "#152233")));
      if (!s.lost) s.piece.cells.forEach((row, y) => row.forEach((v, x) => { if (v) cell(s.piece.x + x, s.piece.y + y, "#dce8f4"); }));
    };
    paint(local.stack || r.game.boards[game.user.id], 8, 16);
    paint(r.game.boards[opponent], 202, 11);
    ctx.fillStyle = "#dce8f4"; ctx.fillText(loc("AGENTOS.Multiplayer.You"), 88, 17);
    ctx.fillText(loc("AGENTOS.Multiplayer.Rival"), 257, 17);
    ctx.fillText(`${r.game.boards[opponent]?.lines || 0}/20`, 257, 245);
  }
  if (r.kind === "fleet") {
    const enemy = r.players.find(p => p.id !== game.user.id)?.id;
    const paint = (board, ox) => {
      if (!board) return;
      for (let c = 0; c < 64; c++) {
        const hit = board.hits.includes(c), shot = board.shots.includes(c), ship = board.ships?.some(s => s.includes(c));
        ctx.fillStyle = hit ? "#ff5a76" : shot ? "#566879" : ship ? "#2d9e93" : "#182d42";
        const x = ox + (c % 8) * 18, y = 55 + Math.floor(c / 8) * 18;
        ctx.fillRect(x + 1, y + 1, 16, 16);
        if (shot) { ctx.fillStyle = "#fff"; ctx.fillRect(x + 7, y + 7, 4, 4); }
      }
    };
    paint(r.game.boards[game.user.id], 8); paint(r.game.boards[enemy], 178);
    ctx.fillStyle = "#dce8f4"; ctx.fillText(loc("AGENTOS.Multiplayer.You"), 80, 37); ctx.fillText(loc("AGENTOS.Multiplayer.Rival"), 250, 37);
    ctx.fillText(loc("AGENTOS.Multiplayer.FleetHint"), 165, 235);
  }
}
