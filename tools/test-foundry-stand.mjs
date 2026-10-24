/* Native v12 server in a disposable data directory. Copies runtime files and
 * license locally; never opens an existing world or writes into the system. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, cp, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.resolve(root, "../..");
const installed = process.env.FOUNDRY_APP || path.join(process.env.ProgramFiles, "Foundry Virtual Tabletop/resources/app");
const executable = path.resolve(installed, "../../Foundry Virtual Tabletop.exe");
const { chromium } = createRequire(import.meta.url)(process.argv[2] || "playwright");
const moduleId = "cyberpunk-red-agent-os-modified", worldId = "agent-os-qa";
const effects = process.argv.includes("--effects");
const temp = await mkdtemp(path.join(tmpdir(), "agent-os-foundry-qa-"));
const sandboxData = path.join(temp, "Data"), moduleCopy = path.join(sandboxData, "modules", moduleId);
let server, browser, output = "";
function pdfFixture() {
  const stream = "BT /F1 18 Tf 20 100 Td (Agent OS QA book) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n", offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
try {
  await mkdir(path.join(temp, "Config"), { recursive: true });
  await mkdir(path.join(sandboxData, "worlds", worldId), { recursive: true });
  await mkdir(path.join(sandboxData, "qa-source/Folder"), { recursive: true });
  await writeFile(path.join(sandboxData, "qa-source/Folder/QA Book.pdf"), pdfFixture());
  await writeFile(path.join(sandboxData, "qa-source/index.json"), JSON.stringify({ files: ["Folder/QA Book.pdf"] }));
  console.log("Preparing isolated Foundry v12 world and runtime copies");
  await cp(path.join(data, "systems/cyberpunk-red-core"), path.join(sandboxData, "systems/cyberpunk-red-core"), { recursive: true, filter: source => !["LOCK", "LOG", "LOG.old"].includes(path.basename(source)) });
  await mkdir(moduleCopy, { recursive: true });
  for (const entry of ["module.json", "scripts", "templates", "styles", "lang", "assets"]) await cp(path.join(root, entry), path.join(moduleCopy, entry), { recursive: true });
  if (effects) for (const id of ["socketlib", "sequencer", "JB2A_DnD5e"]) {
    console.log(`Copying optional VFX dependency: ${id}`);
    await cp(path.join(data, "modules", id), path.join(sandboxData, "modules", id), { recursive: true, filter: source => !["LOCK", "LOG", "LOG.old"].includes(path.basename(source)) });
  }
  await copyFile(path.resolve(data, "../Config/license.json"), path.join(temp, "Config/license.json"));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  await writeFile(path.join(temp, "Config/options.json"), JSON.stringify({ dataPath: temp, port, upnp: false, hostname: "127.0.0.1", localHostname: "127.0.0.1", language: "en.core", world: worldId }));
  await writeFile(path.join(sandboxData, "worlds", worldId, "world.json"), JSON.stringify({ id: worldId, title: "Agent OS isolated QA", system: "cyberpunk-red-core", coreVersion: "12.343", systemVersion: "v0.92.4", compatibility: { minimum: "12", verified: "12.343" } }));
  const bootstrap = path.join(temp, "server.mjs");
  // Electron's RUN_AS_NODE provides the installed compatible Node 20 runtime.
  // Force only this test server's listener to loopback; leave installed files intact.
  await writeFile(bootstrap, `import { Server } from 'node:net';\ndelete process.versions.electron;\nconst listen = Server.prototype.listen;\nServer.prototype.listen = function(port, ...args) { if (port === ${port}) { if (typeof args[0] === 'string') args[0] = '127.0.0.1'; else args.unshift('127.0.0.1'); } return listen.call(this, port, ...args); };\nawait import(${JSON.stringify(pathToFileURL(path.join(installed, "main.mjs")).href)});\n`);
  server = spawn(executable, [bootstrap, `--dataPath=${temp}`, `--port=${port}`, `--world=${worldId}`, "--noupnp", "--noupdate", "--noipdiscovery"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", chunk => { output += chunk; }); server.stderr.on("data", chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Foundry startup exited ${server.exitCode}: ${output.slice(-1500)}`);
    try { const response = await fetch(`${base}/join`); if (response.ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(ready, "Isolated Foundry server did not become ready");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [], pages = [];
  async function join(name) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
    const page = await context.newPage(); pages.push(page);
    page.on("pageerror", error => errors.push(`${name}: ${error.stack || error.message}`));
    await page.goto(`${base}/join`);
    const user = page.locator('select[name="userid"]');
    await user.selectOption({ label: name });
    await page.locator('button[name="join"]').click();
    await page.waitForFunction(() => globalThis.game?.ready, null, { timeout: 60000 });
    return page;
  }
  const gm = await join("Gamemaster");
  await gm.evaluate(async ids => { await game.settings.set("core", "moduleConfiguration", Object.fromEntries(ids.map(id => [id, true]))); }, [moduleId, ...(effects ? ["socketlib", "sequencer", "JB2A_DnD5e"] : [])]);
  await gm.reload(); await gm.waitForFunction(() => game.ready && globalThis.AgentOS?.ui, null, { timeout: 60000 });
  console.log("PASS: native Foundry v12 server, fresh world and module init/ready hooks");
  const actors = await gm.evaluate(async () => {
    const users = await User.createDocuments([{ name: "QA Player A", role: 1 }, { name: "QA Player B", role: 1 }]);
    const actors = [];
    for (const user of users) {
      const actor = await Actor.create({ name: user.name, type: "character", ownership: { [user.id]: 3 }, system: { wealth: { value: 1000 } } }, { renderSheet: false });
      await user.update({ character: actor.id }); actors.push({ userId: user.id, actorUuid: actor.uuid });
    }
    return actors;
  });
  const player = await join("QA Player A"), other = await join("QA Player B");
  for (const page of pages) await page.waitForFunction(() => !!globalThis.AgentOS?.ui);
  for (const page of pages) await page.evaluate(async () => { globalThis.qaData = await import("/modules/cyberpunk-red-agent-os-modified/scripts/data.js"); });
  await gm.evaluate(async actorUuid => {
    globalThis.qaOriginalGmConfirm = Dialog.confirm;
    Dialog.confirm = () => { throw new Error("The GM must never approve a transfer manually"); };
    await AgentOS.ui.close();
    const actor = await fromUuid(actorUuid);
    await actor.update({ "system.wealth.transactions": [["Increased by 40 to 40", "Продал - Санчоус"], ["Ручная запись\nвторая строка", "Ручная причина"]] });
  }, actors[0].actorUuid);
  const transfer = { fromActorUuid: actors[0].actorUuid, toActorUuid: actors[1].actorUuid, amount: 125, memo: "Native QA transfer" };
  await player.evaluate(() => {
    AgentOS.ui.openApp("wallet"); AgentOS.ui.render(true);
    globalThis.qaOriginalConfirm = Dialog.confirm;
    Dialog.confirm = () => { throw new Error("Transfer must not ask for confirmation"); };
  });
  await player.locator('[data-action="transfer-open"]').click();
  await player.locator(`[name="transfer-target"] option[value="actor:${actors[1].actorUuid}"]`).waitFor({ state: "attached" });
  await gm.evaluate(userId => {
    globalThis.qaOriginalEmit = game.socket.emit.bind(game.socket);
    game.socket.emit = (...args) => {
      if (args[1]?.action === "mutateResult" && args[1].targetUserId === userId) { setTimeout(() => qaOriginalEmit(...args), 350); return game.socket; }
      return qaOriginalEmit(...args);
    };
  }, actors[0].userId);
  await player.evaluate(() => {
    globalThis.qaOriginalSettingsGet = game.settings.get.bind(game.settings);
    game.settings.get = (module, key) => module === "cyberpunk-red-agent-os-modified" && key === "operationReceipts" ? undefined : qaOriginalSettingsGet(module, key);
    const app = AgentOS.ui, inner = app._renderInner.bind(app);
    app.qaDelayWalletFrame = true;
    app._renderInner = async data => {
      const html = await inner(data);
      if (app.qaDelayWalletFrame && data.view === "wallet" && data.viewData.transferring) {
        app.qaDelayWalletFrame = false;
        await new Promise(resolve => setTimeout(resolve, 700));
      }
      return html;
    };
  });
  try {
    await player.locator('[name="transfer-target"]').selectOption(`actor:${actors[1].actorUuid}`, { timeout: 15000 });
    await player.locator('[name="transfer-amount"]').fill("125");
    await player.locator('[name="transfer-memo"]').fill(transfer.memo);
    await player.locator('[data-action="transfer-send"]').click();
  } catch (error) {
    const diagnostic = await player.evaluate(() => ({ users: game.users.map(u => ({ id: u.id, character: u.character?.uuid, source: u._source.character })), options: [...document.querySelectorAll('[name="transfer-target"] option')].map(o => o.value) }));
    throw new Error(`Wallet UI for ${actors[1].actorUuid}: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  await gm.waitForFunction(ids => game.actors.get(ids[0].actorUuid.split(".")[1]).system.wealth.value === 875 && game.actors.get(ids[1].actorUuid.split(".")[1]).system.wealth.value === 1125, actors);
  await player.waitForFunction(() => !AgentOS.ui.state.transferring);
  await player.locator('[data-action="transfer-send"]').waitFor({ state: "detached", timeout: 5000 });
  assert.equal(await player.evaluate(() => qaData.operationStates().at(-1).status), "success");
  assert.equal(await player.locator(".agentos-operation-status").count(), 0);
  assert.ok((await player.locator(".agentos-tx-list").innerText()).includes("Increased by 40 to 40"));
  assert.ok((await player.locator(".agentos-tx-list").innerText()).includes("Ручная запись\nвторая строка"));
  assert.ok((await player.locator(".agentos-tx-list").innerText()).includes("Продал - Санчоус"));
  await player.evaluate(() => { Dialog.confirm = qaOriginalConfirm; game.settings.get = qaOriginalSettingsGet; delete AgentOS.ui._renderInner; });
  await gm.evaluate(() => { game.socket.emit = qaOriginalEmit; });
  assert.equal(await other.evaluate(payload => qaData.mutate("wallet.transfer", payload), transfer), false, "Cannot debit another player's actor");
  console.log("PASS: direct transfer with GM app closed and confirmation dialogs forbidden on both clients; no status strip, manual ledger rows preserved and delayed render closes the form");
  const npcUuid = await gm.evaluate(async () => {
    const npc = await Actor.create({ name: "QA Black ICE contact", type: "mook", system: {} }, { renderSheet: false });
    await qaData.mutate("garden.save", { contact: { name: npc.name, actorUuid: npc.uuid } });
    const contact = qaData.getWorld("gardenContacts").find(c => c.actorUuid === npc.uuid);
    await qaData.mutate("garden.toggleVisible", { gardenId: contact.id });
    return npc.uuid;
  });
  await player.locator('[data-action="transfer-open"]').click();
  await player.locator('[name="transfer-target"]').selectOption(`actor:${npcUuid}`);
  await player.locator('[name="transfer-amount"]').fill("20");
  await player.locator('[data-action="transfer-send"]').click();
  await player.locator('[data-action="transfer-send"]').waitFor({ state: "detached", timeout: 5000 });
  await gm.waitForFunction(id => game.actors.get(id.split(".")[1]).system.wealth.value === 855, actors[0].actorUuid);
  assert.equal(await gm.evaluate(id => game.actors.get(id.split(".")[1]).system.wealth.transactions.filter(row => row[1]?.includes("refund")).length, actors[0].actorUuid), 0);
  await gm.evaluate(() => { Dialog.confirm = qaOriginalGmConfirm; });
  console.log("PASS: payment to a real Garden mook without a system wealth ledger completes once without a refund or confirmation");
  const chatId = await player.evaluate(ids => qaData.mutate("chat.create", { name: "QA native chat", participantKeys: ids.map(x => `player:${x.userId}`) }), actors);
  assert.equal(typeof chatId, "string");
  const messageId = await player.evaluate(({ chatId, userId }) => qaData.mutate("msg.send", { chatId, senderKey: `player:${userId}`, text: "QA native message" }), { chatId, userId: actors[0].userId });
  assert.equal(typeof messageId, "string");
  await other.waitForFunction(({ chatId, id }) => qaData.getMessages(chatId).some(m => m.id === id), { chatId, id: messageId });
  assert.equal(await other.evaluate(({ chatId, userId }) => qaData.mutate("msg.send", { chatId, senderKey: `player:${userId}`, text: "forged" }), { chatId, userId: actors[0].userId }), false);
  assert.equal(await player.evaluate(({ chatId, msgId }) => qaData.mutate("msg.pin", { chatId, msgId, pinned: true }), { chatId, msgId: messageId }), false);
  assert.equal(await gm.evaluate(({ chatId, msgId }) => qaData.mutate("msg.pin", { chatId, msgId, pinned: true }), { chatId, msgId: messageId }), true);
  assert.equal(await other.evaluate(({ chatId, msgId }) => qaData.mutate("msg.react", { chatId, msgId, reaction: "👍", active: true }), { chatId, msgId: messageId }), true);
  console.log("PASS: native chat delivery, sender spoof rejection, GM pin and player reaction");
  if (effects) {
    const sceneId = await gm.evaluate(async actorUuid => {
      const scene = await Scene.create({ name: "QA canvas", width: 1200, height: 900, grid: { size: 100, type: 0 }, tokenVision: false }, { renderSheet: false });
      const actor = await fromUuid(actorUuid), token = await actor.getTokenDocument({ x: 400, y: 300, actorLink: true });
      await scene.createEmbeddedDocuments("Token", [token.toObject()]);
      await scene.activate();
      return scene.id;
    }, actors[1].actorUuid);
    for (const page of pages) {
      await page.evaluate(sceneId => game.scenes.get(sceneId).view(), sceneId);
      await page.waitForFunction(sceneId => canvas.ready && canvas.scene?.id === sceneId && canvas.tokens.placeables.length === 1, sceneId, { timeout: 45000 });
      await page.evaluate(async () => { globalThis.qaVfx = await import("/modules/cyberpunk-red-agent-os-modified/scripts/vfx.js"); });
    }
    const tokenId = await player.evaluate(() => canvas.tokens.placeables[0].id);
    await player.evaluate(({ actorUuid, chatId }) => qaVfx.triggerCall([actorUuid], chatId), { actorUuid: actors[1].actorUuid, chatId });
    for (const page of pages) await page.waitForFunction(tokenId => globalThis.__AgentDeviceCalling?.has(tokenId) && Sequencer.EffectManager.getEffects({ name: "AgentCall", object: canvas.tokens.get(tokenId) }).length >= 2, tokenId, { timeout: 30000 });
    for (const page of pages) await page.evaluate(tokenId => qaVfx.stopCallEffectLocal(tokenId), tokenId);
    for (const page of pages) await page.waitForFunction(tokenId => !globalThis.__AgentDeviceCalling?.has(tokenId) && !Sequencer.EffectManager.getEffects({ name: "AgentCall", object: canvas.tokens.get(tokenId) }).length && !Sequencer.EffectManager.getEffects({ name: "AgentCallText", object: canvas.tokens.get(tokenId) }).length, tokenId);
    console.log("PASS: native canvas tokens, Sequencer/JB2A holophone over real sockets on three clients and complete effect cleanup");
  }
  assert.equal(await player.evaluate(() => qaData.mutate("shard.create", { shard: { title: "QA HTML shard", body: "<h1>QA shard</h1><script>document.body.dataset.ready='yes'</script>", format: "html" } })), true);
  const shardId = await gm.evaluate(() => qaData.getWorld("agentShards").find(s => s.title === "QA HTML shard").id);
  const cardId = await player.evaluate(({ chatId, userId, shardId }) => qaData.mutate("msg.send", { chatId, senderKey: `player:${userId}`, text: "QA shard card", attachment: { kind: "shard", id: shardId } }), { chatId, userId: actors[0].userId, shardId });
  const imported = await other.evaluate(({ chatId, msgId }) => qaData.mutate("msg.importAttachment", { chatId, msgId }), { chatId, msgId: cardId });
  assert.equal(typeof imported, "string");
  assert.equal(await other.evaluate(({ chatId, msgId }) => qaData.mutate("msg.importAttachment", { chatId, msgId }), { chatId, msgId: cardId }), imported);
  assert.equal(await other.evaluate(shardId => qaData.mutate("shard.update", { shardId, patch: { body: "forged" } }), shardId), false);
  console.log("PASS: native shard creation, chat card snapshot, idempotent import and author-only editing");
  assert.equal(await player.evaluate(userId => qaData.mutate("id.update", { targetUserId: userId, patch: { proxyName: "QA Alias", housingRent: 0, traumaId: "tt_silver" } }), actors[0].userId), true);
  assert.equal(await other.evaluate(userId => qaData.mutate("id.update", { targetUserId: userId, patch: { realName: "forged" } }), actors[0].userId), false);
  assert.equal(await player.evaluate(() => qaData.mutate("chrome.setLayout", { actorUuid: game.user.character.uuid, layout: { sides: { qaArm: "left" }, paired: { cyberEye: true } } })), true);
  assert.equal(await other.evaluate(actorUuid => qaData.mutate("chrome.setLayout", { actorUuid, layout: {} }), actors[0].actorUuid), false);
  const balances = await gm.evaluate(ids => ids.map(a => game.actors.get(a.actorUuid.split(".")[1]).system.wealth.value), actors);
  await gm.evaluate(() => { AgentOS.ui.openApp("wallet"); AgentOS.ui.render(true); });
  await gm.locator('[data-action="monthly-send"]').waitFor();
  assert.equal(await gm.locator('[name="monthly-period"]').count(), 0);
  await gm.locator(`[name="monthly-user"][value="${actors[1].userId}"]`).uncheck();
  await gm.locator('[data-action="monthly-send"]').click();
  await gm.waitForFunction(() => qaData.operationStates().at(-1)?.op === "monthly.notify" && qaData.operationStates().at(-1)?.status === "success");
  await player.waitForFunction(() => qaData.getWorld("agentNotifications")[game.user.id]?.some(n => n.kind === "monthly"));
  assert.equal(await other.evaluate(() => (qaData.getWorld("agentNotifications")[game.user.id] || []).some(n => n.kind === "monthly")), false);
  const reminder = await player.evaluate(() => qaData.getWorld("agentNotifications")[game.user.id].find(n => n.kind === "monthly"));
  assert.equal(reminder.amount, 500);
  await player.evaluate(() => { AgentOS.ui.openApp("notifications"); AgentOS.ui.render(true); });
  await player.waitForFunction(() => document.querySelector(".view-notifications")?.textContent.includes(game.i18n.format("AGENTOS.Expenses.PaymentReminder", { amount: 500 })));
  assert.equal(await player.locator('[data-action="operation-retry"],.agentos-operation-status').count(), 0);
  assert.equal(await player.locator(".view-notifications .agentos-section-title").count(), 0);
  await player.locator(`[data-action="notification-open"][data-id="${reminder.id}"]`).click();
  await player.waitForFunction(() => document.querySelector(".view-wallet .agentos-expenses[open]"));
  assert.deepEqual(await gm.evaluate(ids => ids.map(a => game.actors.get(a.actorUuid.split(".")[1]).system.wealth.value), actors), balances);
  assert.deepEqual(await gm.evaluate(() => qaData.getWorld("monthlyNotices")), {});
  console.log("PASS: monthly payment button sends an amount notice to selected players without a billing period, bill creation or debit; notice opens expenses");
  await other.evaluate(() => game.socket.disconnect());
  await gm.waitForFunction(id => !game.users.get(id).active, actors[1].userId);
  await gm.evaluate(async id => {
    await User.create({ name: "QA shared character", role: 1, character: id.split(".")[1] });
    globalThis.qaAwardConfirm = Dialog.confirm;
    Dialog.confirm = () => { throw new Error("GM awards must not ask for confirmation"); };
  }, actors[0].actorUuid);
  for (const mode of ["phone", "tablet", "pc"]) for (const action of ["gm-award-money", "gm-award-ip"]) {
    await gm.evaluate(async mode => {
      await game.user.setFlag("cyberpunk-red-agent-os-modified", "agentMode", mode);
      await game.user.setFlag("cyberpunk-red-agent-os-modified", "agentZoom", 1.3);
      AgentOS.ui.openApp("wallet"); AgentOS.ui.render(true);
    }, mode);
    await gm.locator(`[data-action="${action}"]`).click();
    assert.equal(await gm.locator('[name="gm-award-target"]').count(), 2, "Shared assignment must not duplicate an actor");
    assert.ok(await gm.locator(".agentos-modal-card").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${mode}: award form overflow`);
    await gm.locator('[data-action="gm-award-all"]').check();
    assert.equal(await gm.locator('[name="gm-award-target"]:checked').count(), 2);
    await gm.locator('[data-action="gm-award-cancel"]').click();
  }
  const awardBefore = await gm.evaluate(ids => ids.map(a => {
    const actor = game.actors.get(a.actorUuid.split(".")[1]);
    return { wealth: actor.system.wealth.value, ip: actor.system.improvementPoints.value, rows: actor.system.wealth.transactions.length };
  }), actors);
  await gm.locator('[data-action="gm-award-money"]').click();
  await gm.locator('[data-action="gm-award-all"]').check();
  await gm.locator('[name="gm-award-sender"]').fill("QA Fixer");
  await gm.locator('[name="gm-award-amount"]').fill("100");
  await gm.locator('[name="gm-award-memo"]').fill("Group payout");
  await gm.locator('[data-action="gm-award-send"]').click();
  await gm.locator('[data-action="gm-award-send"]').waitFor({ state: "detached" });
  assert.deepEqual(await gm.evaluate(ids => ids.map(a => game.actors.get(a.actorUuid.split(".")[1]).system.wealth.value), actors), awardBefore.map(a => a.wealth + 100));
  await gm.locator('[data-action="gm-award-ip"]').click();
  assert.equal(await gm.locator('[name="gm-award-amount"]').inputValue(), "", "New IP form must not reuse the money amount");
  await gm.locator(`[name="gm-award-target"][value="${actors[1].actorUuid}"]`).check();
  await gm.locator('[name="gm-award-amount"]').fill("25");
  await gm.locator('[name="gm-award-memo"]').fill("Session award");
  await gm.locator('[data-action="gm-award-send"]').click();
  await gm.locator('[data-action="gm-award-send"]').waitFor({ state: "detached" });
  await gm.locator('[data-action="gm-award-ip"]').click();
  await gm.locator('[data-action="gm-award-all"]').check();
  await gm.locator('[name="gm-award-amount"]').fill("50");
  await gm.locator('[data-action="gm-award-send"]').click();
  await gm.locator('[data-action="gm-award-send"]').waitFor({ state: "detached" });
  assert.deepEqual(await gm.evaluate(ids => ids.map(a => game.actors.get(a.actorUuid.split(".")[1]).system.improvementPoints.value), actors), [awardBefore[0].ip + 50, awardBefore[1].ip + 75]);
  assert.deepEqual(await gm.evaluate(ids => ids.map(a => game.actors.get(a.actorUuid.split(".")[1]).system.wealth.transactions.length), actors), awardBefore.map(a => a.rows + 1));
  assert.equal(await player.evaluate(id => qaData.mutate("wallet.gmAward", { resource: "improvementPoints", actorUuids: [id], amount: 999 }), actors[0].actorUuid), false);
  await other.reload(); await other.waitForFunction(() => game.ready && globalThis.AgentOS?.ui);
  await other.evaluate(async () => { globalThis.qaData = await import("/modules/cyberpunk-red-agent-os-modified/scripts/data.js"); });
  assert.equal(await other.evaluate(() => game.user.character.system.improvementPoints.value), awardBefore[1].ip + 75);
  await gm.evaluate(async () => {
    Dialog.confirm = qaAwardConfirm;
    await game.user.setFlag("cyberpunk-red-agent-os-modified", "agentMode", "phone");
    await game.user.setFlag("cyberpunk-red-agent-os-modified", "agentZoom", 1);
  });
  console.log("PASS: GM money/IP award forms in three modes at 130%, all/subset and offline recipients, deduplicated assignments, native ledgers, no confirmations and denied player grants");
  assert.equal(await gm.evaluate(() => qaData.mutate("garden.save", { contact: { name: "QA hidden NPC" } })), true);
  assert.equal(await gm.evaluate(() => qaData.mutate("garden.save", { contact: { name: "QA public NPC" } })), true);
  const publicNPC = await gm.evaluate(() => qaData.getWorld("gardenContacts").find(c => c.name === "QA public NPC").id);
  assert.equal(await gm.evaluate(gardenId => qaData.mutate("garden.toggleVisible", { gardenId }), publicNPC), true);
  assert.equal(await player.evaluate(() => qaData.mutate("garden.save", { contact: { name: "forged NPC" } })), false);
  assert.equal(await gm.evaluate(() => qaData.mutate("ncpd.save", { record: { name: "QA public case", hidden: false, crimes: ["QA crime"], bounty: 250 } })), true);
  assert.equal(await gm.evaluate(() => qaData.mutate("ncpd.save", { record: { name: "QA hidden case", hidden: true } })), true);
  assert.equal(await gm.evaluate(() => qaData.mutate("marker.save", { marker: { label: "QA public marker", x: 25, y: 75, hidden: false } })), true);
  assert.equal(await gm.evaluate(() => qaData.mutate("marker.save", { marker: { label: "QA hidden marker", x: 50, y: 50 } })), true);
  const visibility = await player.evaluate(async () => {
    const garden = await import("/modules/cyberpunk-red-agent-os-modified/scripts/apps/garden.js");
    const ncpd = await import("/modules/cyberpunk-red-agent-os-modified/scripts/apps/ncpd.js");
    const map = await import("/modules/cyberpunk-red-agent-os-modified/scripts/apps/map.js");
    const app = { state: {} };
    return { garden: JSON.stringify(await garden.getData(app)), ncpd: JSON.stringify(await ncpd.getData(app)), map: JSON.stringify(await map.getData(app)) };
  });
  assert.ok(visibility.garden.includes("QA public NPC") && !visibility.garden.includes("QA hidden NPC"));
  assert.ok(visibility.ncpd.includes("QA public case") && !visibility.ncpd.includes("QA hidden case"));
  assert.ok(visibility.map.includes("QA public marker") && !visibility.map.includes("QA hidden marker"));
  assert.equal(await player.evaluate(() => qaData.mutate("contact.save", { contact: { name: "QA pinned contact", hasPin: true, mapX: 20, mapY: 30, fromMap: true } })), true);
  const contactId = await gm.evaluate(() => qaData.getWorld("personalContacts").find(c => c.name === "QA pinned contact").id);
  assert.equal(await player.evaluate(({ contactId, userId }) => qaData.mutate("contact.share", { contactId, userIds: [userId] }), { contactId, userId: actors[1].userId }), true);
  assert.equal(await other.evaluate(contactId => qaData.mutate("contact.delete", { contactId }), contactId), false);
  console.log("PASS: native Garden/NCPD/map visibility, pinned contact sharing and mutation permissions");
  const purchase = await player.evaluate(async () => {
    const pack = game.packs.get("cyberpunk-red-core.core_gear");
    const index = await pack.getIndex({ fields: ["system.price.market", "system.core"] });
    const row = index.find(i => !i.system.core && i.system.price.market > 0 && i.system.price.market <= 100);
    if (!row) throw new Error("No affordable core gear fixture");
    const doc = await pack.getDocument(row._id), actor = game.user.character;
    const before = actor.system.wealth.value;
    const result = await qaData.mutate("store.checkout", { actorUuid: actor.uuid, itemUuids: [doc.uuid, doc.uuid] });
    return { result, before, price: doc.system.price.market, name: doc.name };
  });
  assert.equal(purchase.result, true);
  await player.waitForFunction(p => game.user.character.system.wealth.value === p.before - p.price * 2 && game.user.character.items.some(i => i.name === p.name), purchase);
  console.log("PASS: native NC MART purchase from a real system compendium, debit and embedded inventory delivery");
  const implantIds = await gm.evaluate(async actorUuid => {
    const actor = await fromUuid(actorUuid);
    const created = await actor.createEmbeddedDocuments("Item", [
      { name: "QA Cyberarm", type: "cyberware", system: { type: "cyberArm", isFoundational: true, installedItems: { allowed: true, slots: 4 } } },
      { name: "QA Cyberarm Option", type: "cyberware", system: { type: "cyberArm", isFoundational: false } }
    ], { createInstalled: true });
    if (!await actor.installItems([created[0]])) throw new Error("QA fixture: native cyberarm installation failed");
    if (!await actor.items.get(created[0].id).installItems([created[1]])) throw new Error("QA fixture: native option installation failed");
    return created.map(i => i.id);
  }, actors[0].actorUuid);
  await player.waitForFunction(ids => game.user.character.items.get(ids[0])?.system.installedItems.list.includes(ids[1]) && game.user.character.items.get(ids[1])?.system.installedIn.includes(ids[0]), implantIds);
  const bioChrome = await player.evaluate(async () => {
    const bio = await import("/modules/cyberpunk-red-agent-os-modified/scripts/apps/bio.js");
    const chrome = await import("/modules/cyberpunk-red-agent-os-modified/scripts/apps/chrome.js");
    const app = { state: {} };
    return { bio: await bio.getData(app), chrome: await chrome.getData(app), hp: game.user.character.system.derivedStats.hp.value,
      implants: game.user.character.items.filter(i => i.name.startsWith("QA Cyberarm")).map(i => ({ id: i.id, name: i.name, installed: i.system.isInstalled, active: i.system.isInstalledInActor, parent: i.system.installedIn, children: i.system.installedItems.list })) };
  });
  assert.equal(bioChrome.bio.hpCurrent, bioChrome.hp);
  assert.ok(bioChrome.bio.trauma);
  assert.ok(JSON.stringify(bioChrome.chrome).includes("QA Cyberarm Option"), JSON.stringify(bioChrome));
  assert.ok(bioChrome.chrome.total >= 2);
  await player.evaluate(() => { AgentOS.ui.openApp("bio"); AgentOS.ui.render(true); });
  await player.locator('[data-action="tt-call"]').click();
  await gm.waitForFunction(() => game.messages.some(m => m.content.includes("TRAUMA TEAM INTERNATIONAL")));
  assert.equal(await gm.evaluate(() => game.messages.find(m => m.content.includes("TRAUMA TEAM INTERNATIONAL")).whisper.includes(game.user.id)), true);
  console.log("PASS: live CPR vitals, native nested installed cyberware and Trauma Team whisper to the GM");
  const macro = await gm.evaluate(async () => {
    const doc = await Macro.create({ name: "QA shared daemon", type: "script", scope: "global", command: "globalThis.qaDaemonRuns = (globalThis.qaDaemonRuns || 0) + 1;", ownership: { default: 2 } });
    await qaData.mutate("tools.setList", { list: [{ uuid: doc.uuid, visible: true, ownerUserId: "" }] });
    return doc.uuid;
  });
  await gm.evaluate(() => { AgentOS.ui.openApp("tools"); AgentOS.ui.render(true); });
  await gm.locator(`[data-action="tool-run"][data-uuid="${macro}"]`).click();
  assert.equal(await gm.evaluate(() => globalThis.qaDaemonRuns), 1);
  const backup = await gm.evaluate(async () => {
    const api = await import("/modules/cyberpunk-red-agent-os-modified/scripts/backup.js");
    const before = api.exportBackup();
    await api.restoreBackup(before, before.sections, "merge", {});
    const after = api.exportBackup();
    return { before: Object.fromEntries(Object.entries(before.data).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])), after: Object.fromEntries(Object.entries(after.data).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])) };
  });
  assert.deepEqual(backup.after, backup.before);
  console.log("PASS: real macro execution and metadata backup merge without duplicate records");
  for (const page of [gm, player, other]) await page.evaluate(async () => { globalThis.qaNet = await import("/modules/cyberpunk-red-agent-os-modified/scripts/arcade-network.js"); });
  await player.evaluate(() => qaNet.networkRequest("create", { kind: "connect4" }));
  await player.waitForFunction(() => qaNet.networkState().room?.kind === "connect4");
  const roomId = await player.evaluate(() => qaNet.networkState().room.id);
  await other.evaluate(roomId => qaNet.networkRequest("join", { roomId }), roomId);
  await other.waitForFunction(() => qaNet.networkState().room?.players.length === 2);
  await player.evaluate(roomId => qaNet.networkRequest("ready", { roomId }), roomId);
  await other.evaluate(roomId => qaNet.networkRequest("ready", { roomId }), roomId);
  await player.waitForFunction(() => qaNet.networkState().room.players.every(p => p.ready));
  await player.evaluate(roomId => qaNet.networkRequest("start", { roomId }), roomId);
  await other.waitForFunction(() => qaNet.networkState().room.phase === "playing");
  for (let turn = 0; turn < 7; turn++) {
    const page = turn % 2 ? other : player;
    await page.evaluate(cell => { const r = qaNet.networkState().room, p = r.players.find(p => p.id === game.user.id); qaNet.networkRequest("input", { roomId: r.id, round: r.round, entries: [{ seq: p.seq + 1, cell }] }); }, turn % 2);
    for (const peer of [player, other]) await peer.waitForFunction(count => qaNet.networkState().room.game.cells.filter(Boolean).length === count, turn + 1);
  }
  for (const page of [player, other]) {
    assert.equal(await page.evaluate(() => qaNet.networkState().room.phase), "finished");
    assert.equal(await page.evaluate(() => qaNet.networkState().room.winner), actors[0].userId);
    await page.evaluate(roomId => qaNet.networkRequest("leave", { roomId }), roomId);
  }
  console.log("PASS: real two-player FOUR LINK room, GM referee, turns and consistent victory over native sockets");
  await gm.evaluate(source => { AgentOS.ui.openApp("library"); AgentOS.ui.render(true); AgentOS.ui.promptText = async () => source; }, `${base}/qa-source/index.json`);
  await gm.locator('[data-action="lib-refresh"]').click();
  await gm.waitForFunction(() => !AgentOS.ui.state.busy && qaData.getWorld("libraryTree").some(n => n.type === "file"), null, { timeout: 45000 });
  const book = await gm.evaluate(() => qaData.getWorld("libraryTree").find(n => n.type === "file"));
  assert.ok(book.src && book.cover, "Native library download and PDF cover generation");
  await gm.evaluate(folderId => { delete AgentOS.ui.promptText; AgentOS.ui.state.folderId = folderId; AgentOS.ui.render(false); }, book.parentId);
  await gm.locator('[data-action="lib-open-file"]').click();
  const pdf = gm.frameLocator(".agentos-pdf-frame");
  await pdf.locator(".page[data-page-number='1'] canvas").waitFor({ state: "visible", timeout: 30000 });
  await gm.evaluate(async () => { for (const app of Object.values(ui.windows)) if (app.options.classes.includes("agentos-pdf-reader")) await app.close(); });
  console.log("PASS: real library index/download/upload, generated PDF cover and native PDF viewer");
  for (const [label, page] of [["GM", gm], ["Player", player]]) {
    const ids = await page.evaluate(async () => {
      const { APPS } = await import("/modules/cyberpunk-red-agent-os-modified/scripts/constants.js");
      return APPS.filter(app => game.user.isGM || !app.gmOnly).map(app => app.id).concat(["settings", "notifications"], game.user.isGM ? ["backup"] : []);
    });
    for (const id of ids) {
      await page.evaluate(id => { AgentOS.ui.openApp(id); AgentOS.ui.render(true); }, id);
      await page.waitForFunction(id => AgentOS.ui.rendered && !!document.querySelector(`.agentos-app-body.view-${id}`), id, { timeout: 15000 });
      assert.ok(await page.locator(`.agentos-app-body.view-${id}`).isVisible(), `${label}: ${id}`);
    }
    console.log(`PASS: ${label} opens ${ids.length} native module apps with real system documents`);
    await page.evaluate(() => AgentOS.ui.close());
  }
  await player.evaluate(() => { AgentOS.ui.openApp("wallet"); AgentOS.ui.render(true); });
  await player.waitForFunction(() => document.querySelector(".view-wallet"));
  await gm.evaluate(userId => game.settings.set("cyberpunk-red-agent-os-modified", "appConfig", { disabled: { [userId]: true } }), actors[0].userId);
  await player.waitForFunction(() => AgentOS.ui.isDisabled && AgentOS.ui.currentApp === null && document.querySelector(".agentos-chassis.net-off"));
  assert.equal(await player.evaluate(payload => qaData.mutate("wallet.transfer", payload), transfer), false);
  await gm.evaluate(() => game.settings.set("cyberpunk-red-agent-os-modified", "appConfig", {}));
  await player.waitForFunction(() => !AgentOS.ui.isDisabled);
  await player.evaluate(() => AgentOS.ui.openApp("admin"));
  assert.notEqual(await player.evaluate(() => AgentOS.ui.currentApp), "admin");
  await player.evaluate(() => AgentOS.ui.close());
  console.log("PASS: live device jamming, forced app exit, rejected writes while jammed, recovery and GM-only admin");
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log("PASS: GM and two independent player sessions; no browser runtime errors");
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith("agent-os-foundry-qa-"));
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
