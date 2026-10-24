/* Small deterministic rules shared by the GM referee and local Tetris input. */
export const NET_GAMES = [
  { id: "bomber", title: "NEON BOMBERS", icon: "fa-bomb", max: 4 },
  { id: "tetris", title: "STACK DUEL", icon: "fa-cubes-stacked", max: 2 },
  { id: "fleet", title: "GRID FLEET", icon: "fa-ship", max: 2 },
  { id: "connect4", title: "FOUR LINK", icon: "fa-grip", max: 2 },
  { id: "reversi", title: "REVERSI", icon: "fa-circle-half-stroke", max: 2 }
];
export const PLAYER_COLORS = ["#2ff5d0", "#ffb84d", "#74a5ff", "#f071ac"];
export const DIRECTIONS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const SHAPES = [
  [[1, 1, 1, 1]], [[1, 1], [1, 1]], [[0, 1, 0], [1, 1, 1]],
  [[0, 1, 1], [1, 1, 0]], [[1, 1, 0], [0, 1, 1]],
  [[1, 0, 0], [1, 1, 1]], [[0, 0, 1], [1, 1, 1]]
];
function random(state) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
export function newStack(seed) {
  const s = { seed: seed >>> 0, board: Array.from({ length: 18 }, () => Array(10).fill(0)), bag: [], lines: 0, lost: false };
  spawn(s);
  return s;
}
function spawn(s) {
  if (!s.bag.length) {
    s.bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 6; i > 0; i--) { const j = Math.floor(random(s) * (i + 1)); [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]]; }
  }
  const type = s.bag.pop();
  s.piece = { type, cells: SHAPES[type].map(row => [...row]), x: 3, y: 0 };
  if (!fits(s, s.piece)) s.lost = true;
}
function fits(s, p) {
  return p.cells.every((row, y) => row.every((v, x) => !v ||
    (p.x + x >= 0 && p.x + x < 10 && p.y + y >= 0 && p.y + y < 18 && !s.board[p.y + y][p.x + x])));
}
export function stackInput(s, move) {
  if (s.lost) return;
  const p = s.piece;
  if (move === "rotate") {
    const cells = p.cells[0].map((_, x) => p.cells.map(row => row[x]).reverse());
    for (const dx of [0, -1, 1, -2, 2]) {
      const next = { ...p, cells, x: p.x + dx };
      if (fits(s, next)) { s.piece = next; break; }
    }
  } else if (move === "left" || move === "right") {
    const next = { ...p, x: p.x + (move === "left" ? -1 : 1) };
    if (fits(s, next)) s.piece = next;
  } else if (move === "down" || move === "drop") {
    if (move === "drop") while (fits(s, { ...p, y: p.y + 1 })) p.y++;
    else if (fits(s, { ...p, y: p.y + 1 })) { p.y++; return; }
    p.cells.forEach((row, y) => row.forEach((v, x) => { if (v) s.board[p.y + y][p.x + x] = p.type + 1; }));
    const remaining = s.board.filter(row => row.some(v => !v));
    const cleared = 18 - remaining.length;
    s.lines += cleared;
    s.board = [...Array.from({ length: cleared }, () => Array(10).fill(0)), ...remaining];
    spawn(s);
  }
}

function newFleet(seed) {
  const rng = { seed }, ships = [];
  for (const length of [4, 3, 2]) {
    let cells;
    do {
      const vertical = random(rng) < 0.5;
      const x = Math.floor(random(rng) * (8 - (vertical ? 0 : length - 1)));
      const y = Math.floor(random(rng) * (8 - (vertical ? length - 1 : 0)));
      cells = Array.from({ length }, (_, i) => (y + (vertical ? i : 0)) * 8 + x + (vertical ? 0 : i));
    } while (ships.some(ship => ship.some(cell => cells.includes(cell))));
    ships.push(cells);
  }
  return { ships, shots: [] };
}

export function createRoom(id, kind, owner, now) {
  if (!NET_GAMES.some(g => g.id === kind)) return null;
  return { id, kind, owner, players: [{ id: owner, ready: false, seq: 0 }], phase: "waiting", round: 0, updated: now, rev: 1, winner: null };
}
export function joinRoom(room, userId, now) {
  if (room.phase === "playing" || room.players.some(p => p.id === userId) || room.players.length >= NET_GAMES.find(g => g.id === room.kind).max) return false;
  room.players.push({ id: userId, ready: false, seq: 0 });
  room.phase = "waiting";
  room.players.forEach(p => { p.ready = false; });
  room.updated = now; room.rev++;
  return true;
}
export function leaveRoom(room, userId, now) {
  if (!room.players.some(p => p.id === userId)) return false;
  if (room.phase === "playing") {
    if (room.kind === "bomber") {
      room.game.bodies.find(p => p.id === userId).alive = false;
      const alive = room.game.bodies.filter(p => p.alive);
      if (alive.length <= 1) finish(room, alive[0]?.id || null, "left");
    } else finish(room, room.players.find(p => p.id !== userId)?.id || null, "left");
  }
  room.players = room.players.filter(p => p.id !== userId);
  if (room.owner === userId) room.owner = room.players[0]?.id;
  room.players.forEach(p => { p.ready = false; });
  room.updated = now; room.rev++;
  return true;
}
export function startRoom(room, userId, seed, now) {
  if (room.owner !== userId || room.phase === "playing" || room.players.length < 2 || room.players.some(p => !p.ready)) return false;
  room.phase = "playing"; room.winner = null; room.reason = "";
  room.paused = false; room.pauseVotes = []; room.pauseAt = null;
  room.round++; room.updated = now; room.rev++;
  room.players.forEach(p => { p.seq = 0; p.ready = false; p.lastMove = 0; });
  if (room.kind === "tetris") room.game = { boards: Object.fromEntries(room.players.map(p => [p.id, newStack(seed)])), nextFall: now + 650 };
  if (room.kind === "connect4") room.game = { cells: Array(42).fill(0), turn: room.players[0].id };
  if (room.kind === "reversi") {
    const cells = Array(64).fill(0); cells[27] = cells[36] = 1; cells[28] = cells[35] = 2;
    room.game = { cells, turn: room.players[0].id };
  }
  if (room.kind === "fleet") room.game = { boards: Object.fromEntries(room.players.map((p, i) => [p.id, newFleet((seed + i * 7919) >>> 0)])), turn: room.players[0].id };
  if (room.kind === "bomber") {
    const rng = { seed }, starts = [[1, 1], [9, 9], [9, 1], [1, 9]];
    const grid = Array.from({ length: 11 }, (_, y) => Array.from({ length: 11 }, (_, x) => {
      if (!x || !y || x === 10 || y === 10 || (!(x % 2) && !(y % 2))) return 1;
      if (starts.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 2)) return 0;
      return random(rng) < 0.65 ? 2 : 0;
    }));
    room.game = { grid, bombs: [], fire: [], ends: now + 180000,
      bodies: room.players.map((p, i) => ({ id: p.id, x: starts[i][0], y: starts[i][1], alive: true })) };
  }
  return true;
}
function finish(room, winner, reason = "win") { room.phase = "finished"; room.winner = winner; room.reason = reason; }

function flips(cells, cell, color) {
  if (cells[cell] || cell < 0 || cell >= 64) return [];
  const result = [], x = cell % 8, y = Math.floor(cell / 8);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const line = []; let xx = x + dx, yy = y + dy;
    while (xx >= 0 && xx < 8 && yy >= 0 && yy < 8 && cells[yy * 8 + xx] === 3 - color) { line.push(yy * 8 + xx); xx += dx; yy += dy; }
    if (xx >= 0 && xx < 8 && yy >= 0 && yy < 8 && cells[yy * 8 + xx] === color) result.push(...line);
  }
  return result;
}
export function legalCells(room, userId = room.game?.turn) {
  if (room.kind !== "reversi" || !room.game) return [];
  const color = room.players.findIndex(p => p.id === userId) + 1;
  return room.game.cells.map((_, i) => i).filter(i => flips(room.game.cells, i, color).length);
}
export function setRoomPaused(room, paused, now) {
  if (!!room.paused === paused) return;
  if (paused) room.pauseAt = now;
  else {
    const delta = now - room.pauseAt;
    if (room.kind === "bomber") { room.game.ends += delta; room.game.bombs.forEach(b => b.at += delta); room.game.fire.forEach(f => f.until += delta); }
    if (room.kind === "tetris") room.game.nextFall += delta;
    room.pauseAt = null;
  }
  room.paused = paused; room.rev++;
}

export function roomInput(room, userId, round, entries, now) {
  const player = room.players.find(p => p.id === userId);
  if (!player || room.phase !== "playing" || room.paused || room.round !== round || !Array.isArray(entries)) return false;
  let changed = false;
  for (const entry of entries.slice(0, 32)) {
    if (!entry || typeof entry !== "object") continue;
    if (!Number.isSafeInteger(entry.seq) || entry.seq !== player.seq + 1) continue;
    player.seq = entry.seq; changed = true;
    const move = entry.move;
    if (["connect4", "reversi"].includes(room.kind) && room.game.turn === userId && Number.isInteger(entry.cell)) {
      const g = room.game, color = room.players.findIndex(p => p.id === userId) + 1;
      const enemy = room.players.find(p => p.id !== userId).id;
      if (room.kind === "connect4" && entry.cell >= 0 && entry.cell < 7) {
        let y = 5; while (y >= 0 && g.cells[y * 7 + entry.cell]) y--;
        if (y >= 0) {
          const x = entry.cell; g.cells[y * 7 + x] = color; g.turn = enemy;
          for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
            let count = 1;
            for (const direction of [-1, 1]) for (let n = 1; n < 4; n++) {
              const xx = x + dx * n * direction, yy = y + dy * n * direction;
              if (xx < 0 || xx >= 7 || yy < 0 || yy >= 6 || g.cells[yy * 7 + xx] !== color) break;
              count++;
            }
            if (count >= 4) finish(room, userId);
          }
          if (room.phase === "playing" && g.cells.every(Boolean)) finish(room, null);
        }
      }
      if (room.kind === "reversi" && entry.cell >= 0 && entry.cell < 64) {
        const captured = flips(g.cells, entry.cell, color);
        if (captured.length) {
          g.cells[entry.cell] = color; captured.forEach(i => { g.cells[i] = color; });
          g.turn = legalCells(room, enemy).length ? enemy : userId;
          if (!legalCells(room, g.turn).length) {
            const counts = [1, 2].map(c => g.cells.filter(v => v === c).length);
            finish(room, counts[0] === counts[1] ? null : room.players[counts[0] > counts[1] ? 0 : 1].id);
          }
        }
      }
    }
    if (room.kind === "tetris" && ["left", "right", "down", "rotate", "drop"].includes(move)) {
      stackInput(room.game.boards[userId], move);
      const own = room.game.boards[userId];
      if (own.lines >= 20) finish(room, userId);
      else if (own.lost) finish(room, room.players.find(p => p.id !== userId).id);
    }
    if (room.kind === "fleet" && room.game.turn === userId && Number.isInteger(entry.cell) && entry.cell >= 0 && entry.cell < 64) {
      const enemy = room.players.find(p => p.id !== userId).id;
      const board = room.game.boards[enemy];
      if (!board.shots.includes(entry.cell)) {
        board.shots.push(entry.cell);
        if (board.ships.flat().every(cell => board.shots.includes(cell))) finish(room, userId);
        else room.game.turn = enemy;
      }
    }
    if (room.kind === "bomber") {
      const g = room.game, body = g.bodies.find(p => p.id === userId);
      if (body.alive && move === "bomb" && g.bombs.filter(b => b.owner === userId).length < 2 && !g.bombs.some(b => b.x === body.x && b.y === body.y))
        g.bombs.push({ x: body.x, y: body.y, owner: userId, at: now + 2600 });
      if (body.alive && DIRECTIONS[move] && now - player.lastMove >= 160) {
        const [dx, dy] = DIRECTIONS[move], x = body.x + dx, y = body.y + dy;
        if (g.grid[y]?.[x] === 0 && !g.bombs.some(b => b.x === x && b.y === y) && !g.bodies.some(b => b.alive && b.id !== userId && b.x === x && b.y === y)) {
          body.x = x; body.y = y; player.lastMove = now;
        }
      }
    }
    if (room.phase !== "playing") break;
  }
  if (changed) { room.updated = now; room.rev++; }
  return changed;
}

export function tickRoom(room, now) {
  if (room.phase !== "playing" || room.paused) return false;
  if (room.kind === "tetris") {
    let changed = false;
    for (let n = 0; n < 8 && now >= room.game.nextFall && room.phase === "playing"; n++) {
      room.game.nextFall += 650; changed = true;
      for (const player of room.players) stackInput(room.game.boards[player.id], "down");
      const alive = room.players.filter(p => !room.game.boards[p.id].lost);
      if (alive.length < room.players.length) finish(room, alive.length === 1 ? alive[0].id : null);
    }
    if (changed) room.rev++;
    return changed;
  }
  if (room.kind !== "bomber") return false;
  const g = room.game;
  let changed = g.fire.some(f => f.until <= now);
  g.fire = g.fire.filter(f => f.until > now);
  // Chain reactions are resolved before damage, so one tick is one fair outcome.
  while (g.bombs.some(b => b.at <= now)) {
    const bomb = g.bombs.find(b => b.at <= now);
    g.bombs.splice(g.bombs.indexOf(bomb), 1); changed = true;
    const burn = (x, y) => {
      g.fire.push({ x, y, until: now + 650 });
      for (const b of g.bombs) if (b.x === x && b.y === y) b.at = now;
    };
    burn(bomb.x, bomb.y);
    for (const [dx, dy] of Object.values(DIRECTIONS)) {
      for (let d = 1; d <= 2; d++) {
        const x = bomb.x + dx * d, y = bomb.y + dy * d, cell = g.grid[y]?.[x];
        if (cell === undefined || cell === 1) break;
        burn(x, y);
        if (cell === 2) { g.grid[y][x] = 0; break; }
      }
    }
  }
  for (const b of g.bodies) if (b.alive && g.fire.some(f => f.x === b.x && f.y === b.y)) { b.alive = false; changed = true; }
  const alive = g.bodies.filter(b => b.alive);
  if (alive.length <= 1 || now >= g.ends) { finish(room, alive.length === 1 ? alive[0].id : null); changed = true; }
  if (changed) room.rev++;
  return changed;
}

/** Opponent fleet positions are never included in the recipient's game view. */
export function roomView(room, userId) {
  const view = structuredClone(room);
  if (room.kind === "fleet" && room.game) {
    for (const [id, board] of Object.entries(view.game.boards)) {
      board.hits = board.shots.filter(cell => board.ships.some(ship => ship.includes(cell)));
      if (id !== userId) delete board.ships;
    }
  }
  return view;
}
