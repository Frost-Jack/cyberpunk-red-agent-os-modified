import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, joinRoom, leaveRoom, startRoom, roomInput, tickRoom, roomView, newStack, stackInput } from "../scripts/arcade-network-core.js";

function match(kind, seed = 12345) {
  const room = createRoom("room", kind, "a", 1000);
  joinRoom(room, "b", 1000);
  room.players.forEach(p => { p.ready = true; });
  assert.equal(startRoom(room, "a", seed, 1000), true);
  return room;
}
function move(room, id, action, now = 2000) {
  const seq = room.players.find(p => p.id === id).seq + 1;
  roomInput(room, id, room.round, [{ seq, move: action }], now);
}
test("room membership, capacities, ready gates, ownership and rematches", () => {
  assert.equal(createRoom("x", "invalid", "a", 0), null);
  const room = createRoom("x", "tetris", "a", 0);
  assert.equal(startRoom(room, "a", 1, 0), false);
  assert.equal(joinRoom(room, "b", 0), true);
  assert.equal(joinRoom(room, "b", 0), false);
  assert.equal(joinRoom(room, "c", 0), false);
  assert.equal(startRoom(room, "a", 1, 0), false);
  room.players.forEach(p => { p.ready = true; });
  assert.equal(startRoom(room, "b", 1, 1000), false);
  assert.equal(startRoom(room, "a", 1, 1000), true);
  assert.equal(joinRoom(room, "c", 0), false);
  assert.equal(leaveRoom(room, "stranger", 1000), false);
  assert.equal(leaveRoom(room, "a", 1001), true);
  assert.equal(room.winner, "b"); assert.equal(room.owner, "b");
  assert.equal(joinRoom(room, "c", 1002), true);
  room.players.forEach(p => { p.ready = true; });
  assert.equal(startRoom(room, "b", 4, 1003), true);
  assert.equal(room.round, 2);
});
test("Tetris bags and local prediction replay identically after batching, retries and a delayed snapshot", () => {
  const room = match("tetris"), predicted = newStack(12345);
  const actions = ["rotate", "left", "left", "down", "drop", "right", "rotate", "drop", "down"];
  const entries = actions.map((action, i) => { stackInput(predicted, action); return { seq: i + 1, move: action }; });
  assert.equal(roomInput(room, "outsider", 1, entries, 1000), false);
  assert.equal(roomInput(room, "a", 0, entries, 1000), false);
  roomInput(room, "a", 1, entries.slice(0, 4), 1500);
  const snapshot = roomView(room, "a");
  const replay = structuredClone(snapshot.game.boards.a);
  entries.slice(4).forEach(e => stackInput(replay, e.move));
  assert.deepEqual(replay, predicted);
  roomInput(room, "a", 1, entries, 1900);
  roomInput(room, "a", 1, entries, 2300);
  assert.deepEqual(room.game.boards.a, predicted);
  assert.deepEqual(room.game.boards.b, newStack(12345), "Each player has an independent board with the same piece seed");
  assert.equal(room.players[0].seq, 9);
  assert.doesNotThrow(() => roomInput(room, "a", 1, [null, {}, { seq: Infinity }], 2400));
});
test("Tetris clears lines, keeps rotation in bounds, awards first to 20 and handles top-out", () => {
  const edges = newStack(22);
  for (let i = 0; i < 20; i++) { stackInput(edges, "left"); stackInput(edges, "rotate"); }
  assert.ok(edges.piece.x >= 0 && edges.piece.x + edges.piece.cells[0].length <= 10);
  const room = match("tetris"), s = room.game.boards.a;
  s.board[17].fill(1); s.board[17][4] = 0;
  s.piece = { type: 0, cells: [[1]], x: 4, y: 16 }; s.lines = 19;
  move(room, "a", "drop");
  assert.equal(s.lines, 20); assert.equal(room.winner, "a");
  const another = match("tetris");
  another.game.boards.a.board[0].fill(1);
  another.game.boards.a.board[0][9] = 0;
  another.game.boards.a.piece = { type: 0, cells: [[1]], x: 0, y: 16 };
  move(another, "a", "drop");
  assert.equal(another.game.boards.a.lost, true); assert.equal(another.winner, "b");
});
test("fleet hides opposing ships, alternates turns, rejects duplicate/out-of-range shots and ends on sinking", () => {
  const room = match("fleet"), own = roomView(room, "a"), other = roomView(room, "b");
  assert.ok(own.game.boards.a.ships); assert.equal(own.game.boards.b.ships, undefined);
  assert.ok(other.game.boards.b.ships); assert.equal(other.game.boards.a.ships, undefined);
  assert.equal(new Set(room.game.boards.a.ships.flat()).size, 9);
  roomInput(room, "b", 1, [{ seq: 1, cell: 0 }], 2000);
  assert.equal(room.game.boards.a.shots.length, 0);
  roomInput(room, "a", 1, [{ seq: 1, cell: -1 }, { seq: 2, cell: 64 }, { seq: 3, cell: 0 }], 2100);
  assert.deepEqual(room.game.boards.b.shots, [0]); assert.equal(room.game.turn, "b");
  roomInput(room, "b", 1, [{ seq: 2, cell: 0 }], 2200);
  roomInput(room, "a", 1, [{ seq: 4, cell: 0 }], 2300);
  assert.equal(room.game.turn, "a", "Repeated shots do not consume a turn");
  const cells = room.game.boards.b.ships.flat();
  room.game.boards.b.shots = cells.slice(0, -1);
  roomInput(room, "a", 1, [{ seq: 5, cell: cells.at(-1) }], 2400);
  assert.equal(room.winner, "a");
});
test("Bomberman spawn paths, movement limits, fuse, blocking crates, chain reactions and ties", () => {
  const room = match("bomber"), g = room.game;
  assert.equal(g.grid[1][2], 0); assert.equal(g.grid[9][8], 0);
  move(room, "a", "left", 2000); assert.equal(g.bodies[0].x, 1);
  move(room, "a", "right", 2000); assert.equal(g.bodies[0].x, 2);
  move(room, "a", "right", 2050); assert.equal(g.bodies[0].x, 2);
  move(room, "a", "bomb", 2100); assert.equal(g.bombs[0].at, 4700);
  move(room, "a", "bomb", 2200); assert.equal(g.bombs.length, 1);
  tickRoom(room, 4699); assert.equal(g.bodies[0].alive, true);
  tickRoom(room, 4700); assert.equal(g.bodies[0].alive, false); assert.equal(room.winner, "b");
  const chain = match("bomber"), cg = chain.game;
  cg.grid[1][2] = 0; cg.grid[1][3] = 0; cg.grid[1][4] = 2; cg.grid[1][5] = 0;
  cg.bombs = [{ x: 1, y: 1, at: 2000 }, { x: 3, y: 1, at: 5000 }];
  cg.bodies[1].x = 3; cg.bodies[1].y = 1;
  tickRoom(chain, 2000);
  assert.equal(cg.bombs.length, 0); assert.equal(cg.grid[1][4], 0);
  assert.equal(cg.fire.some(f => f.x === 5 && f.y === 1), false, "Crate blocks the blast behind it");
  assert.equal(chain.phase, "finished"); assert.equal(chain.winner, null);
  const four = createRoom("four", "bomber", "a", 1000);
  for (const id of ["b", "c", "d"]) joinRoom(four, id, 1000);
  four.players.forEach(p => { p.ready = true; }); startRoom(four, "a", 3, 1000);
  leaveRoom(four, "b", 2000);
  assert.equal(four.phase, "playing", "A 4-player game continues when one participant leaves");
  assert.equal(four.game.bodies.find(p => p.id === "b").alive, false);
});
test("room referee enforces roles, deduplicates requests, syncs recipients and never writes settings", async () => {
  const { networkRequest, receivePacket, networkState } = await import("../scripts/arcade-network.js");
  const users = [{ id: "gm", name: "GM", active: true, isGM: true }, { id: "p", name: "P", active: true }, { id: "q", name: "Q", active: true }];
  const packets = [], notices = [];
  let id = 0, ticks;
  const nativeInterval = globalThis.setInterval, nativeClear = globalThis.clearInterval;
  globalThis.setInterval = fn => { ticks = fn; return 42; };
  globalThis.clearInterval = () => {};
  globalThis.game = { user: users[0], users: Object.assign(users, { get: key => users.find(u => u.id === key) }),
    settings: { get: () => ({}), set: () => assert.fail("Network games must not write world settings") },
    socket: { emit: (channel, data) => packets.push(structuredClone(data)) }, i18n: { localize: key => key } };
  globalThis.foundry = { utils: { randomID: () => String(++id) } };
  globalThis.Hooks = { callAll() {} };
  globalThis.ui = { notifications: { info: m => notices.push(m), warn: m => notices.push(m) } };
  try {
    networkRequest("create", { kind: "bomber" });
    const roomId = networkState().room.id;
    const request = { type: "request", op: "join", userId: "p", requestId: "join", roomId };
    receivePacket(request, "p"); receivePacket(request, "p");
    networkRequest("sync");
    assert.equal(networkState().room.players.length, 2);
    receivePacket({ ...request, userId: "q", requestId: "illegal", op: "start" }, "q");
    assert.equal(networkState().room.phase, "waiting");
    networkRequest("ready", { roomId });
    receivePacket({ ...request, op: "ready", requestId: "ready" }, "p");
    networkRequest("start", { roomId });
    assert.equal(networkState().room.phase, "playing");
    users[1].active = false; ticks();
    networkRequest("sync");
    assert.equal(networkState().room.phase, "playing"); assert.equal(networkState().room.paused, true);
    users[1].active = true; ticks(); networkRequest("sync");
    assert.equal(networkState().room.paused, false, "Reconnect resumes the same round");
    users[1].active = false; ticks();
    const realNow = Date.now;
    try { const later = realNow() + 31000; Date.now = () => later; ticks(); }
    finally { Date.now = realNow; }
    networkRequest("sync");
    assert.equal(networkState().room.phase, "finished"); assert.equal(networkState().room.winner, "gm");
    const gmState = structuredClone(networkState());
    receivePacket({ type: "state", targetUserId: "gm", hostId: "p", rooms: [], room: null }, "p");
    assert.deepEqual(networkState(), gmState, "Non-GM state is ignored");
    game.user = users[2]; networkRequest("sync");
    assert.equal(packets.at(-1).type, "request");
    game.user = users[0]; networkRequest("leave", { roomId }); ticks();
    assert.equal(networkState().room, null);
    const current = structuredClone(networkState());
    receivePacket({ type: "state", hostId: "gm", targetUserId: "gm", epoch: current.epoch,
      serial: current.serial - 1, room: { id: roomId }, rooms: [] }, "gm");
    assert.deepEqual(networkState(), current, "A late snapshot cannot resurrect a room after exit");
  } finally { globalThis.setInterval = nativeInterval; globalThis.clearInterval = nativeClear; }
});
