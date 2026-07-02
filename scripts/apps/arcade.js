/* Arcade: eight mini-games. Game state lives at module level (or app.state)
 * so incidental re-renders never reset a session; per-user records persist
 * in the `arcadeScores` user flag and are shown on the menu cards. */

import { MODULE_ID } from "../constants.js";
import { AgentAudio } from "../audio.js";

const GAMES = [
  { id: "mine",      title: "MINEFIELD", icon: "fa-bomb",                     lower: true, suffix: "s" },
  { id: "snake",     title: "NETSNAKE",  icon: "fa-staff-snake" },
  { id: "runner",    title: "HOVER RUN", icon: "fa-car-side" },
  { id: "netduel",   title: "NET DUEL",  icon: "fa-table-tennis-paddle-ball" },
  { id: "quickhack", title: "QUICKHACK", icon: "fa-bolt" },
  { id: "simon",     title: "SIMON.EXE", icon: "fa-circle-nodes" },
  { id: "g2077",     title: "2077",      icon: "fa-table-cells" },
  { id: "breach",    title: "BREACH",    icon: "fa-terminal" }
];

/* ---------------- records ---------------- */

function records() {
  return game.user.getFlag(MODULE_ID, "arcadeScores") || {};
}

function recordLabel(gameId) {
  const def = GAMES.find(g => g.id === gameId);
  const v = records()[gameId];
  if (v === undefined) return "—";
  return `${v}${def?.suffix || ""}`;
}

/** Persist a new record if it beats the stored one. Returns true if it did. */
async function saveRecord(gameId, value, lowerIsBetter = false) {
  if (!(value > 0)) return false;
  const rec = foundry.utils.deepClone(records());
  const cur = rec[gameId];
  const better = cur === undefined || (lowerIsBetter ? value < cur : value > cur);
  if (!better) return false;
  rec[gameId] = value;
  await game.user.setFlag(MODULE_ID, "arcadeScores", rec);
  return true;
}

/** Game-over helper: writes the record, updates status + REC display. */
function finishGame(html, gameId, statusEl, score) {
  const over = game.i18n.localize("AGENTOS.Arcade.GameOver");
  saveRecord(gameId, score).then((isNew) => {
    if (statusEl) {
      statusEl.textContent = `${over} — ${score}` + (isNew ? ` · ${game.i18n.localize("AGENTOS.Arcade.NewRecord")}` : "");
    }
    const recEl = html.find(".agentos-arcade-rec")[0];
    if (recEl) recEl.textContent = `REC ${recordLabel(gameId)}`;
  });
  AgentAudio.play("error");
}

/* ---------------- lifecycle ---------------- */

let _intervals = [];
let _domHandlers = [];   // [target, type, fn]
let _timeouts = [];

let _snakeState = null;
let _runnerState = null;
let _duelState = null;
let _qhState = null;
let _simonState = null;
let _g2077State = null;
let _breachState = null;

let _rafCancels = [];

function addInterval(fn, ms) { const id = setInterval(fn, ms); _intervals.push(id); return id; }
function addTimeout(fn, ms) { const id = setTimeout(fn, ms); _timeouts.push(id); return id; }
function addDocHandler(type, fn) { document.addEventListener(type, fn); _domHandlers.push([document, type, fn]); }

/** Smooth per-frame loop (no interval stutter); cancelled by teardownGames. */
function addRaf(fn) {
  const state = { stop: false, id: 0 };
  const loop = (t) => {
    if (state.stop) return;
    fn(t);
    state.id = requestAnimationFrame(loop);
  };
  state.id = requestAnimationFrame(loop);
  _rafCancels.push(() => { state.stop = true; cancelAnimationFrame(state.id); });
}

function teardownGames() {
  for (const id of _intervals) clearInterval(id);
  for (const id of _timeouts) clearTimeout(id);
  for (const [t, type, fn] of _domHandlers) t.removeEventListener(type, fn);
  for (const cancel of _rafCancels) cancel();
  _intervals = [];
  _timeouts = [];
  _domHandlers = [];
  _rafCancels = [];
}

function clearStates(st) {
  _snakeState = _runnerState = _duelState = _qhState = _simonState = _g2077State = _breachState = null;
  st.mine = null;
}

function isTypingTarget(t) {
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export async function getData(app) {
  const rec = records();
  const gameId = app.state.game || "";
  const def = GAMES.find(g => g.id === gameId);
  return {
    game: gameId,
    gameTitle: def?.title || "",
    record: gameId ? recordLabel(gameId) : "",
    games: GAMES.map(g => ({
      id: g.id,
      title: g.title,
      icon: g.icon,
      rec: rec[g.id] !== undefined ? `${rec[g.id]}${g.suffix || ""}` : "—"
    }))
  };
}

export function onClose() {
  teardownGames();
}

export function activateListeners(app, html) {
  const st = app.state;

  teardownGames(); // stale listeners from the previous render

  html.on("click", "[data-action='arcade-pick']", (ev) => {
    teardownGames();
    clearStates(st);
    st.game = ev.currentTarget.dataset.game;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='arcade-exit']", () => {
    teardownGames();
    clearStates(st);
    st.game = "";
    app.render(false);
  });

  switch (st.game) {
    case "mine": setupMinesweeper(app, html); break;
    case "snake": setupSnake(html); break;
    case "runner": setupRunner(html); break;
    case "netduel": setupNetDuel(html); break;
    case "quickhack": setupQuickhack(html); break;
    case "simon": setupSimon(html); break;
    case "g2077": setup2077(html); break;
    case "breach": setupBreach(html); break;
  }
}

/* ------------------------------------------------------------------ */
/* Minesweeper 9x9, 10 mines — record: fastest clear (seconds)          */
/* ------------------------------------------------------------------ */

function setupMinesweeper(app, html) {
  const root = html.find(".agentos-mine-board")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!root) return;
  const SIZE = 9, MINES = 10;
  const st = app.state;

  const fresh = () => ({
    grid: Array.from({ length: SIZE }, () => Array(SIZE).fill(0)),
    revealed: Array.from({ length: SIZE }, () => Array(SIZE).fill(false)),
    flagged: Array.from({ length: SIZE }, () => Array(SIZE).fill(false)),
    over: false,
    firstClick: true,
    startTs: 0,
    statusText: ""
  });
  if (!st.mine) st.mine = fresh();
  let g = st.mine;

  const placeMines = (sx, sy) => {
    let placed = 0;
    while (placed < MINES) {
      const x = Math.floor(Math.random() * SIZE);
      const y = Math.floor(Math.random() * SIZE);
      if (g.grid[y][x] === -1) continue;
      if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) continue;
      g.grid[y][x] = -1;
      placed++;
    }
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (g.grid[y][x] === -1) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE && g.grid[ny][nx] === -1) n++;
      }
      g.grid[y][x] = n;
    }
  };

  const reveal = (x, y) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || g.revealed[y][x] || g.flagged[y][x]) return;
    g.revealed[y][x] = true;
    if (g.grid[y][x] === 0) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reveal(x + dx, y + dy);
    }
  };

  const checkWin = () => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if (g.grid[y][x] !== -1 && !g.revealed[y][x]) return false;
    }
    return true;
  };

  const draw = () => {
    if (status) status.textContent = g.statusText;
    root.innerHTML = "";
    root.style.setProperty("--mine-size", SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "agentos-mine-cell";
      if (g.revealed[y][x]) {
        cell.classList.add("open");
        if (g.grid[y][x] === -1) { cell.classList.add("boom"); cell.textContent = "✸"; }
        else if (g.grid[y][x] > 0) { cell.textContent = g.grid[y][x]; cell.dataset.n = g.grid[y][x]; }
      } else if (g.flagged[y][x]) {
        cell.classList.add("flag");
        cell.textContent = "⚑";
      }
      cell.addEventListener("click", () => {
        if (g.over || g.flagged[y][x]) return;
        if (g.firstClick) { placeMines(x, y); g.firstClick = false; g.startTs = Date.now(); }
        if (g.grid[y][x] === -1) {
          g.revealed[y][x] = true;
          g.over = true;
          for (let yy = 0; yy < SIZE; yy++) for (let xx = 0; xx < SIZE; xx++) {
            if (g.grid[yy][xx] === -1) g.revealed[yy][xx] = true;
          }
          g.statusText = game.i18n.localize("AGENTOS.Arcade.Boom");
          AgentAudio.play("error");
        } else {
          reveal(x, y);
          if (checkWin()) {
            g.over = true;
            const secs = Math.max(1, Math.round((Date.now() - g.startTs) / 1000));
            g.statusText = `${game.i18n.localize("AGENTOS.Arcade.Win")} — ${secs}s`;
            saveRecord("mine", secs, true).then((isNew) => {
              if (isNew) {
                g.statusText += ` · ${game.i18n.localize("AGENTOS.Arcade.NewRecord")}`;
                if (status) status.textContent = g.statusText;
                const recEl = html.find(".agentos-arcade-rec")[0];
                if (recEl) recEl.textContent = `REC ${recordLabel("mine")}`;
              }
            });
            AgentAudio.play("cash");
          } else {
            AgentAudio.play("tap");
          }
        }
        draw();
      });
      cell.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        if (g.over || g.revealed[y][x]) return;
        g.flagged[y][x] = !g.flagged[y][x];
        draw();
      });
      root.appendChild(cell);
    }
  };

  html.find("[data-action='game-reset']").on("click", () => {
    st.mine = fresh();
    g = st.mine;
    draw();
  });
  draw();
}

/* ------------------------------------------------------------------ */
/* Snake — record: max score                                            */
/* ------------------------------------------------------------------ */

function setupSnake(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const CELLS = 20;
  const px = canvas.width / CELLS;

  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cFood = colors.getPropertyValue("--neon-warn").trim() || "#f33";

  const spawnFood = (s) => {
    let food;
    do {
      food = { x: Math.floor(Math.random() * CELLS), y: Math.floor(Math.random() * CELLS) };
    } while (s.snake.some(p => p.x === food.x && p.y === food.y));
    s.food = food;
  };

  const reset = () => {
    const s = {
      snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
      dir: { x: 1, y: 0 },
      nextDir: { x: 1, y: 0 },
      score: 0,
      dead: false
    };
    spawnFood(s);
    _snakeState = s;
    if (status) status.textContent = "0";
  };

  const drawFrame = (s) => {
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // lethal border walls
    ctx.strokeStyle = cFood;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.fillStyle = cFood;
    ctx.fillRect(s.food.x * px + 1, s.food.y * px + 1, px - 2, px - 2);
    ctx.fillStyle = cAccent;
    for (const p of s.snake) ctx.fillRect(p.x * px + 1, p.y * px + 1, px - 2, px - 2);
  };

  const tick = () => {
    const s = _snakeState;
    if (!s || s.dead) return;
    s.dir = s.nextDir;
    const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };
    // walls are lethal — no wrap-around
    if (head.x < 0 || head.x >= CELLS || head.y < 0 || head.y >= CELLS ||
        s.snake.some(p => p.x === head.x && p.y === head.y)) {
      s.dead = true;
      finishGame(html, "snake", status, s.score);
      return;
    }
    s.snake.unshift(head);
    if (head.x === s.food.x && head.y === s.food.y) {
      s.score++;
      if (status) status.textContent = String(s.score);
      AgentAudio.play("tap");
      spawnFood(s);
    } else {
      s.snake.pop();
    }
    drawFrame(s);
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    const map = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 }
    };
    const nd = map[ev.key];
    if (!nd) return;
    ev.preventDefault();
    const cur = _snakeState;
    if (!cur || cur.dead) { reset(); return; }
    if (nd.x === -cur.dir.x && nd.y === -cur.dir.y) return;
    cur.nextDir = nd;
  });

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_snakeState) reset();
  else if (status) status.textContent = _snakeState.dead ? "…" : String(_snakeState.score);
  drawFrame(_snakeState);
  addInterval(tick, 130);
}

/* ------------------------------------------------------------------ */
/* HOVER RUN — flappy-style, record: towers passed                      */
/* ------------------------------------------------------------------ */

function setupRunner(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cWarn = colors.getPropertyValue("--neon-warn").trim() || "#f35";
  const cGold = colors.getPropertyValue("--neon-gold").trim() || "#fd3";

  const GRAVITY = 0.34;
  const FLAP = -5.1;
  const PIPE_W = 30;
  const CAR = { x: 64, w: 30, h: 12 };

  const reset = () => {
    _runnerState = {
      y: H / 2, vy: 0,
      pipes: [], spawnIn: 30,
      speed: 2.2, score: 0, ticks: 0, dead: false, started: false,
      bgOffset: 0
    };
    if (status) status.textContent = "0";
  };

  const drawCar = (s) => {
    ctx.save();
    ctx.translate(CAR.x, s.y);
    ctx.rotate(Math.max(-0.45, Math.min(0.55, s.vy * 0.07)));
    ctx.shadowColor = cAccent;
    ctx.shadowBlur = 10;
    ctx.fillStyle = cAccent;
    ctx.beginPath();
    ctx.moveTo(-CAR.w / 2, 2);
    ctx.lineTo(-CAR.w / 2 + 5, -CAR.h / 2);
    ctx.lineTo(CAR.w / 2 - 4, -CAR.h / 2 + 3);
    ctx.lineTo(CAR.w / 2, 2);
    ctx.lineTo(CAR.w / 2 - 5, CAR.h / 2);
    ctx.lineTo(-CAR.w / 2 + 4, CAR.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(-2, -CAR.h / 2 + 1, 9, 5);
    ctx.shadowColor = cGold;
    ctx.shadowBlur = 8;
    ctx.fillStyle = cGold;
    const flame = 5 + Math.random() * 6;
    ctx.fillRect(-CAR.w / 2 - flame, -2, flame, 4);
    ctx.restore();
  };

  const drawTower = (x, y, w, h) => {
    if (h <= 0) return;
    ctx.save();
    ctx.shadowColor = cWarn;
    ctx.shadowBlur = 8;
    ctx.fillStyle = cWarn;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x + 3, y + 3, w - 6, Math.max(0, h - 6));
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    for (let wy = y + 7; wy < y + h - 6; wy += 12) {
      for (let wx = x + 6; wx < x + w - 6; wx += 9) ctx.fillRect(wx, wy, 4, 6);
    }
    ctx.restore();
  };

  const tick = () => {
    const s = _runnerState;
    if (!s || s.dead) return;
    s.ticks++;

    if (s.started) {
      s.vy = Math.min(7.5, s.vy + GRAVITY);
      s.y += s.vy;
    } else {
      s.y = H / 2 + Math.sin(s.ticks / 14) * 5;
    }

    if (s.started && --s.spawnIn <= 0) {
      const gapH = Math.max(52, 78 - s.score * 1.5);
      const gapY = 22 + Math.random() * (H - 44 - gapH);
      s.pipes.push({ x: W + 10, gapY, gapH, passed: false });
      s.spawnIn = Math.max(58, 84 - Math.floor(s.score / 4) * 4);
    }

    const carTop = s.y - CAR.h / 2 + 2, carBot = s.y + CAR.h / 2 - 2;
    const carL = CAR.x - CAR.w / 2 + 3, carR = CAR.x + CAR.w / 2 - 3;

    if (s.started && (carTop <= 6 || carBot >= H - 6)) {
      s.dead = true;
      return finishGame(html, "runner", status, s.score);
    }

    for (const p of s.pipes) {
      p.x -= s.speed;
      if (!p.passed && p.x + PIPE_W < carL) {
        p.passed = true;
        s.score++;
        if (status) status.textContent = String(s.score);
        AgentAudio.play("tap");
      }
      if (carR > p.x && carL < p.x + PIPE_W &&
          (carTop < p.gapY || carBot > p.gapY + p.gapH)) {
        s.dead = true;
        return finishGame(html, "runner", status, s.score);
      }
    }
    s.pipes = s.pipes.filter(p => p.x + PIPE_W > -10);
    s.speed = 2.2 + Math.min(1.8, s.score * 0.06);
    s.bgOffset = (s.bgOffset + s.speed * 0.5) % 40;

    ctx.fillStyle = "rgba(2,2,8,0.96)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(47,245,208,0.07)";
    ctx.lineWidth = 1;
    for (let gx = -s.bgOffset; gx < W; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = cWarn;
    ctx.shadowBlur = 6;
    ctx.fillStyle = cWarn;
    ctx.fillRect(0, 0, W, 3);
    ctx.fillRect(0, H - 3, W, 3);
    ctx.restore();

    for (const p of s.pipes) {
      drawTower(p.x, 3, PIPE_W, p.gapY - 3);
      drawTower(p.x, p.gapY + p.gapH, PIPE_W, H - 3 - (p.gapY + p.gapH));
    }
    drawCar(s);

    if (!s.started) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("TAP / SPACE", W / 2, H / 2 - 30);
    }
  };

  const flap = () => {
    const s = _runnerState;
    if (!s) return;
    if (s.dead) { reset(); return; }
    s.started = true;
    s.vy = FLAP;
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    if (![" ", "w", "ArrowUp"].includes(ev.key)) return;
    ev.preventDefault();
    if (ev.repeat) return;
    flap();
  });
  canvas.addEventListener("pointerdown", flap);

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_runnerState) reset();
  else if (status) status.textContent = _runnerState.dead ? "…" : String(_runnerState.score);
  addInterval(tick, 24);
}

/* ------------------------------------------------------------------ */
/* NET DUEL — pong vs AI. +1 per return, +5 when the AI misses.         */
/* One missed ball ends the match. Record: max score.                   */
/* ------------------------------------------------------------------ */

function setupNetDuel(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cWarn = colors.getPropertyValue("--neon-warn").trim() || "#f35";
  const PW = 5, PH = 38;

  const serve = (s, dir) => {
    s.bx = W / 2; s.by = H / 2;
    const a = (Math.random() * 0.8 - 0.4);
    s.bvx = dir * s.baseSpeed;
    s.bvy = s.baseSpeed * a;
  };

  const reset = () => {
    _duelState = { py: H / 2, ay: H / 2, keys: 0, baseSpeed: 3.1, score: 0, dead: false, prevT: 0 };
    serve(_duelState, 1);
    if (status) status.textContent = "0";
  };

  const tick = (t) => {
    const s = _duelState;
    if (!s || s.dead) return;
    // frame-time delta keeps motion butter-smooth regardless of fps
    const dt = s.prevT ? Math.min(2, (t - s.prevT) / 16.667) : 1;
    s.prevT = t;

    s.py = Math.max(PH / 2, Math.min(H - PH / 2, s.py + s.keys * 4.4 * dt));

    const aiSpeed = (2.35 + Math.min(1.2, s.score * 0.03)) * dt;
    if (s.ay < s.by - 3) s.ay += aiSpeed;
    else if (s.ay > s.by + 3) s.ay -= aiSpeed;
    s.ay = Math.max(PH / 2, Math.min(H - PH / 2, s.ay));

    const px0 = s.bx;
    s.bx += s.bvx * dt;
    s.by += s.bvy * dt;
    if (s.by < 4) { s.by = 4; s.bvy = Math.abs(s.bvy); }
    if (s.by > H - 4) { s.by = H - 4; s.bvy = -Math.abs(s.bvy); }

    // swept paddle checks — the ball can't tunnel through at high speed
    if (s.bvx < 0 && px0 >= 13 && s.bx <= 13 && Math.abs(s.by - s.py) < PH / 2 + 4) {
      s.bx = 13;
      s.bvx = Math.abs(s.bvx) * 1.045;
      s.bvy += (s.by - s.py) * 0.12;
      s.score++;
      if (status) status.textContent = String(s.score);
      AgentAudio.play("tap");
    }
    if (s.bvx > 0 && px0 <= W - 13 && s.bx >= W - 13 && Math.abs(s.by - s.ay) < PH / 2 + 4) {
      s.bx = W - 13;
      s.bvx = -Math.abs(s.bvx) * 1.03;
      s.bvy += (s.by - s.ay) * 0.1;
    }

    if (s.bx > W + 8) {              // AI missed
      s.score += 5;
      if (status) status.textContent = String(s.score);
      AgentAudio.play("cash");
      serve(s, -1);
    }
    if (s.bx < -8) {                 // player missed — game over
      s.dead = true;
      return finishGame(html, "netduel", status, s.score);
    }

    ctx.fillStyle = "rgba(2,2,8,0.96)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(47,245,208,0.15)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = cAccent;
    ctx.fillStyle = cAccent;
    ctx.fillRect(10, s.py - PH / 2, PW, PH);
    ctx.shadowColor = cWarn;
    ctx.fillStyle = cWarn;
    ctx.fillRect(W - 10 - PW, s.ay - PH / 2, PW, PH);
    ctx.shadowColor = "#fff";
    ctx.fillStyle = "#fff";
    ctx.fillRect(s.bx - 3, s.by - 3, 6, 6);
    ctx.restore();
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    if (_duelState?.dead && [" ", "w", "s", "ArrowUp", "ArrowDown"].includes(ev.key)) { ev.preventDefault(); reset(); return; }
    if (["w", "ArrowUp"].includes(ev.key)) { ev.preventDefault(); if (_duelState) _duelState.keys = -1; }
    if (["s", "ArrowDown"].includes(ev.key)) { ev.preventDefault(); if (_duelState) _duelState.keys = 1; }
  });
  addDocHandler("keyup", (ev) => {
    if (["w", "s", "ArrowUp", "ArrowDown"].includes(ev.key) && _duelState) _duelState.keys = 0;
  });
  canvas.addEventListener("pointerdown", () => { if (_duelState?.dead) reset(); });

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_duelState) reset();
  else {
    _duelState.prevT = 0;
    if (status) status.textContent = _duelState.dead ? "…" : String(_duelState.score);
  }
  addRaf(tick);
}

/* ------------------------------------------------------------------ */
/* QUICKHACK — stop the sweeping cursor inside the shrinking zone.      */
/* Record: longest streak.                                              */
/* ------------------------------------------------------------------ */

function setupQuickhack(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cGood = colors.getPropertyValue("--neon-good").trim() || "#3f8";
  const cWarn = colors.getPropertyValue("--neon-warn").trim() || "#f35";

  const newZone = (s) => {
    s.zoneW = Math.max(0.07, 0.24 - s.score * 0.012);
    s.zoneX = 0.08 + Math.random() * (0.84 - s.zoneW);
    s.speed = 0.016 + s.score * 0.0011;
  };

  const reset = () => {
    _qhState = { t: 0, score: 0, dead: false, flash: 0 };
    newZone(_qhState);
    if (status) status.textContent = "0";
  };

  const tick = () => {
    const s = _qhState;
    if (!s) return;
    if (!s.dead) s.t += s.speed * 16;
    const pos = (Math.sin(s.t / 16) + 1) / 2;

    ctx.fillStyle = "rgba(2,2,8,0.96)";
    ctx.fillRect(0, 0, W, H);

    const barY = H / 2 - 11, barH = 22;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(10, barY, W - 20, barH);

    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = s.flash > 0 ? cGood : cAccent;
    ctx.fillStyle = s.flash > 0 ? cGood : "rgba(47,245,208,0.3)";
    ctx.fillRect(10 + s.zoneX * (W - 20), barY, s.zoneW * (W - 20), barH);
    ctx.restore();
    if (s.flash > 0) s.flash--;

    const cx = 10 + pos * (W - 20);
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = s.dead ? cWarn : "#fff";
    ctx.fillStyle = s.dead ? cWarn : "#fff";
    ctx.fillRect(cx - 2, barY - 7, 4, barH + 14);
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(s.dead ? "TAP TO RETRY" : "TAP / SPACE", W / 2, H - 8);
  };

  const attempt = () => {
    const s = _qhState;
    if (!s) return;
    if (s.dead) { reset(); return; }
    const pos = (Math.sin(s.t / 16) + 1) / 2;
    if (pos >= s.zoneX && pos <= s.zoneX + s.zoneW) {
      s.score++;
      s.flash = 8;
      if (status) status.textContent = String(s.score);
      AgentAudio.play("tap");
      newZone(s);
    } else {
      s.dead = true;
      finishGame(html, "quickhack", status, s.score);
    }
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    if (ev.key !== " ") return;
    ev.preventDefault();
    if (ev.repeat) return;
    attempt();
  });
  canvas.addEventListener("pointerdown", attempt);

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_qhState) reset();
  else if (status) status.textContent = _qhState.dead ? "…" : String(_qhState.score);
  addInterval(tick, 16);
}

/* ------------------------------------------------------------------ */
/* SIMON.EXE — repeat the growing sequence of four pads.                */
/* Record: longest sequence completed.                                  */
/* ------------------------------------------------------------------ */

function setupSimon(html) {
  const pads = html.find(".agentos-simon-pad").toArray();
  const status = html.find(".agentos-game-status")[0];
  if (!pads.length) return;
  const TONES = [392, 494, 587, 740];

  const beep = (i) => {
    try {
      const actx = AgentAudio._ac();
      if (!actx || !AgentAudio._enabled()) return;
      const now = actx.currentTime;
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(TONES[i] || 440, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain); gain.connect(actx.destination);
      osc.start(now); osc.stop(now + 0.25);
    } catch (e) { /* noop */ }
  };

  const flash = (i, ms = 320) => {
    const pad = pads[i];
    if (!pad) return;
    pad.classList.add("lit");
    beep(i);
    addTimeout(() => pad.classList.remove("lit"), ms - 60);
  };

  const playback = (s) => {
    s.locked = true;
    s.inputPos = 0;
    if (status) status.textContent = String(s.seq.length - 1);
    s.seq.forEach((padIdx, i) => {
      addTimeout(() => flash(padIdx), 500 + i * 480);
    });
    addTimeout(() => { s.locked = false; }, 500 + s.seq.length * 480);
  };

  const reset = () => {
    _simonState = { seq: [Math.floor(Math.random() * 4)], inputPos: 0, locked: true, dead: false };
    playback(_simonState);
  };

  html.find(".agentos-simon-pad").on("click", (ev) => {
    const s = _simonState;
    if (!s || s.locked || s.dead) return;
    const idx = Number(ev.currentTarget.dataset.pad);
    flash(idx, 240);
    if (idx === s.seq[s.inputPos]) {
      s.inputPos++;
      if (s.inputPos >= s.seq.length) {
        s.seq.push(Math.floor(Math.random() * 4));
        addTimeout(() => playback(s), 600);
      }
    } else {
      s.dead = true;
      finishGame(html, "simon", status, s.seq.length - 1);
    }
  });

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_simonState || _simonState.dead) reset();
  else playback(_simonState);
}

/* ------------------------------------------------------------------ */
/* 2077 — the 2048 clone. Record: max score.                            */
/* ------------------------------------------------------------------ */

function setup2077(html) {
  const root = html.find(".agentos-2077-board")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!root) return;
  const N = 4, CELL = 68, GAP = 6;

  /* Static background cells (once per render) */
  if (!root.querySelector(".agentos-2077-bg")) {
    for (let i = 0; i < N * N; i++) {
      const bg = document.createElement("div");
      bg.className = "agentos-2077-bg";
      bg.style.transform = `translate(${(i % N) * (CELL + GAP)}px, ${Math.floor(i / N) * (CELL + GAP)}px)`;
      root.appendChild(bg);
    }
  }

  const gridOf = (s) => {
    const g = Array.from({ length: N }, () => Array(N).fill(null));
    for (const t of s.tiles) if (!t.removed) g[t.y][t.x] = t;
    return g;
  };

  const spawn = (s) => {
    const g = gridOf(s);
    const empty = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g[y][x]) empty.push([x, y]);
    if (!empty.length) return;
    const [x, y] = empty[Math.floor(Math.random() * empty.length)];
    s.tiles.push({ id: s.nextId++, v: Math.random() < 0.9 ? 2 : 4, x, y, isNew: true });
  };

  /* Render: keep per-tile DOM nodes so CSS transitions animate the moves. */
  const render = () => {
    const s = _g2077State;
    if (!s) return;
    const seen = new Set();
    for (const t of s.tiles) {
      seen.add(t.id);
      let el = root.querySelector(`[data-tile="${t.id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.dataset.tile = t.id;
        root.appendChild(el);
        if (t.isNew) {
          // let the transform apply before the pop-in animation
          el.style.transform = `translate(${t.x * (CELL + GAP)}px, ${t.y * (CELL + GAP)}px) scale(0.3)`;
        }
      }
      el.className = `agentos-2077-tile v${t.v <= 2048 ? t.v : "big"}` +
        (t.merged ? " merged" : "") + (t.removed ? " removed" : "");
      el.textContent = t.v;
      requestAnimationFrame(() => {
        el.style.transform = `translate(${t.x * (CELL + GAP)}px, ${t.y * (CELL + GAP)}px) scale(1)`;
      });
      t.isNew = false;
      t.merged = false;
    }
    for (const el of [...root.querySelectorAll("[data-tile]")]) {
      if (!seen.has(Number(el.dataset.tile))) el.remove();
    }
  };

  const reset = () => {
    _g2077State = { tiles: [], nextId: 1, score: 0, dead: false, lock: false };
    spawn(_g2077State); spawn(_g2077State);
    if (status) status.textContent = "0";
    root.querySelectorAll("[data-tile]").forEach(el => el.remove());
    render();
  };

  const move = (dx, dy) => {
    const s = _g2077State;
    if (!s || s.dead || s.lock) return;
    const g = gridOf(s);
    let changed = false;

    /* Iterate every line in the push direction; slide + merge tile objects. */
    const lines = [];
    for (let i = 0; i < N; i++) {
      const line = [];
      for (let j = 0; j < N; j++) {
        const x = dx ? (dx > 0 ? N - 1 - j : j) : i;
        const y = dx ? i : (dy > 0 ? N - 1 - j : j);
        if (g[y][x]) line.push(g[y][x]);
      }
      lines.push(line);
    }

    lines.forEach((line, i) => {
      let slot = 0;
      for (let k = 0; k < line.length; k++) {
        const tile = line[k];
        const nxt = line[k + 1];
        let targetSlot = slot;
        if (nxt && nxt.v === tile.v) {
          // merge: both travel to the same slot; the survivor doubles
          tile.v *= 2;
          tile.merged = true;
          s.score += tile.v;
          nxt.removed = true;
          k++;
        }
        const place = (tt, sl) => {
          const x = dx ? (dx > 0 ? N - 1 - sl : sl) : i;
          const y = dx ? i : (dy > 0 ? N - 1 - sl : sl);
          if (tt.x !== x || tt.y !== y) changed = true;
          tt.x = x; tt.y = y;
        };
        place(tile, targetSlot);
        if (nxt && nxt.removed) place(nxt, targetSlot);
        if (tile.merged) changed = true;
        slot++;
      }
    });

    if (!changed) return;
    s.lock = true;
    render();                                   // animate the slide
    AgentAudio.play("tap");
    if (status) status.textContent = String(s.score);

    addTimeout(() => {
      s.tiles = s.tiles.filter(t => !t.removed); // drop swallowed tiles
      spawn(s);
      render();
      s.lock = false;

      const g2 = gridOf(s);
      let full = true, stuck = true;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!g2[y][x]) full = false;
        else {
          if (x + 1 < N && g2[y][x + 1] && g2[y][x].v === g2[y][x + 1].v) stuck = false;
          if (y + 1 < N && g2[y + 1][x] && g2[y][x].v === g2[y + 1][x].v) stuck = false;
        }
      }
      if (full && stuck) {
        s.dead = true;
        finishGame(html, "g2077", status, s.score);
      }
    }, 130);
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    const map = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1]
    };
    const m = map[ev.key];
    if (!m) return;
    ev.preventDefault();
    move(m[0], m[1]);
  });

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_g2077State) reset();
  else {
    if (status) status.textContent = _g2077State.dead ? "…" : String(_g2077State.score);
    render();
  }
}
/* ------------------------------------------------------------------ */
/* BREACH — pick codes alternating row/column to assemble the target    */
/* sequence before the buffer or the timer runs out. Record: uploads.   */
/* ------------------------------------------------------------------ */

function setupBreach(html) {
  const gridEl = html.find(".agentos-breach-grid")[0];
  const targetEl = html.find(".agentos-breach-target")[0];
  const bufferEl = html.find(".agentos-breach-buffer")[0];
  const timerEl = html.find(".agentos-breach-timer")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!gridEl) return;
  const BYTES = ["1C", "55", "7A", "BD", "E9", "FF"];
  const N = 5, BUFFER = 8;

  const newPuzzle = (s) => {
    s.cells = Array.from({ length: N * N }, () => ({ code: BYTES[Math.floor(Math.random() * BYTES.length)], used: false }));
    s.axis = "row";
    s.line = 0;                                   // start: any cell in row 0
    s.buffer = [];
    const len = s.score >= 2 ? 4 : 3;
    // Build a guaranteed-solvable target by walking the grid the legal way.
    s.target = [];
    let axis = "row", line = 0;
    const usedIdx = new Set();
    for (let i = 0; i < len; i++) {
      const options = [];
      for (let k = 0; k < N; k++) {
        const idx = axis === "row" ? line * N + k : k * N + line;
        if (!usedIdx.has(idx)) options.push(idx);
      }
      const idx = options[Math.floor(Math.random() * options.length)];
      usedIdx.add(idx);
      s.target.push(s.cells[idx].code);
      const x = idx % N, y = Math.floor(idx / N);
      if (axis === "row") { axis = "col"; line = x; } else { axis = "row"; line = y; }
    }
  };

  const matched = (s) => {
    const b = s.buffer, t = s.target;
    for (let i = 0; i + t.length <= b.length; i++) {
      let ok = true;
      for (let j = 0; j < t.length; j++) if (b[i + j] !== t[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };

  const draw = () => {
    const s = _breachState;
    if (!s) return;
    if (timerEl) timerEl.textContent = `${s.time}s`;
    if (targetEl) {
      targetEl.innerHTML = "";
      for (const code of s.target) {
        const b = document.createElement("span");
        b.className = "agentos-breach-byte target";
        b.textContent = code;
        targetEl.appendChild(b);
      }
    }
    if (bufferEl) {
      bufferEl.innerHTML = "";
      for (let i = 0; i < BUFFER; i++) {
        const b = document.createElement("span");
        b.className = "agentos-breach-byte buf" + (s.buffer[i] ? " filled" : "");
        b.textContent = s.buffer[i] || "··";
        bufferEl.appendChild(b);
      }
    }
    gridEl.innerHTML = "";
    s.cells.forEach((cell, idx) => {
      const x = idx % N, y = Math.floor(idx / N);
      const selectable = !s.dead && !cell.used &&
        (s.axis === "row" ? y === s.line : x === s.line);
      const el = document.createElement("button");
      el.type = "button";
      el.className = "agentos-breach-cell" + (cell.used ? " used" : "") + (selectable ? " sel" : "");
      el.textContent = cell.used ? "--" : cell.code;
      if (selectable) {
        el.addEventListener("click", () => {
          cell.used = true;
          s.buffer.push(cell.code);
          if (s.axis === "row") { s.axis = "col"; s.line = x; } else { s.axis = "row"; s.line = y; }
          if (matched(s)) {
            s.score++;
            s.time = Math.min(60, s.time + 10);
            if (status) status.textContent = String(s.score);
            AgentAudio.play("cash");
            newPuzzle(s);
          } else if (s.buffer.length >= BUFFER) {
            s.dead = true;
            finishGame(html, "breach", status, s.score);
          } else {
            AgentAudio.play("tap");
          }
          draw();
        });
      }
      gridEl.appendChild(el);
    });
  };

  const reset = () => {
    _breachState = { score: 0, time: 45, dead: false };
    newPuzzle(_breachState);
    if (status) status.textContent = "0";
    draw();
  };

  addInterval(() => {
    const s = _breachState;
    if (!s || s.dead) return;
    s.time--;
    if (timerEl) timerEl.textContent = `${s.time}s`;
    if (s.time <= 0) {
      s.dead = true;
      finishGame(html, "breach", status, s.score);
      draw();
    }
  }, 1000);

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_breachState) reset();
  else {
    if (status) status.textContent = _breachState.dead ? "…" : String(_breachState.score);
    draw();
  }
}
