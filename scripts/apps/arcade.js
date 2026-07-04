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
  { id: "breach",    title: "BREACH",    icon: "fa-terminal" },
  { id: "dodge",     title: "NEON DODGE", icon: "fa-meteor",         suffix: "s" },
  { id: "decrypt",   title: "DECRYPT",   icon: "fa-key",             lower: true, suffix: "t" },
  { id: "firewall",  title: "FIREWALL",  icon: "fa-shield-halved" },
  { id: "heist",     title: "DATA HEIST", icon: "fa-vault" },
  { id: "sprawl",    title: "SPRAWL",    icon: "fa-city" }
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
  const lower = !!GAMES.find(g => g.id === gameId)?.lower;
  saveRecord(gameId, score, lower).then((isNew) => {
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
let _dodgeState = null;
let _decryptState = null;
let _firewallState = null;
let _heistState = null;
let _sprawlState = null;

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
  _dodgeState = _decryptState = _firewallState = _heistState = _sprawlState = null;
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
    case "dodge": setupDodge(html); break;
    case "decrypt": setupDecrypt(html); break;
    case "firewall": setupFirewall(html); break;
    case "heist": setupHeist(html); break;
    case "sprawl": setupSprawl(html); break;
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

/* ------------------------------------------------------------------ */
/* NEON DODGE — steer a drone along the bottom, dodge falling debris.   */
/* Record: seconds survived.                                            */
/* ------------------------------------------------------------------ */

function setupDodge(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cWarn = colors.getPropertyValue("--neon-warn").trim() || "#f35";
  const DRONE = { w: 22, h: 12 };

  const reset = () => {
    _dodgeState = {
      x: W / 2, left: false, right: false,
      blocks: [], spawnIn: 20, startTs: 0, elapsed: 0, dead: false
    };
    if (status) status.textContent = "0";
  };

  const tick = () => {
    const s = _dodgeState;
    if (!s || s.dead) return;
    if (!s.startTs) s.startTs = Date.now();
    s.elapsed = Math.round((Date.now() - s.startTs) / 1000);
    if (status) status.textContent = String(s.elapsed);

    const move = 4.2;
    if (s.left) s.x -= move;
    if (s.right) s.x += move;
    s.x = Math.max(DRONE.w / 2, Math.min(W - DRONE.w / 2, s.x));

    const fall = 2.4 + Math.min(4.5, s.elapsed * 0.12);
    if (--s.spawnIn <= 0) {
      const bw = 14 + Math.random() * 22;
      s.blocks.push({ x: Math.random() * (W - bw), y: -20, w: bw, h: 12 + Math.random() * 10 });
      s.spawnIn = Math.max(9, 22 - Math.floor(s.elapsed / 3));
    }

    const dy = H - 16;
    const dl = s.x - DRONE.w / 2, dr = s.x + DRONE.w / 2, dt = dy - DRONE.h / 2, db = dy + DRONE.h / 2;
    for (const b of s.blocks) {
      b.y += fall;
      if (b.x < dr && b.x + b.w > dl && b.y < db && b.y + b.h > dt) {
        s.dead = true;
        return finishGame(html, "dodge", status, s.elapsed);
      }
    }
    s.blocks = s.blocks.filter(b => b.y < H + 20);

    ctx.fillStyle = "rgba(2,2,8,0.96)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(47,245,208,0.06)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 28) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }

    ctx.save();
    ctx.shadowColor = cWarn; ctx.shadowBlur = 7; ctx.fillStyle = cWarn;
    for (const b of s.blocks) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = cAccent; ctx.shadowBlur = 10; ctx.fillStyle = cAccent;
    ctx.beginPath();
    ctx.moveTo(s.x, dt);
    ctx.lineTo(dr, db);
    ctx.lineTo(dl, db);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    const s = _dodgeState;
    if (s?.dead && [" ", "a", "d", "ArrowLeft", "ArrowRight"].includes(ev.key)) { ev.preventDefault(); reset(); return; }
    if (["a", "ArrowLeft"].includes(ev.key)) { ev.preventDefault(); if (s) s.left = true; }
    if (["d", "ArrowRight"].includes(ev.key)) { ev.preventDefault(); if (s) s.right = true; }
  });
  addDocHandler("keyup", (ev) => {
    const s = _dodgeState;
    if (!s) return;
    if (["a", "ArrowLeft"].includes(ev.key)) s.left = false;
    if (["d", "ArrowRight"].includes(ev.key)) s.right = false;
  });
  canvas.addEventListener("pointerdown", (ev) => {
    const s = _dodgeState;
    if (!s) return;
    if (s.dead) { reset(); return; }
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (W / rect.width);
    s.left = px < s.x; s.right = px >= s.x;
  });
  canvas.addEventListener("pointerup", () => { const s = _dodgeState; if (s) { s.left = s.right = false; } });
  canvas.addEventListener("pointerleave", () => { const s = _dodgeState; if (s) { s.left = s.right = false; } });

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_dodgeState) reset();
  else if (status) status.textContent = _dodgeState.dead ? "…" : String(_dodgeState.elapsed);
  addInterval(tick, 24);
}

/* ------------------------------------------------------------------ */
/* DECRYPT — Mastermind on 4 hex nibbles. Feedback: locked / floating.  */
/* Record: fewest guesses to crack the code.                            */
/* ------------------------------------------------------------------ */

function setupDecrypt(html) {
  const root = html.find(".agentos-decrypt-board")[0];
  const rowEl = html.find(".agentos-decrypt-input")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!root) return;
  const SYMBOLS = ["0", "1", "2", "5", "7", "A", "C", "F"];
  const LEN = 4, MAX = 8;

  const reset = () => {
    const code = Array.from({ length: LEN }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    _decryptState = { code, guesses: [], cur: Array(LEN).fill(0), done: false };
    if (status) status.textContent = "0";
    draw();
  };

  const scoreGuess = (guess, code) => {
    let locked = 0, floating = 0;
    const cRest = [], gRest = [];
    for (let i = 0; i < LEN; i++) {
      if (guess[i] === code[i]) locked++;
      else { cRest.push(code[i]); gRest.push(guess[i]); }
    }
    for (const g of gRest) {
      const idx = cRest.indexOf(g);
      if (idx >= 0) { floating++; cRest.splice(idx, 1); }
    }
    return { locked, floating };
  };

  const submit = () => {
    const s = _decryptState;
    if (!s || s.done) return;
    const guess = s.cur.map(i => SYMBOLS[i]);
    const res = scoreGuess(guess, s.code);
    s.guesses.push({ guess, ...res });
    if (res.locked === LEN) {
      s.done = true;
      if (status) status.textContent = String(s.guesses.length);
      AgentAudio.play("cash");
      const lower = true;
      saveRecord("decrypt", s.guesses.length, lower).then((isNew) => {
        if (status) {
          status.textContent = `${game.i18n.localize("AGENTOS.Arcade.Cracked")} — ${s.guesses.length}` +
            (isNew ? ` · ${game.i18n.localize("AGENTOS.Arcade.NewRecord")}` : "");
        }
        const recEl = html.find(".agentos-arcade-rec")[0];
        if (recEl) recEl.textContent = `REC ${recordLabel("decrypt")}`;
      });
    } else if (s.guesses.length >= MAX) {
      s.done = true;
      if (status) status.textContent = `${game.i18n.localize("AGENTOS.Arcade.Locked")} — ${s.code.join("")}`;
      AgentAudio.play("error");
    } else {
      AgentAudio.play("tap");
    }
    draw();
  };

  const draw = () => {
    const s = _decryptState;
    if (!s) return;
    root.innerHTML = "";
    for (const row of s.guesses) {
      const line = document.createElement("div");
      line.className = "agentos-decrypt-row";
      for (const c of row.guess) {
        const b = document.createElement("span");
        b.className = "agentos-decrypt-byte";
        b.textContent = c;
        line.appendChild(b);
      }
      const pips = document.createElement("span");
      pips.className = "agentos-decrypt-pips";
      for (let i = 0; i < row.locked; i++) { const p = document.createElement("i"); p.className = "pip locked"; pips.appendChild(p); }
      for (let i = 0; i < row.floating; i++) { const p = document.createElement("i"); p.className = "pip float"; pips.appendChild(p); }
      line.appendChild(pips);
      root.appendChild(line);
    }
    if (!rowEl) return;
    rowEl.innerHTML = "";
    if (s.done) return;
    s.cur.forEach((symIdx, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "agentos-decrypt-dial";
      b.textContent = SYMBOLS[symIdx];
      b.addEventListener("click", () => {
        s.cur[i] = (s.cur[i] + 1) % SYMBOLS.length;
        b.textContent = SYMBOLS[s.cur[i]];
        AgentAudio.play("tap");
      });
      b.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        s.cur[i] = (s.cur[i] - 1 + SYMBOLS.length) % SYMBOLS.length;
        b.textContent = SYMBOLS[s.cur[i]];
      });
      rowEl.appendChild(b);
    });
    const go = document.createElement("button");
    go.type = "button";
    go.className = "agentos-decrypt-go";
    go.textContent = "▶";
    go.addEventListener("click", submit);
    rowEl.appendChild(go);
  };

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_decryptState) reset();
  else draw();
}

/* ------------------------------------------------------------------ */
/* FIREWALL — breakout. Bounce the ICE packet, break the firewall rows. */
/* Record: score.                                                       */
/* ------------------------------------------------------------------ */

function setupFirewall(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cWarn = colors.getPropertyValue("--neon-warn").trim() || "#f35";
  const cGold = colors.getPropertyValue("--neon-gold").trim() || "#fd3";
  const COLS = 8, ROWS = 4, MARGIN = 8;
  const BW = (W - MARGIN * 2) / COLS, BH = 12, PAD_W = 52, PAD_H = 7;

  const buildBricks = () => {
    const bricks = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      bricks.push({ x: MARGIN + c * BW, y: 26 + r * (BH + 4), row: r, alive: true });
    }
    return bricks;
  };

  const reset = () => {
    _firewallState = {
      px: W / 2, bricks: buildBricks(),
      bx: W / 2, by: H - 40, bvx: 2.4, bvy: -3.2,
      score: 0, dead: false, prevT: 0, left: false, right: false
    };
    if (status) status.textContent = "0";
  };

  const tick = (t) => {
    const s = _firewallState;
    if (!s || s.dead) return;
    const dt = s.prevT ? Math.min(2, (t - s.prevT) / 16.667) : 1;
    s.prevT = t;

    const pad = 6 * dt;
    if (s.left) s.px -= pad;
    if (s.right) s.px += pad;
    s.px = Math.max(PAD_W / 2, Math.min(W - PAD_W / 2, s.px));

    s.bx += s.bvx * dt;
    s.by += s.bvy * dt;
    if (s.bx < 5) { s.bx = 5; s.bvx = Math.abs(s.bvx); }
    if (s.bx > W - 5) { s.bx = W - 5; s.bvx = -Math.abs(s.bvx); }
    if (s.by < 5) { s.by = 5; s.bvy = Math.abs(s.bvy); }

    const padY = H - 14;
    if (s.bvy > 0 && s.by >= padY - 4 && s.by <= padY + 4 &&
        s.bx >= s.px - PAD_W / 2 && s.bx <= s.px + PAD_W / 2) {
      s.bvy = -Math.abs(s.bvy);
      s.bvx += (s.bx - s.px) * 0.05;
      s.bvx = Math.max(-4.5, Math.min(4.5, s.bvx));
      AgentAudio.play("tap");
    }

    if (s.by > H + 8) {
      s.dead = true;
      return finishGame(html, "firewall", status, s.score);
    }

    for (const b of s.bricks) {
      if (!b.alive) continue;
      if (s.bx > b.x && s.bx < b.x + BW && s.by > b.y && s.by < b.y + BH) {
        b.alive = false;
        s.bvy = -s.bvy;
        s.score += 10;
        if (status) status.textContent = String(s.score);
        AgentAudio.play("tap");
        break;
      }
    }
    if (s.bricks.every(b => !b.alive)) {
      s.bricks = buildBricks();
      s.bvy = -Math.abs(s.bvy) * 1.04;
      AgentAudio.play("cash");
    }

    ctx.fillStyle = "rgba(2,2,8,0.96)";
    ctx.fillRect(0, 0, W, H);
    const rowColors = [cWarn, cGold, cAccent, cAccent];
    for (const b of s.bricks) {
      if (!b.alive) continue;
      ctx.save();
      ctx.shadowColor = rowColors[b.row] || cAccent;
      ctx.shadowBlur = 6;
      ctx.fillStyle = rowColors[b.row] || cAccent;
      ctx.fillRect(b.x + 1, b.y, BW - 2, BH);
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = cAccent; ctx.shadowBlur = 8; ctx.fillStyle = cAccent;
    ctx.fillRect(s.px - PAD_W / 2, padY, PAD_W, PAD_H);
    ctx.fillStyle = "#fff";
    ctx.fillRect(s.bx - 3, s.by - 3, 6, 6);
    ctx.restore();
  };

  const movePad = (clientX) => {
    const s = _firewallState;
    if (!s) return;
    const rect = canvas.getBoundingClientRect();
    // clamp the raw cursor to the canvas span so off-canvas movement still tracks the edges
    const local = Math.max(0, Math.min(rect.width, clientX - rect.left)) * (W / rect.width);
    s.px = Math.max(PAD_W / 2, Math.min(W - PAD_W / 2, local));
  };
  // track the mouse across the whole document so the paddle can reach both edges
  addDocHandler("pointermove", (ev) => movePad(ev.clientX));
  canvas.addEventListener("pointerdown", (ev) => { if (_firewallState?.dead) reset(); else movePad(ev.clientX); });
  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    const s = _firewallState;
    if (!s) return;
    if (s.dead && [" ", "a", "d", "ArrowLeft", "ArrowRight"].includes(ev.key)) { ev.preventDefault(); reset(); return; }
    if (["a", "ArrowLeft"].includes(ev.key)) { ev.preventDefault(); s.left = true; }
    if (["d", "ArrowRight"].includes(ev.key)) { ev.preventDefault(); s.right = true; }
  });
  addDocHandler("keyup", (ev) => {
    const s = _firewallState;
    if (!s) return;
    if (["a", "ArrowLeft"].includes(ev.key)) s.left = false;
    if (["d", "ArrowRight"].includes(ev.key)) s.right = false;
  });

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_firewallState) reset();
  else { _firewallState.prevT = 0; if (status) status.textContent = _firewallState.dead ? "…" : String(_firewallState.score); }
  addRaf(tick);
}

/* ------------------------------------------------------------------ */
/* DATA HEIST — grab shards in a maze while ICE demons hunt you.        */
/* Record: shards collected across the run.                             */
/* ------------------------------------------------------------------ */

function setupHeist(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cWarn = colors.getPropertyValue("--neon-warn").trim() || "#f35";
  const cGold = colors.getPropertyValue("--neon-gold").trim() || "#fd3";
  // Hand-built 15x11 maze: 1 = wall, 0 = corridor.
  const MAP = [
    "111111111111111",
    "100000010000001",
    "101110010111101",
    "101000000000101",
    "101011111010101",
    "100010000010001",
    "101011111010101",
    "101000000000101",
    "101110010111101",
    "100000010000001",
    "111111111111111"
  ];
  const ROWS = MAP.length, COLS = MAP[0].length;
  const TS = Math.floor(Math.min(W / COLS, H / ROWS));
  const OX = Math.floor((W - TS * COLS) / 2), OY = Math.floor((H - TS * ROWS) / 2);
  const wall = (cx, cy) => cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || MAP[cy][cx] === "1";

  const scatterShards = () => {
    const cells = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (MAP[y][x] === "0") cells.push({ x, y });
    return cells;
  };

  const reset = () => {
    _heistState = {
      px: 7, py: 5, dir: { x: 0, y: 0 }, next: { x: 0, y: 0 },
      shards: scatterShards().filter(c => !(c.x === 7 && c.y === 5)),
      demons: [{ x: 1, y: 1 }, { x: 13, y: 9 }, { x: 13, y: 1 }],
      score: 0, moveT: 0, demonT: 0, dead: false
    };
    if (status) status.textContent = "0";
  };

  const stepDemon = (d, s) => {
    const opts = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
      .filter(o => !wall(d.x + o.x, d.y + o.y));
    if (!opts.length) return;
    // 65% chase the player, else random — keeps them beatable
    let pick;
    if (Math.random() < 0.65) {
      opts.sort((a, b) =>
        (Math.abs(d.x + a.x - s.px) + Math.abs(d.y + a.y - s.py)) -
        (Math.abs(d.x + b.x - s.px) + Math.abs(d.y + b.y - s.py)));
      pick = opts[0];
    } else pick = opts[Math.floor(Math.random() * opts.length)];
    d.x += pick.x; d.y += pick.y;
  };

  const tick = () => {
    const s = _heistState;
    if (!s || s.dead) return;

    if (++s.moveT >= 6) {
      s.moveT = 0;
      if (!wall(s.px + s.next.x, s.py + s.next.y)) s.dir = { ...s.next };
      if (!wall(s.px + s.dir.x, s.py + s.dir.y)) { s.px += s.dir.x; s.py += s.dir.y; }
      const hit = s.shards.findIndex(c => c.x === s.px && c.y === s.py);
      if (hit >= 0) {
        s.shards.splice(hit, 1);
        s.score++;
        if (status) status.textContent = String(s.score);
        AgentAudio.play("tap");
        if (!s.shards.length) { s.shards = scatterShards().filter(c => !(c.x === s.px && c.y === s.py)); AgentAudio.play("cash"); }
      }
    }
    if (++s.demonT >= 9) {
      s.demonT = 0;
      for (const d of s.demons) stepDemon(d, s);
    }
    if (s.demons.some(d => d.x === s.px && d.y === s.py)) {
      s.dead = true;
      return finishGame(html, "heist", status, s.score);
    }

    ctx.fillStyle = "rgba(2,2,8,0.96)";
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (MAP[y][x] !== "1") continue;
      ctx.save();
      ctx.shadowColor = cAccent; ctx.shadowBlur = 4;
      ctx.fillStyle = "rgba(47,245,208,0.12)";
      ctx.strokeStyle = "rgba(47,245,208,0.4)";
      ctx.fillRect(OX + x * TS, OY + y * TS, TS, TS);
      ctx.strokeRect(OX + x * TS + 0.5, OY + y * TS + 0.5, TS - 1, TS - 1);
      ctx.restore();
    }
    ctx.fillStyle = cGold;
    for (const c of s.shards) {
      ctx.beginPath();
      ctx.arc(OX + c.x * TS + TS / 2, OY + c.y * TS + TS / 2, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = cAccent; ctx.shadowBlur = 8; ctx.fillStyle = cAccent;
    ctx.beginPath();
    ctx.arc(OX + s.px * TS + TS / 2, OY + s.py * TS + TS / 2, TS / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.shadowColor = cWarn; ctx.shadowBlur = 8; ctx.fillStyle = cWarn;
    for (const d of s.demons) {
      ctx.fillRect(OX + d.x * TS + 2, OY + d.y * TS + 2, TS - 4, TS - 4);
    }
    ctx.restore();
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    const s = _heistState;
    if (s?.dead && [" ", "w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) { ev.preventDefault(); reset(); return; }
    const map = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 }
    };
    const nd = map[ev.key];
    if (!nd || !s) return;
    ev.preventDefault();
    s.next = nd;
  });
  canvas.addEventListener("pointerdown", () => { if (_heistState?.dead) reset(); });

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_heistState) reset();
  else if (status) status.textContent = _heistState.dead ? "…" : String(_heistState.score);
  addInterval(tick, 40);
}

/* ------------------------------------------------------------------ */
/* SPRAWL — stack sliding megabuilding floors. Overhang gets sheared.   */
/* Record: floors stacked.                                              */
/* ------------------------------------------------------------------ */

function setupSprawl(html) {
  const canvas = html.find(".agentos-game-canvas")[0];
  const status = html.find(".agentos-game-status")[0];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const colors = getComputedStyle(canvas);
  const cAccent = colors.getPropertyValue("--neon-accent").trim() || "#0ff";
  const cGold = colors.getPropertyValue("--neon-gold").trim() || "#fd3";
  const cWarn = colors.getPropertyValue("--neon-warn").trim() || "#f35";
  const FH = 16;                                   // floor height

  const reset = () => {
    _sprawlState = {
      floors: [{ x: W / 2 - 55, w: 110 }],           // base floor
      curX: 0, curW: 110, vx: 2.6, camY: 0,
      score: 0, dead: false
    };
    if (status) status.textContent = "0";
  };

  const drop = () => {
    const s = _sprawlState;
    if (!s) return;
    if (s.dead) { reset(); return; }
    const top = s.floors[s.floors.length - 1];
    const left = Math.max(s.curX, top.x);
    const right = Math.min(s.curX + s.curW, top.x + top.w);
    const overlap = right - left;
    if (overlap <= 0) {
      s.dead = true;
      return finishGame(html, "sprawl", status, s.score);
    }
    s.floors.push({ x: left, w: overlap });
    s.curW = overlap;
    s.score++;
    if (status) status.textContent = String(s.score);
    AgentAudio.play(overlap >= top.w - 2 ? "cash" : "tap");
    // speed up + spawn the next slider from an alternating side
    s.vx = (Math.random() < 0.5 ? -1 : 1) * (2.6 + Math.min(3, s.score * 0.12));
    s.curX = s.vx > 0 ? 0 : W - s.curW;
  };

  const tick = () => {
    const s = _sprawlState;
    if (!s || s.dead) return;
    s.curX += s.vx;
    if (s.curX <= 0) { s.curX = 0; s.vx = Math.abs(s.vx); }
    if (s.curX + s.curW >= W) { s.curX = W - s.curW; s.vx = -Math.abs(s.vx); }

    // camera follows the growing tower so the top stays visible
    const stackTop = H - 10 - s.floors.length * FH;
    const targetCam = Math.min(0, stackTop - 40);
    s.camY += (targetCam - s.camY) * 0.15;

    ctx.fillStyle = "rgba(2,2,8,0.96)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(47,245,208,0.06)";
    for (let gy = (-s.camY % 24); gy < H; gy += 24) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    s.floors.forEach((f, i) => {
      const y = H - 10 - (i + 1) * FH - s.camY;
      ctx.save();
      ctx.shadowColor = i === s.floors.length - 1 ? cGold : cAccent;
      ctx.shadowBlur = 6;
      ctx.fillStyle = i === s.floors.length - 1 ? cGold : cAccent;
      ctx.fillRect(f.x, y, f.w, FH - 2);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      for (let wx = f.x + 4; wx < f.x + f.w - 3; wx += 8) ctx.fillRect(wx, y + 4, 3, FH - 8);
      ctx.restore();
    });

    const sy = H - 10 - (s.floors.length + 1) * FH - s.camY;
    ctx.save();
    ctx.shadowColor = cWarn; ctx.shadowBlur = 8; ctx.fillStyle = cWarn;
    ctx.fillRect(s.curX, sy, s.curW, FH - 2);
    ctx.restore();
  };

  addDocHandler("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;
    if (![" ", "ArrowDown"].includes(ev.key)) return;
    ev.preventDefault();
    if (ev.repeat) return;
    drop();
  });
  canvas.addEventListener("pointerdown", drop);

  html.find("[data-action='game-reset']").on("click", () => reset());

  if (!_sprawlState) reset();
  else if (status) status.textContent = _sprawlState.dead ? "…" : String(_sprawlState.score);
  addInterval(tick, 20);
}
