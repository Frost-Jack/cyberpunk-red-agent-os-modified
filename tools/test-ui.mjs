/* Targeted browser regression checks. Requires Playwright and a local Foundry
 * installation for Handlebars/jQuery, but never connects to a Foundry world.
 * node tools/test-ui.mjs [playwright package path] [optional HTML example] */
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
const Handlebars = require(path.join(foundry, "node_modules/handlebars"));
const lang = JSON.parse(await readFile(path.join(root, "lang/ru.json"), "utf8"));
const localize = key => key.split(".").reduce((obj, part) => obj?.[part], lang) || key;
Handlebars.registerHelper("agEq", (a, b) => a === b);
Handlebars.registerHelper("agAnd", (a, b) => a && b);
Handlebars.registerHelper("localize", localize);
Handlebars.registerHelper("agNum", v => String(v || 0));
Handlebars.registerHelper("agDate", () => "01.01.2045");
Handlebars.registerHelper("agTime", () => "12:00");
for (const file of await readdir(path.join(root, "templates"))) {
  if (file.endsWith(".hbs")) Handlebars.registerPartial(`modules/cyberpunk-red-agent-os-modified/templates/${file}`, await readFile(path.join(root, "templates", file), "utf8"));
}
const shell = Handlebars.compile(await readFile(path.join(root, "templates/shell.hbs"), "utf8"));
const jquery = path.join(foundry, "node_modules/jquery/dist/jquery.js");
// Exercise the installed v12 positioning code and inherited window flex rules.
const coreScript = await readFile(path.join(foundry, "public/scripts/foundry.js"), "utf8");
const positionStart = coreScript.indexOf("  setPosition({left, top, width, height, scale}={}) {");
assert.ok(positionStart > 0, "Expected Foundry v12 Application#setPosition");
const nativePosition = coreScript.slice(positionStart, coreScript.indexOf("\n  }", positionStart) + 4);
const coreCss = await readFile(path.join(foundry, "public/css/style.css"), "utf8");
const windowCss = coreCss.slice(coreCss.indexOf(".app {"), coreCss.indexOf(".window-app.zhover"));
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") return res.end("<!doctype html><html><body></body></html>");
  const target = path.resolve(root, `.${pathname}`);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(target);
    res.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : "text/plain");
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1400 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.addScriptTag({ path: jquery });
  await page.addScriptTag({ path: path.join(foundry, "node_modules/handlebars/dist/handlebars.js") });
  // Foundry's global box model, without loading unrelated core applications.
  await page.addStyleTag({ content: "*, *::before, *::after { box-sizing: border-box; }" });
  await page.evaluate(async () => {
    globalThis.game = {
      user: { id: "player", isGM: false, getFlag: () => null, setFlag: async () => {} },
      users: [], settings: { get: () => false },
      i18n: { localize: key => key, format: key => key }
    };
    globalThis.foundry = { utils: {
      deepClone: value => structuredClone(value),
      debounce: (fn, ms) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
      }
    } };
    globalThis.Application = class {
      static RENDER_STATES = { RENDERING: 1 };
      setPosition(position) { return this.position = position; }
    };
    globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } };
    const hooks = new Map();
    globalThis.Hooks = {
      once() {}, on: (name, fn) => hooks.set(name, fn),
      callAll: (name, ...args) => hooks.get(name)?.(...args)
    };
    globalThis.arcade = await import("/scripts/apps/arcade.js");
    await import("/scripts/main.js");
  });
  const render = async (view, viewData, zoom = 1, mode = "phone") => {
    const content = shell({ mode, theme: "red", zoom, view, viewTitle: view, viewData });
    await page.evaluate(html => { $(document.body).off(); document.body.innerHTML = html; }, content);
    if (!await page.locator("style[data-test-style]").count()) {
      const style = await page.addStyleTag({ url: `${base}/styles/agent.css` });
      await style.evaluate(el => el.dataset.testStyle = "true");
    }
  };

  // Deliberately hostile selectors/scripts must remain confined to this iframe.
  const source = '<html><head><style>body,button{background:rgb(1,2,3)!important;color:rgb(250,0,0)!important}</style></head><body><button>HTML</button><script>document.body.dataset.script="ran";try{parent.document.body.dataset.escaped="yes"}catch(e){document.body.dataset.blocked="yes"}</script></body></html>';
  await render("datapool", { viewing: true, isHtml: true, shard: { title: "HTML", body: source } });
  const before = await page.locator(".agentos-titlebar button").first().evaluate(el => getComputedStyle(el).backgroundColor);
  await page.evaluate(async html => {
    const { shardDocument } = await import("/scripts/shard-html.js");
    document.querySelector("iframe").srcdoc = shardDocument(html);
  }, source);
  const frame = page.frameLocator(".agentos-shard-html");
  await frame.locator("body[data-script=ran][data-blocked=yes]").waitFor();
  assert.equal(await page.locator("body").getAttribute("data-escaped"), null);
  assert.equal(await frame.locator("button").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(1, 2, 3)");
  assert.equal(await page.locator(".agentos-titlebar button").first().evaluate(el => getComputedStyle(el).backgroundColor), before);
  const sandbox = (await page.locator("iframe").getAttribute("sandbox")).split(" ");
  assert.ok(sandbox.includes("allow-scripts") && sandbox.includes("allow-forms"));
  assert.equal(sandbox.includes("allow-same-origin"), false, "Shard scripts must remain isolated from Foundry");
  console.log("PASS: HTML styles and inline scripts isolated from the parent document");

  if (process.argv[3]) {
    const example = await readFile(process.argv[3], "utf8");
    await page.evaluate(async html => {
      const { shardDocument } = await import("/scripts/shard-html.js");
      document.querySelector("iframe").srcdoc = shardDocument(html);
    }, example);
    await frame.locator("#registry tbody tr").first().waitFor();
    assert.equal(await frame.locator("#registry tbody tr").count(), 20);
    assert.equal(await frame.locator("style").count(), 3);
    assert.equal(await page.locator(".agentos-titlebar button").first().evaluate(el => getComputedStyle(el).backgroundColor), before);
    console.log("PASS: supplied complete HTML example, all styles and 20 table records preserved");
  }

  // Exercise the real compose/edit handlers, not just the preview markup.
  for (const isGM of [false, true]) {
    for (const editing of [false, true]) {
      const data = await page.evaluate(async ({ isGM, editing }) => {
        globalThis.datapool = await import("/scripts/apps/datapool.js");
        game.user.isGM = isGM;
        game.users = Object.assign([game.user], { get: id => id === game.user.id ? game.user : null });
        const saved = { id: "saved", title: "Original", body: "Original body", format: "plain", createdBy: "player", ts: 1 };
        game.settings.get = (module, key) => key === "agentShards" ? [saved] : false;
        globalThis.shardCalls = [];
        globalThis.shardRenders = 0;
        globalThis.shardApp = {
          state: editing ? { shardId: saved.id } : {},
          render() { shardRenders++; },
          mutate(op, payload) { shardCalls.push({ op, payload }); return Promise.resolve(true); }
        };
        return datapool.getData(shardApp);
      }, { isGM, editing });
      if (editing) assert.equal(data.canEdit, true, `Edit fixture missing permissions: ${JSON.stringify(data)}`);
      await render("datapool", data, 1.3);
      await page.evaluate(() => datapool.activateListeners(shardApp, $(document.body)));
      await page.locator(`[data-action=${editing ? "shard-edit" : "shard-compose"}]`).click();
      await render("datapool", await page.evaluate(() => datapool.getData(shardApp)), 1.3);
      await page.evaluate(() => datapool.activateListeners(shardApp, $(document.body)));
      await page.locator("[name=shard-title]").fill("Draft title");
      await page.locator("[name=shard-body]").fill("# Preview\n**Bold**\n- Entry\n<script>not HTML</script>");
      await page.locator("[name=shard-format]").selectOption("markdown");
      await page.locator("[name=shard-body]").evaluate(el => el.setSelectionRange(2, 8));
      const previewButton = page.locator('[data-action=shard-compose-mode][data-mode=preview]');
      const editorButton = page.locator('[data-action=shard-compose-mode][data-mode=editor]');
      await previewButton.click();
      const preview = page.locator(".agentos-shard-preview");
      assert.equal(await preview.locator("h1").textContent(), "Preview");
      assert.equal(await preview.locator("strong").textContent(), "Bold");
      assert.equal(await preview.locator("script").count(), 0);
      assert.equal(await page.locator("[name=shard-body]").isVisible(), false);
      assert.equal(await page.evaluate(() => shardRenders), 1, "Preview must not re-render the Agent");
      assert.equal(await page.evaluate(() => shardCalls.length), 0, "Preview must not save or relay to the GM");
      assert.ok(await page.locator(".agentos-modal-card").evaluate(el => el.scrollWidth <= el.clientWidth + 1), "Preview overflows the phone modal");
      await page.locator("[name=shard-format]").selectOption("plain");
      assert.equal(await preview.locator("h1").count(), 0);
      assert.ok((await preview.textContent()).includes("# Preview"));
      await editorButton.click();
      assert.deepEqual(await page.locator("[name=shard-body]").evaluate(el => [el.selectionStart, el.selectionEnd]), [2, 8]);
      assert.equal(await preview.locator("*").count(), 0);
      await page.locator("[name=shard-body]").fill(source);
      await page.locator("[name=shard-format]").selectOption("html");
      await previewButton.click();
      await page.frameLocator(".agentos-shard-preview iframe").locator("body[data-script=ran][data-blocked=yes]").waitFor();
      await preview.locator("iframe").evaluate(el => el.dataset.testIdentity = "same");
      await page.locator("[name=shard-title]").fill("Final title");
      await previewButton.click();
      if (isGM && editing) {
        await page.evaluate(async () => {
          Object.assign(shardApp, { rendered: true, currentApp: "datapool" });
          globalThis.AgentOS = { ui: shardApp };
          Hooks.callAll("updateSetting", { key: "cyberpunk-red-agent-os-modified.agentMessages" });
          await Hooks.callAll("cyberpunk-red-agent-os-modified.notify", { kind: "message", authorUserId: "player", participantUserIds: ["player"] });
        });
        await page.waitForTimeout(150); // beyond the refresh debounce
        assert.equal(await page.evaluate(() => shardRenders), 1, "Chat activity must not interrupt an HTML preview");
      }
      assert.equal(await preview.locator("iframe").getAttribute("data-test-identity"), "same", "Unchanged HTML must not restart");
      assert.equal(await page.locator("body").getAttribute("data-escaped"), null);
      if (process.env.AGENTOS_TEST_SCREENSHOT_DIR && isGM && editing) {
        await page.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, "agentos-shard-preview.png") });
      }
      await page.locator("[data-action=shard-create]").click();
      const calls = await page.evaluate(() => shardCalls);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].op, editing ? "shard.update" : "shard.create");
      const saved = editing ? calls[0].payload.patch : calls[0].payload.shard;
      assert.equal(saved.body, source);
      assert.equal(saved.format, "html");
      assert.equal(saved.title, "Final title");
    }
  }
  await page.evaluate(() => { game.user.isGM = false; game.settings.get = () => false; });
  console.log("PASS: HTML/Markdown/plain previews create and edit drafts for both roles without renders or writes");

  const ids = ["mine", "snake", "runner", "netduel", "quickhack", "simon", "g2077", "breach", "dodge", "decrypt", "firewall", "heist", "sprawl"];
  for (const zoom of [1, 1.3]) {
    for (const id of ids) {
      const data = await page.evaluate(async game => {
        arcade.onClose();
        globalThis.testApp = { state: { game }, deviceMode: "phone", render() {} };
        return arcade.getData(testApp);
      }, id);
      await render("arcade", data, zoom);
      await page.evaluate(() => arcade.activateListeners(testApp, $(document.body)));
      await page.locator("[data-action=game-reset]").click();
      const overflow = await page.locator(".agentos-app-body").evaluate(el => el.scrollWidth - el.clientWidth);
      assert.ok(overflow <= 1, `${id} at ${zoom}: horizontal overflow ${overflow}`);
      const buttons = page.locator("[data-arcade-key]");
      for (let i = 0; i < await buttons.count(); i++) {
        const box = await buttons.nth(i).boundingBox();
        assert.ok(box.width >= 43 * zoom && box.height >= 43 * zoom, `${id}: small touch control`);
      }
      if (await buttons.count()) await buttons.first().tap();
      if (id === "mine") {
        await page.locator("[data-action=mine-flag-mode]").tap();
        await page.locator(".agentos-mine-cell").first().tap();
        assert.equal(await page.locator(".agentos-mine-cell.flag").count(), 1);
      }
      if (id === "g2077") {
        const stage = await page.locator(".agentos-2077-board").boundingBox();
        for (const tile of await page.locator("[data-tile]").all()) {
          const box = await tile.boundingBox();
          assert.ok(box.x >= stage.x && box.x + box.width <= stage.x + stage.width + 1, "2077 tile exceeds board");
        }
      }
      if (id === "snake" && zoom === 1.3) {
        const jammed = await page.evaluate(async () => {
          const { AgentOSApplication } = await import("/scripts/agent-app.js");
          const read = game.settings.get, clear = window.clearInterval;
          let stopped = 0;
          window.clearInterval = id => { stopped++; clear(id); };
          game.settings.get = (module, key) => key === "appConfig" ? { disabled: { player: true } } : read(module, key);
          try {
            const app = new AgentOSApplication();
            app.currentApp = "arcade"; app.state = { game: "snake" };
            const data = await app.getData();
            return { stopped, disabled: data.disabled, view: data.view };
          } finally { game.settings.get = read; window.clearInterval = clear; }
        });
        assert.equal(jammed.disabled, true);
        assert.equal(jammed.view, "home");
        assert.ok(jammed.stopped > 0, "Jamming must stop game timers, not leave them running in the background");
      }
      if (process.env.AGENTOS_TEST_SCREENSHOT_DIR && zoom === 1.3 && ["g2077", "mine"].includes(id)) {
        await page.waitForTimeout(250); // let the tile slide/merge animation finish
        await page.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, `agentos-${id}.png`) });
      }
    }
    console.log(`PASS: all 13 games fit phone layout at ${Math.round(zoom * 100)}%, touch controls and flag mode work`);
  }
  await page.evaluate(() => arcade.onClose());

  const rarities = [{ id: "premium", label: "Премиальная", selected: true }, { id: "", label: "Без ограничений" }];
  await render("admin", { rarities, playerPrices: [{ id: "player", name: "Player", rarities, markup: -10 }], sourceFilter: "all" }, 1.3);
  assert.ok(await page.locator(".agentos-app-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), "Admin pricing rows overflow phone");
  assert.equal(await page.locator("[data-action=admin-player-rarity]").count(), 1);
  assert.equal(await page.locator("details.agentos-store-legacy").getAttribute("open"), null);
  await render("store", { loading: false, categories: [{ id: "custom", label: "Очень длинное название компендиума", active: true }], items: [], balance: 1000 }, 1.3);
  const storeSizes = await page.locator(".agentos-app-body").evaluate(el => ({
    width: el.clientWidth, scroll: el.scrollWidth,
    elements: [...el.querySelectorAll("*")].filter(e => e.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map(e => ({ cls: e.className, width: e.clientWidth, scroll: e.scrollWidth }))
  }));
  assert.ok(storeSizes.scroll <= storeSizes.width + 1, `Store controls overflow phone: ${JSON.stringify(storeSizes)}`);
  console.log("PASS: store browsing controls and rarity/pricing fields fit the phone");

  // Chat usability uses the same permission/data handlers as the existing UI.
  const paintChat = async () => {
    const data = await page.evaluate(() => chat.getData(chatApp));
    await render("chat", data, 1.3);
    await page.evaluate(() => { chatApp.element = $(document.body); chat.activateListeners(chatApp, $(document.body)); });
  };
  for (const isGM of [false, true]) {
    await page.evaluate(async isGM => {
      globalThis.chat = await import("/scripts/apps/chat.js");
      const mkUser = (id, gm = false) => {
        const flags = {};
        return { id, name: id, isGM: gm, character: gm ? null : { uuid: `Actor.${id}`, name: id, img: "icons/svg/mystery-man.svg" },
          getFlag: (module, key) => flags[key], setFlag: async (module, key, value) => { flags[key] = value; } };
      };
      const users = [mkUser("player"), mkUser("other"), mkUser("gm", true)];
      game.users = Object.assign(users, { get: id => users.find(u => u.id === id) });
      game.user = users.find(u => u.isGM === isGM);
      const participants = [{ key: "player:player", kind: "player", userId: "player" }, { key: "garden:npc", kind: "garden", gardenId: "npc" }, { key: "garden:second", kind: "garden", gardenId: "second" }];
      globalThis.chatWorld = {
        agentChats: { a: { id: "a", name: "Alpha", ts: 1, participants, folderIds: { player: "folder", gm: "folder" } }, b: { id: "b", name: "Beta", ts: 2, participants } },
        agentMessages: { a: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, ts: i + 1, senderKey: "garden:npc", authorUserId: "gm", text: `${i === 5 || i === 25 ? "needle " : ""}Message ${i}` })), b: [] },
        chatFolders: [{ id: "folder", name: "Folder", ownerUserId: game.user.id }],
        gardenContacts: [{ id: "npc", name: "Fixer", visible: true }, { id: "second", name: "Courier", visible: true }], idProfiles: {}
      };
      game.settings.get = (module, key) => chatWorld[key] ?? false;
      globalThis.chatCalls = []; globalThis.chatWarnings = []; globalThis.sendResult = false;
      globalThis.ui = { notifications: { warn: text => chatWarnings.push(text) } };
      globalThis.chatApp = { state: { chatId: "a" }, currentApp: "chat", rendered: true, zoom: 1.3,
        render() {}, confirm: async () => true, pickFile: async () => "test.webp",
        mutate: async (op, payload) => { chatCalls.push({ op, payload }); return sendResult; } };
    }, isGM);
    await paintChat();
    if (isGM) {
      await page.locator("[data-action=voice-toggle]").click(); await paintChat();
      await page.locator('[data-action=voice-pick][data-key="garden:second"]').click(); await paintChat();
    }
    await page.locator("[name=chat-input]").fill("Draft Alpha");
    await page.locator("[name=chat-input]").evaluate(el => el.setSelectionRange(2, 6));
    await page.locator(".agentos-chat-scroll").evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    await page.evaluate(() => chatWorld.agentMessages.a.push({ id: "new", ts: Date.now(), senderKey: "garden:npc", authorUserId: "other", text: "New message" }));
    await paintChat();
    assert.equal(await page.locator("[name=chat-input]").inputValue(), "Draft Alpha");
    assert.equal(await page.locator("[name=chat-input]").evaluate(el => document.activeElement === el), true);
    assert.deepEqual(await page.locator("[name=chat-input]").evaluate(el => [el.selectionStart, el.selectionEnd]), [2, 6]);
    assert.ok(await page.locator(".agentos-chat-scroll").evaluate(el => el.scrollTop < 10), "Incoming messages must not move a reader to the bottom");
    await page.locator("[data-action=chat-search-toggle]").click();
    await page.locator("[name=message-search]").fill("needle");
    assert.equal(await page.locator(".agentos-msg-row.search-match").count(), 2);
    await page.locator('[data-action=chat-search-step][data-step="1"]').click();
    assert.equal(await page.locator(".agentos-chat-match-count").textContent(), "2/2");
    await page.locator("[data-action=chat-search-toggle]").click();
    await page.locator(".agentos-chat-scroll").evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    await page.locator("[data-action=chat-latest]").click();
    assert.ok(await page.locator(".agentos-chat-scroll").evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop < 3));
    await page.locator("[data-action=chat-back]").click(); await paintChat();
    assert.equal(await page.locator(".agentos-draft-label").count(), 1);
    await page.locator("[name=chat-search]").fill("Beta");
    await page.waitForTimeout(200);
    await paintChat();
    assert.equal(await page.locator("[data-action=chat-open]").count(), 1);
    await page.locator('[data-action=chat-open][data-chat-id="b"]').click(); await paintChat();
    await page.locator("[name=chat-input]").fill("Draft Beta");
    await page.locator("[data-action=chat-back]").click(); await paintChat();
    await page.locator('[data-action=chat-open][data-chat-id="a"]').click(); await paintChat();
    assert.equal(await page.locator("[name=chat-input]").inputValue(), "Draft Alpha");
    await page.evaluate(() => { sendResult = new Promise(resolve => { globalThis.confirmChatSend = resolve; }); });
    await page.locator("[data-action=chat-send]").click();
    await page.locator("[data-action=chat-back]").click(); await paintChat();
    await page.locator('[data-action=chat-open][data-chat-id="a"]').click(); await paintChat();
    assert.equal(await page.locator("[data-action=chat-send]").isDisabled(), true);
    await page.locator("[name=chat-input]").fill("New draft during send");
    await page.evaluate(() => confirmChatSend("confirmed"));
    await paintChat();
    assert.equal(await page.locator("[name=chat-input]").inputValue(), "New draft during send", "Acknowledgements must not erase a newer draft after navigation");
    await page.locator("[name=chat-input]").fill("Draft Alpha");
    await page.evaluate(() => { sendResult = false; });
    await page.locator("[data-action=chat-send]").click(); await paintChat();
    assert.equal(await page.locator("[name=chat-input]").inputValue(), "Draft Alpha", "Rejected sends keep the draft");
    assert.equal(await page.evaluate(() => chatWarnings.length), 1);
    await page.evaluate(() => { sendResult = "sent-message"; });
    await page.locator("[data-action=chat-send]").click(); await paintChat();
    assert.equal(await page.locator("[name=chat-input]").inputValue(), "");
    assert.equal(await page.evaluate(() => chatCalls.at(-1).payload.senderKey), isGM ? "garden:second" : "player:player");
    assert.equal(await page.locator("[data-action=chat-rename]").count(), isGM ? 1 : 0);
    if (process.env.AGENTOS_TEST_SCREENSHOT_DIR && !isGM) await page.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, "agentos-chat-updated.png") });
    if (isGM) {
    await page.locator('.agentos-msg-row[data-msg-id="m1"]').click({ button: "right" });
      assert.equal(await page.locator(".agentos-ctx-menu button").count(), 2, "GM edit/delete menu remains available");
      await page.locator(".agentos-ctx-menu button").first().click(); await paintChat();
      assert.equal(await page.locator("[name=msg-edit-text]").inputValue(), "Message 1");
    }
  }
  console.log("PASS: chat drafts, searches, stable reading/focus, failed sends and GM permissions");

  const product = { uuid: "test", name: "A long item name", shownPrice: 100, img: "icons/svg/item-bag.svg" };
  for (const mode of ["phone", "tablet", "pc"]) {
    const view = { loading: false, cart: Array(12).fill(product), cartCount: 12, total: 1200, balance: 10000, canBuy: true, buyerUuid: "Actor.player", items: Array(24).fill(product), categories: [] };
    await render("store", view, 1, mode);
    assert.ok(await page.locator(".agentos-app-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${mode}: store overflow`);
    const catalog = await page.locator(".agentos-store-catalog").boundingBox();
    if (mode === "phone") {
      assert.equal(await page.locator(".agentos-store-cart-summary").isVisible(), true);
      assert.equal(await page.locator(".agentos-mini-cart li").count(), 12);
      assert.equal(await page.locator(".agentos-cart").isVisible(), false);
      await render("store", { ...view, cartOpen: true }, 1, mode);
      assert.equal(await page.locator(".agentos-cart").isVisible(), true);
    } else {
      const cart = await page.locator(".agentos-cart").boundingBox();
      const body = await page.locator(".agentos-app-body").boundingBox();
      assert.ok(cart.x >= catalog.x + catalog.width, `${mode}: cart must be beside the catalog`);
      assert.ok(cart.y + cart.height <= body.y + body.height + 1, `${mode}: cart exceeds device height`);
      await page.locator(".agentos-store-catalog").evaluate(el => { el.scrollTop = el.scrollHeight; });
      const after = await page.locator(".agentos-cart").boundingBox();
      assert.ok(Math.abs(after.y - cart.y) < 1, "Cart must remain visible while browsing");
    }
    if (process.env.AGENTOS_TEST_SCREENSHOT_DIR) await page.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, `agentos-cart-${mode}.png`) });
  }
  await page.evaluate(({ nativePosition, windowCss }) => {
    const style = document.createElement("style");
    style.textContent = windowCss;
    document.head.insertBefore(style, document.querySelector("style[data-test-style]"));
    Math.clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    Application.prototype.setPosition = new Function("MIN_WINDOW_WIDTH", "MIN_WINDOW_HEIGHT", `return class {${nativePosition}}.prototype.setPosition`)(200, 50);
  }, { nativePosition, windowCss });
  const sizeChat = await page.evaluate(() => {
    chatApp.state = { chatId: "a" };
    return chat.getData(chatApp);
  });
  // The existing window stays mounted as it does during Foundry _replaceHTML.
  // Delayed image loads, native setPosition calls and oversized stale positions
  // must not let the current app's content decide the chassis dimensions.
  for (const viewport of [{ width: 2400, height: 1600 }, { width: 1366, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const mode of ["phone", "tablet", "pc"]) {
      for (const zoom of [0.75, 0.85, 1, 1.15, 1.3, 1.5]) {
        await page.evaluate(async ({ mode, zoom }) => {
          const { AgentOSApplication } = await import("/scripts/agent-app.js");
          $(document.body).off();
          document.body.innerHTML = '<div class="app window-app agentos-window"><header class="window-header">Foundry</header><section class="window-content"></section></div>';
          game.user.getFlag = (module, key) => key === "agentMode" ? mode : key === "agentZoom" ? zoom : null;
          globalThis.sizeApp = new AgentOSApplication();
          sizeApp.element = $(".agentos-window");
          sizeApp.options = { resizable: false, height: 762 };
          sizeApp.popOut = true;
          sizeApp.position = { width: 450, height: 762, left: 0, top: 0, scale: 1 };
        }, { mode, zoom });
        let reference;
        const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000"/>');
        const store = { cart: Array(12).fill(product), cartCount: 12, total: 1200, items: Array(24).fill(product), categories: [], canBuy: true };
        for (const [view, viewData] of [["chat", sizeChat], ["map", { mapImage: image, markerScale: 1 }], ["store", store], ["chat", sizeChat], ["map", {}], ["store", { ...store, cartOpen: true }]]) {
          const html = shell({ mode, theme: "red", zoom, view, viewTitle: view, viewData });
          const measurements = await page.evaluate(async ({ html, view }) => {
            const bounds = () => [".agentos-window", ".agentos-chassis"].map(selector => {
              const r = document.querySelector(selector).getBoundingClientRect();
              return [r.x, r.y, r.width, r.height];
            });
            document.querySelector(".window-content").innerHTML = html;
            sizeApp.currentApp = view;
            sizeApp._ensureWindowSize();
            sizeApp.setPosition(sizeApp.position);
            const beforeImages = bounds();
            await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
            await new Promise(requestAnimationFrame);
            const afterImages = bounds();
            sizeApp.setPosition({ width: 5000, height: 5000 });
            return { beforeImages, afterImages, afterNativeResize: bounds() };
          }, { html, view });
          reference ??= measurements.beforeImages;
          if (viewport.height === 1600) {
            const dims = { phone: [390, 700], tablet: [680, 790], pc: [1020, 640] }[mode];
            assert.ok(Math.abs(reference[1][2] - dims[0] * zoom) < 1, `${mode}/${zoom}: chosen chassis width`);
            assert.ok(Math.abs(reference[1][3] - dims[1] * zoom) < 1, `${mode}/${zoom}: chosen chassis height`);
          }
          for (const rects of Object.values(measurements)) {
            for (let i = 0; i < rects.length; i++) {
              for (let j = 0; j < rects[i].length; j++) assert.ok(Math.abs(rects[i][j] - reference[i][j]) < 1,
                `${mode}/${zoom}/${viewport.width}/${view}: window/chassis moved or resized: ${JSON.stringify({ reference, rects })}`);
            }
          }
        }
      }
    }
  }
  console.log("PASS: actual window/chassis bounds stable across chat/map/store, 3 modes, 6 scales including 130%, 2 viewports (native v12 positioning/CSS)");
  /* Explicit external resize requests cannot override the selected size. */
  const sizes = await page.evaluate(async () => {
    const { AgentOSApplication } = await import("/scripts/agent-app.js");
    const getFlag = game.user.getFlag;
    const result = [];
    try {
      for (const mode of ["phone", "tablet", "pc"]) {
        game.user.getFlag = (module, key) => key === "agentMode" ? mode : key === "agentZoom" ? 1.3 : null;
        const app = new AgentOSApplication();
        app.element = $(".agentos-window");
        app.options = { resizable: false, height: 762 };
        app.popOut = true;
        app.position = { left: 0, top: 0, scale: 1 };
        const before = { ...app.setPosition({ width: 200, height: 200 }) };
        app.currentApp = "store";
        const after = { ...app.setPosition({ width: 5000, height: 5000, left: 0, top: 0 }) };
        result.push({ before, after });
      }
    } finally { game.user.getFlag = getFlag; }
    return result;
  });
  for (const { before, after } of sizes) {
    assert.equal(after.width, before.width); assert.equal(after.height, before.height);
    assert.equal(after.left, 0); assert.equal(after.top, 0);
  }
  console.log("PASS: permanent adaptive cart and fixed window footprint in all device modes");
  await page.setViewportSize({ width: 1500, height: 1400 });
  for (const mode of ["phone", "tablet", "pc"]) {
    for (const state of ["gm", "following", "independent"]) {
      const data = await page.evaluate(async state => {
        game.user.isGM = state === "gm";
        game.user.getFlag = (module, key) => key === "radioIgnoreBroadcast" && state === "independent";
        game.settings.get = (module, key) => key === "radioBroadcast" ? { active: true } : false;
        return (await import("/scripts/apps/radio.js")).getData({});
      }, state);
      await render("radio", data, 1.3, mode);
      const toggle = page.locator(`[data-action=${state === "gm" ? "radio-takeover" : "radio-follow-toggle"}]`);
      assert.equal(await toggle.count(), 1);
      assert.notEqual(await toggle.locator("span").evaluate(el => getComputedStyle(el).color), "rgb(0, 0, 0)");
      assert.ok(await toggle.evaluate(el => {
        const r = el.getBoundingClientRect(), body = el.closest(".agentos-app-body").getBoundingClientRect();
        return r.x >= body.x && r.right <= body.right + 1;
      }), `${mode}/${state}: radio toggle overflows device`);
      if (state !== "gm") assert.equal(await toggle.getAttribute("aria-pressed"), String(state === "following"));
      if (process.env.AGENTOS_TEST_SCREENSHOT_DIR && mode === "phone" && state === "independent")
        await page.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, "agentos-radio-local.png") });
    }
  }
  console.log("PASS: GM takeover and personal radio sync controls fit all modes at 130%");
  // Exercise the real shell controller, rather than a screenshot-only layout.
  await page.evaluate(async language => {
    Application.prototype.activateListeners = () => {};
    foundry.utils.getProperty = (object, path) => path.split(".").reduce((o, key) => o?.[key], object);
    globalThis.Draggable = class {};
    const flags = { agentZoom: 1.3, agentMode: "phone" };
    game.user = { id: "a", isGM: false, character: { uuid: "Actor.a", name: "V" }, getFlag: (m, k) => k.split(".").reduce((o, key) => o?.[key], flags), setFlag: async (m, k, v) => { const path = k.split("."), last = path.pop(); let target = flags; for (const key of path) target = target[key] ||= {}; target[last] = v; } };
    game.i18n.localize = key => key.split(".").reduce((o, k) => o?.[k], language) || key;
    game.world = { id: "ui-world" };
    game.users = Object.assign([game.user], { get: id => id === "a" ? game.user : null });
    globalThis.newWorld = {
      agentChats: { chat: { id: "chat", name: "Crew", participants: [{ key: "player:a", kind: "player", userId: "a" }] } },
      agentMessages: { chat: Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, text: `Line ${i}`, ts: i, senderKey: "player:a", authorUserId: "a" })) },
      agentShards: [{ id: "s", title: "Shard card", body: "<script>unsafe</script>\nBody", format: "plain", createdBy: "a" }],
      personalContacts: [{ id: "ct", name: "Fixer", ownerUserId: "a", hasPin: true, mapX: 25, mapY: 40 }],
      idProfiles: {}, agentNotifications: {}, gardenContacts: [], contactFolders: [], datapoolFolders: [], chatFolders: []
    };
    game.settings.get = (m, key) => newWorld[key] || false;
    const { AgentOSApplication } = await import("/scripts/agent-app.js");
    globalThis.device = new AgentOSApplication();
    device.currentApp = "chat"; device.state = { chatId: "chat" }; device.render = () => {}; device._ensureWindowSize = () => {};
    device.element = $(document.body);
    globalThis.deviceFlags = flags;
  }, lang);
  const paintDevice = async () => {
    const data = await page.evaluate(() => device.getData());
    await page.evaluate(html => { $(document.body).off(); document.body.innerHTML = html; device.element = $(document.body); device.activateListeners($(document.body)); }, shell(data));
  };
  for (const mode of ["phone", "tablet", "pc"]) {
    await page.evaluate(mode => { deviceFlags.agentMode = mode; device.sideApp = null; device.currentApp = "chat"; device.state = { chatId: "chat" }; }, mode);
    await paintDevice();
    const before = await page.locator(".agentos-chassis").boundingBox();
    await page.locator("[name=chat-input]").fill("Keep this draft");
    await page.locator("[name=chat-input]").evaluate(e => e.setSelectionRange(2, 5));
    await page.locator(".agentos-chat-scroll").evaluate(e => { e.scrollTop = 30; e.dispatchEvent(new Event("scroll")); });
    await page.locator("[data-action=chat-side-toggle]").click(); await paintDevice();
    assert.equal(await page.locator(".agentos-side-pane").count(), 1);
    const after = await page.locator(".agentos-chassis").boundingBox();
    assert.deepEqual(after, before, `${mode}: opening a side pane must keep the chassis bounds`);
    assert.equal(await page.locator("[name=chat-input]").inputValue(), "Keep this draft");
    const side = page.locator(".agentos-side-pane");
    await side.locator("[data-action=share-object]").first().click(); await paintDevice();
    assert.equal(await page.evaluate(() => device.state.attachment.id), "s");
    await page.locator("[data-action=chat-attach-clear]").click(); await paintDevice();
    const drag = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData("text/plain", JSON.stringify({ shard: "s" })); return d; });
    await page.locator(".agentos-thread").dispatchEvent("drop", { dataTransfer: drag }); await paintDevice();
    assert.equal(await page.evaluate(() => device.state.attachment.kind), "shard");
    assert.equal(await page.evaluate(() => newWorld.agentShards.length), 1, "Sharing and previewing must not import a shard");
    if (await page.locator(".agentos-side-pane [data-action=chat-side-toggle]").count()) await page.locator(".agentos-side-pane [data-action=chat-side-toggle]").click();
    await paintDevice();
    await page.evaluate(() => device.openApp("wallet")); await paintDevice();
    await page.evaluate(() => device.openApp("chat")); await paintDevice();
    assert.equal(await page.locator("[name=chat-input]").inputValue(), "Keep this draft");
    assert.equal(await page.evaluate(() => device.state.chatId), "chat");
    assert.ok(await page.locator(".agentos-chat-scroll").evaluate(e => Math.abs(e.scrollTop - 30) < 3));
    assert.equal(await page.locator("[name=chat-input]").evaluate(e => document.activeElement === e), true);
    if (process.env.AGENTOS_TEST_SCREENSHOT_DIR) await page.locator(".agentos-chassis").screenshot({ path: path.join(process.env.AGENTOS_TEST_SCREENSHOT_DIR, `agentos-chat-${mode}.png`) });
  }
  console.log("PASS: real shell side panes, card drag/share, draft/focus/scroll restoration, fixed bounds in 3 modes at 130%");
  const foreignBackup = await page.evaluate(async () => {
    game.user.isGM = true;
    deviceFlags.agentMode = "tablet";
    device.openApp("backup");
    const backup = (await import("/scripts/backup.js")).exportBackup(["contacts", "datapool"]);
    backup.worldId = "other-world";
    return backup;
  });
  await paintDevice();
  await page.locator("[name=backup-file]").setInputFiles({ name: "agent.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreignBackup)) });
  await page.waitForFunction(() => !!device.state.backup); await paintDevice();
  await page.locator("[data-action=backup-map-user]").selectOption("a"); await paintDevice();
  await page.locator("[data-action=backup-preview]").click();
  await page.waitForFunction(() => !!device.state.plan || !!device.state.error);
  assert.equal(await page.evaluate(() => device.state.error), ""); await paintDevice();
  assert.equal(await page.evaluate(() => device.state.plan.added), 2);
  assert.equal(await page.locator("[data-action=backup-restore]").count(), 1);
  assert.equal(await page.evaluate(() => newWorld.agentShards.length), 1, "Preview makes no writes");
  await page.evaluate(() => {
    newWorld.agentNotifications = { a: [{ id: "notice", ts: Date.now(), kind: "monthly", period: "2045-3", amount: 800, title: "<img src=x onerror=alert(1)>" }] };
    device.openApp("notifications");
  });
  await paintDevice();
  assert.equal(await page.locator(".view-notifications img").count(), 0, "Notification titles must be escaped");
  await page.locator("[data-action=notification-read]").click(); await paintDevice();
  assert.equal(await page.locator(".view-notifications .unread").count(), 0);
  await page.locator(".view-notifications summary").click();
  await page.locator('[data-action=notification-mute][data-category="monthly"]').check();
  assert.equal(await page.evaluate(() => deviceFlags.notificationMuted.monthly), true);
  await page.locator("[data-action=notification-clear]").click(); await paintDevice();
  assert.equal(await page.locator("[data-action=notification-open]").count(), 0);
  console.log("PASS: backup file selection, explicit cross-world mapping and read-only preview; safe notification text/read/mute/clear");
  assert.deepEqual(errors, [], `Browser errors: ${errors.join("; ")}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
