/* Three isolated browser clients, a GM relay and deliberately delayed sockets.
 * No live world, remote services or persistent Foundry data are used. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const foundry = process.env.FOUNDRY_APP || path.join(process.env.ProgramFiles, "Foundry Virtual Tabletop/resources/app");
const templates = {};
for (const file of await readdir(path.join(root, "templates"))) if (file.endsWith(".hbs")) templates[file] = await readFile(path.join(root, "templates", file), "utf8");
const lang = JSON.parse(await readFile(path.join(root, "lang/ru.json"), "utf8"));
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") return res.end("<!doctype html><body></body>");
  const target = path.resolve(root, `.${pathname}`);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    res.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/plain");
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, closing = false;
const clients = [], errors = [], inFlight = new Set();
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1400 }, hasTouch: true });
  for (const userId of ["gm", "p", "q"]) {
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(`${userId}: ${e.message}`));
    await page.exposeFunction("netSend", (packet, options) => {
      if (closing) return;
      const task = new Promise(resolve => setTimeout(resolve, 100 + ((packet.serial || 0) % 3) * 30))
        .then(() => Promise.all(clients.filter(c => c.page !== page && (!options?.recipients || options.recipients.includes(c.userId))).map(c => c.page.evaluate(({ packet, senderId }) => socketReceive(packet, senderId), { packet, senderId: userId }))))
        .catch(e => { if (!closing) errors.push(e.message); });
      inFlight.add(task); task.finally(() => inFlight.delete(task));
    });
    await page.goto(base);
    await page.addScriptTag({ path: path.join(foundry, "node_modules/jquery/dist/jquery.js") });
    await page.addScriptTag({ path: path.join(foundry, "node_modules/handlebars/dist/handlebars.js") });
    await page.addStyleTag({ content: "*,*::before,*::after{box-sizing:border-box}body{background:#171b22}" });
    await page.addStyleTag({ url: `${base}/styles/agent.css` });
    clients.push({ page, userId });
    await page.evaluate(async ({ userId, templates, lang }) => {
      const users = [{ id: "gm", name: "GM", isGM: true, active: true }, { id: "p", name: "Ночной Курьер", active: true }, { id: "q", name: "Ghost", active: true }];
      users.forEach(u => { u.getFlag = () => null; });
      users.get = id => users.find(u => u.id === id);
      const hooks = new Map();
      globalThis.Hooks = { on: (key, fn) => hooks.set(key, fn), callAll: (key, ...args) => hooks.get(key)?.(...args) };
      globalThis.foundry = { utils: { randomID: () => crypto.randomUUID(), deepClone: structuredClone } };
      globalThis.notifications = [];
      globalThis.ui = { notifications: { warn: m => notifications.push(m), info: m => notifications.push(m) } };
      const localize = key => key.split(".").reduce((o, part) => o?.[part], lang) || key;
      const metadata = new Map();
      globalThis.game = { user: users.get(userId), users, i18n: { localize },
        settings: { get: (m, key) => metadata.get(key) || false, set: async (m, key, value) => { if (key !== "agentNotifications") throw Error("Unexpected gameplay world write"); metadata.set(key, value); } },
        socket: { on: (channel, fn) => { globalThis.socketReceive = fn; }, emit: (channel, packet, options) => netSend(packet, options) } };
      Handlebars.registerHelper("agEq", (a, b) => a === b);
      Handlebars.registerHelper("localize", localize);
      for (const [name, text] of Object.entries(templates)) Handlebars.registerPartial(`modules/cyberpunk-red-agent-os-modified/templates/${name}`, text);
      const shell = Handlebars.compile(templates["shell.hbs"]);
      globalThis.arcade = await import("/scripts/apps/arcade.js");
      globalThis.net = await import("/scripts/arcade-network.js");
      (await import("/scripts/socket.js")).initSocket();
      globalThis.app = {
        state: { arcadeTab: "network" }, currentApp: "arcade", rendered: true, deviceMode: "phone", paints: 0,
        async render() {
          arcade.onClose();
          const data = await arcade.getData(this);
          $(document.body).off();
          document.body.innerHTML = shell({ mode: this.deviceMode, theme: "red", zoom: 1.3, view: "arcade", viewTitle: "ARCADE", viewData: data });
          arcade.activateListeners(this, $(document.body));
          this.paints++;
        }
      };
      await app.render();
    }, { userId, templates, lang });
  }
  const [gm, player, third] = clients.map(c => c.page);
  const phase = (page, value) => page.waitForFunction(value => net.networkState().room?.phase === value, value);
  const leaveAll = async () => {
    for (const { page } of clients) {
      if (await page.evaluate(() => !!net.networkState().room)) {
        await page.locator("[data-action=net-leave]").click();
        await page.waitForFunction(() => !net.networkState().room);
      }
    }
    for (const { page } of clients) await page.waitForFunction(() => !net.networkState().room);
  };
  const start = async (kind, participants = [player, gm]) => {
    await player.locator(`[data-action=net-create][data-kind=${kind}]`).click();
    await player.locator("[data-action=net-ready]").waitFor();
    const id = await player.evaluate(() => net.networkState().room.id);
    if (participants.includes(third)) {
      await player.locator("[name=net-invite-user]").selectOption("q");
      await player.locator("[data-action=net-invite]").click();
      await third.locator(".agentos-net-invite").waitFor();
      assert.ok(await third.evaluate(() => notifications.length > 0));
    }
    for (const page of participants.filter(p => p !== player)) {
      await page.locator(`[data-action=net-join][data-room-id="${id}"]`).last().click();
      await page.locator("[data-action=net-ready]").waitFor();
    }
    for (const page of participants) await page.locator("[data-action=net-ready]").click();
    await player.locator("[data-action=net-start]:not([disabled])").waitFor();
    await player.locator("[data-action=net-start]").click();
    await Promise.all(participants.map(page => phase(page, "playing")));
    for (const page of participants) await page.locator(".agentos-net-canvas").waitFor();
  };
  await start("bomber", [player, gm, third]);
  for (const page of [player, gm, third]) assert.equal(await page.locator(".agentos-net-players > span").count(), 3);
  const paints = await player.evaluate(() => app.paints);
  await player.locator('[data-net-move="right"]').dispatchEvent("pointerdown", { pointerId: 1 });
  await player.waitForTimeout(430);
  await player.locator('[data-net-move="right"]').dispatchEvent("pointerup", { pointerId: 1 });
  await player.waitForFunction(() => net.networkState().room.game.bodies.find(b => b.id === "p").x >= 2);
  assert.equal(await player.evaluate(() => app.paints), paints, "Live snapshots must draw the canvas, not rebuild the Agent");
  assert.equal(await player.locator(".agentos-app-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  if (process.env.AGENTOS_TEST_SCREENSHOT_DIR) await player.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, "agentos-neon-bombers.png") });
  await leaveAll();
  console.log("PASS: 3-client Bomberman room, GM as participant, held touch controls and no full renders during play");

  await start("tetris");
  const immediate = await player.evaluate(() => {
    const hostSeq = net.networkState().room.players.find(p => p.id === "p").seq;
    const before = document.querySelector("canvas").toDataURL();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    return { hostSeq, paints: app.paints, predicted: before !== document.querySelector("canvas").toDataURL() };
  });
  await player.waitForFunction(() => net.networkState().room.players.find(p => p.id === "p").seq > 0);
  assert.equal(immediate.hostSeq, 0);
  assert.equal(immediate.predicted, true, "Tetris must draw the input before any network acknowledgement");
  assert.equal(await player.evaluate(() => app.paints), immediate.paints);
  await player.evaluate(() => {
    const input = document.createElement("input"); document.body.appendChild(input); input.focus();
  });
  await player.keyboard.type("wasd");
  assert.equal(await player.locator("body > input").inputValue(), "wasd", "Game controls must not capture typing outside the cabinet");
  await player.locator("body > input").evaluate(el => el.remove());
  for (const mode of ["phone", "tablet", "pc"]) {
    await player.evaluate(async mode => { app.deviceMode = mode; await app.render(); }, mode);
    assert.equal(await player.locator(".agentos-app-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${mode}: network game overflow at 130%`);
    assert.equal(await player.locator("[data-net-move]").count(), 5);
  }
  if (process.env.AGENTOS_TEST_SCREENSHOT_DIR) await player.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, "agentos-stack-duel.png") });
  const beforeClosing = await player.evaluate(() => net.networkState().room.game.nextFall);
  await player.evaluate(() => { arcade.onClose(); document.body.innerHTML = "<p>Other application</p>"; });
  await player.waitForFunction(fall => net.networkState().room.game.nextFall > fall + 650, beforeClosing);
  await player.evaluate(() => app.render());
  await leaveAll();
  console.log("PASS: Tetris input batching, delayed acknowledgements, typing isolation and all device modes at 130%");

  await player.evaluate(async () => { app.deviceMode = "phone"; await app.render(); });
  await start("fleet");
  assert.equal(await player.evaluate(() => net.networkState().room.game.boards.gm.ships), undefined);
  assert.equal(await gm.evaluate(() => net.networkState().room.game.boards.p.ships), undefined);
  const canvas = player.locator(".agentos-net-canvas"), rect = await canvas.boundingBox();
  await player.mouse.click(rect.x + 187 / 330 * rect.width, rect.y + 64 / 260 * rect.height);
  await player.waitForFunction(() => net.networkState().room.game.boards.gm.shots.includes(0));
  await gm.waitForFunction(() => net.networkState().room.game.turn === "gm");
  assert.equal(await player.locator(".agentos-net-status").textContent(), "Ход: GM");
  if (process.env.AGENTOS_TEST_SCREENSHOT_DIR) await player.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, "agentos-grid-fleet.png") });
  await player.locator("[data-action=net-leave]").click();
  await player.waitForFunction(() => !net.networkState().room);
  await phase(gm, "finished");
  assert.equal(await gm.evaluate(() => net.networkState().room.winner), "gm");
  await leaveAll();
  console.log("PASS: fleet privacy, correct cursor at 130%, alternating turns and surrender");
  const clickBoard = async (page, x, y) => {
    const bounds = await page.locator(".agentos-net-canvas").boundingBox();
    await page.mouse.click(bounds.x + x / 330 * bounds.width, bounds.y + y / 330 * bounds.height);
  };
  await start("connect4");
  for (let n = 0; n < 3; n++) {
    await clickBoard(player, 25, 70);
    await player.waitForFunction(() => net.networkState().room.game.turn === "gm"); await gm.waitForFunction(() => net.networkState().room.game.turn === "gm");
    await clickBoard(gm, 75, 70);
    await gm.waitForFunction(() => net.networkState().room.game.turn === "p"); await player.waitForFunction(() => net.networkState().room.game.turn === "p");
  }
  await clickBoard(player, 25, 70); await phase(player, "finished"); await phase(gm, "finished");
  assert.equal(await gm.evaluate(() => net.networkState().room.winner), "p");
  await player.locator("[data-action=net-ready]").click(); await gm.locator("[data-action=net-ready]").click();
  await player.locator("[data-action=net-start]").click(); await phase(player, "playing");
  assert.equal(await player.evaluate(() => net.networkState().room.round), 2);
  await player.locator("[data-action=net-pause]").click();
  await gm.waitForFunction(() => net.networkState().room.pauseVotes?.includes("p"));
  assert.equal(await gm.evaluate(() => !!net.networkState().room.paused), false, "One vote cannot pause only one simulation");
  await gm.locator("[data-action=net-pause]").click();
  await player.waitForFunction(() => net.networkState().room.paused);
  await player.locator("[data-action=net-pause]").click();
  await gm.waitForFunction(() => !net.networkState().room.paused);
  await leaveAll();
  await start("reversi");
  const legal = await player.evaluate(async () => (await import("/scripts/arcade-network-core.js")).legalCells(net.networkState().room));
  const cell = legal[0]; await clickBoard(player, 5 + (cell % 8 + 0.5) * 40, 30 + (Math.floor(cell / 8) + 0.5) * 35);
  await gm.waitForFunction(() => net.networkState().room.game.turn === "gm");
  assert.equal(await gm.evaluate(() => net.networkState().room.game.cells.filter(v => v === 1).length), 4);
  await leaveAll();
  console.log("PASS: FOUR LINK/Reversi pointer input at 130%, consistent victory, rematch and consensus pause");
  for (const { page } of clients) await page.evaluate(() => arcade.onClose());
  assert.deepEqual(errors, []);
} finally {
  closing = true;
  await Promise.allSettled([...inFlight]);
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
