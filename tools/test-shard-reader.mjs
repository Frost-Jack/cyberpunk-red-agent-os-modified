/* Real installed v12 Application/Draggable and generated media on two local
 * origins. Never connects to a Foundry world or changes world documents. */
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const foundry = process.env.FOUNDRY_APP || path.join(process.env.ProgramFiles, "Foundry Virtual Tabletop/resources/app");
const core = (await readFile(path.join(foundry, "public/scripts/foundry.js"), "utf8")).replaceAll("\r\n", "\n");
const nativeClass = name => { const start = core.indexOf(`class ${name} {`); assert.ok(start >= 0); return core.slice(start, core.indexOf("\n}\n", start) + 2); };
const appTemplate = await readFile(path.join(foundry, "templates/app-window.html"), "utf8");
const readerTemplate = await readFile(path.join(root, "templates/shard-reader.hbs"), "utf8");
const lang = JSON.parse(await readFile(path.join(root, "lang/ru.json"), "utf8"));
const coreCss = await readFile(path.join(foundry, "public/css/style.css"), "utf8");
const windowCss = coreCss.slice(coreCss.indexOf(".app {"), coreCss.indexOf("#context-menu {"));
const temp = await mkdtemp(path.join(tmpdir(), "agent-shard-test-"));
let browser, localServer, externalServer, beats = 0;
const media = new Map();
const launchServer = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const fixtures = [
    ["video.webm", "video/webm", ["-f", "lavfi", "-i", "testsrc=size=96x64:rate=10", "-t", "2", "-an", "-c:v", "libvpx", "-pix_fmt", "yuv420p"]],
    ["music.wav", "audio/wav", ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=22050", "-t", "2", "-c:a", "pcm_s16le"]],
    ["animated.gif", "image/gif", ["-f", "lavfi", "-i", "testsrc=size=40x40:rate=5", "-t", "2"]]
  ];
  for (const [name, type, args] of fixtures) {
    const target = path.join(temp, name);
    const result = spawnSync(process.env.FFMPEG || "ffmpeg", ["-loglevel", "error", "-y", ...args, target], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, `ffmpeg fixture ${name}: ${result.stderr || result.error}`);
    media.set(`/${name}`, { type, data: await readFile(target) });
  }
  externalServer = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const asset = media.get(url.pathname);
    if (asset) { res.setHeader("Content-Type", asset.type); return res.end(asset.data); }
    if (url.pathname === "/remote.js") { res.setHeader("Content-Type", "text/javascript"); return res.end('document.body.dataset.externalScript="yes";'); }
    if (url.pathname === "/api") { res.setHeader("Content-Type", "application/json"); return res.end('{"result":"loaded"}'); }
    if (url.pathname === "/beat") { beats++; return res.end("ok"); }
    res.setHeader("Content-Type", "text/html");
    if (url.pathname === "/embed") return res.end('<button id="embed-button" onclick="this.textContent=\'clicked\'">Player widget</button>');
    if (url.pathname === "/form") {
      let body = ""; for await (const part of req) body += part;
      return res.end(`<p id="form-result">${new URLSearchParams(body).get("value") === "submitted" ? "submitted" : "missing"}</p>`);
    }
    res.end('<p id="link-target">Media link opened</p>');
  });
  await launchServer(externalServer);
  const remote = `http://127.0.0.1:${externalServer.address().port}`;
  localServer = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end('<!doctype html><div id="agent-marker">Agent stays here</div>'); }
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try { res.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : "text/css"); res.end(await readFile(target)); }
    catch { res.writeHead(404); res.end(); }
  });
  await launchServer(localServer);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${localServer.address().port}`);
  await page.addScriptTag({ path: path.join(foundry, "node_modules/jquery/dist/jquery.js") });
  await page.addScriptTag({ path: path.join(foundry, "node_modules/handlebars/dist/handlebars.js") });
  await page.addStyleTag({ content: `*,*::before,*::after{box-sizing:border-box}${windowCss}` });
  await page.addStyleTag({ url: "/styles/agent.css" });
  await page.evaluate(({ appTemplate, readerTemplate, lang }) => {
    const localize = key => key.split(".").reduce((o, k) => o?.[k], lang) || key;
    Handlebars.registerHelper("localize", localize);
    globalThis.renderTemplate = async (name, data) => Handlebars.compile(name === "templates/app-window.html" ? appTemplate : readerTemplate)(data);
    const merge = (base, extra, options = {}) => {
      const result = options.inplace === false ? structuredClone(base) : base;
      for (const [key, value] of Object.entries(extra)) {
        if (options.insertKeys === false && !(key in result)) continue;
        if (value && typeof value === "object" && !Array.isArray(value)) result[key] = merge(result[key] || {}, value);
        else result[key] = value;
      }
      return result;
    };
    globalThis.foundry = { utils: { mergeObject: merge, deepClone: value => structuredClone(value),
      getParentClasses: cls => { const list = []; for (let c = Object.getPrototypeOf(cls); c?.name; c = Object.getPrototypeOf(c)) list.push(c); return list; }
    } };
    globalThis.ui = { windows: {}, notifications: { warn() {} } };
    globalThis.game = { user: { isGM: true }, i18n: { localize }, tooltip: { deactivate() {} } };
    globalThis.Hooks = { callAll() {}, onError: (...args) => { throw new Error(JSON.stringify(args)); } };
    globalThis.MIN_WINDOW_WIDTH = 200; globalThis.MIN_WINDOW_HEIGHT = 100; globalThis.vtt = "Foundry VTT";
    Math.clamp = (v, min, max) => Math.min(Math.max(v, Number(min)), Number(max));
  }, { appTemplate, readerTemplate, lang });
  await page.addScriptTag({ content: `let _appId=0, _maxZ=100; ${nativeClass("Application")}\n${nativeClass("Draggable")}\nglobalThis.Application=Application; globalThis.Draggable=Draggable;` });
  const source = `<!doctype html><html><head><style>body{font:16px sans-serif;background:rgb(1,2,3);color:white}video{width:220px}img{width:40px}.box{width:20px;height:20px;background:red;animation:spin .5s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body>
    <button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button><input id="draft" value="keep me"><div class="box"></div>
    <base href="${remote}/"><video id="video" src="video.webm" controls muted loop></video><button id="play-video" onclick="document.getElementById('video').play()">Play video</button>
    <audio id="music" src="${remote}/music.wav" controls loop></audio><button id="play-music" onclick="document.getElementById('music').play()">Play music</button>
    <img id="gif" src="${remote}/animated.gif" crossorigin="anonymous">
    <iframe id="embed" src="${remote}/embed" title="remote player"></iframe>
    <form action="${remote}/form" method="post" target="result"><input name="value" value="submitted"><button id="submit">Submit</button></form><iframe name="result" title="form result"></iframe>
    <a id="media-link" href="${remote}/link" target="_blank" rel="noopener">Open media link</a>
    <script src="remote.js"></script><script>
      window.starts=1; document.body.dataset.origin=window.origin;
      try { parent.document.body.dataset.escaped='yes'; } catch { document.body.dataset.blocked='yes'; }
      try { parent.game.secret; document.body.dataset.gameAccess='yes'; } catch { document.body.dataset.gameAccess='no'; }
      fetch('api').then(r=>r.json()).then(v=>document.body.dataset.api=v.result);
      setInterval(()=>fetch('${remote}/beat'),100);
    </script></body></html>`;
  await page.evaluate(async source => {
    const { ShardReader } = await import("/scripts/shard-reader.js");
    globalThis.reader = new ShardReader({ title: "Media shard", body: source, format: "html" });
    await reader._render(true, { focus: false });
  }, source);
  const frame = page.frameLocator(".agentos-reader-frame");
  await frame.locator('body[data-external-script="yes"][data-api="loaded"][data-blocked="yes"][data-game-access="no"]').waitFor();
  assert.equal(await page.locator("body").getAttribute("data-escaped"), null);
  assert.equal(await frame.locator("body").getAttribute("data-origin"), "null");
  assert.equal(await page.locator("#agent-marker").textContent(), "Agent stays here");
  await frame.locator("#play-video").click();
  await frame.locator("#video").evaluate(video => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("Video did not play")), 3000); const check = () => { if (video.currentTime > 0.1 && !video.paused) { clearTimeout(timer); resolve(); } else setTimeout(check, 30); }; check(); }));
  await frame.locator("#play-music").click();
  await frame.locator("#music").evaluate(audio => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("Audio did not play")), 3000); const check = () => { if (audio.currentTime > 0.1 && !audio.paused) { clearTimeout(timer); resolve(); } else setTimeout(check, 30); }; check(); }));
  await frame.locator("#gif").evaluate(img => img.decode());
  const gifBefore = await frame.locator("#gif").screenshot();
  let animated = false;
  for (let i = 0; i < 10 && !animated; i++) {
    await page.waitForTimeout(130);
    animated = !gifBefore.equals(await frame.locator("#gif").screenshot());
  }
  assert.equal(animated, true, "GIF pixels must actually animate");
  await frame.frameLocator("#embed").locator("#embed-button").click();
  assert.equal(await frame.frameLocator("#embed").locator("#embed-button").textContent(), "clicked");
  await frame.locator("#submit").click(); await frame.frameLocator('iframe[name="result"]').locator("#form-result").waitFor();
  assert.equal(await frame.frameLocator('iframe[name="result"]').locator("#form-result").textContent(), "submitted");
  const popupPromise = page.waitForEvent("popup"); await frame.locator("#media-link").click();
  const popup = await popupPromise; await popup.locator("#link-target").waitFor(); await popup.close();
  console.log("PASS: real video/audio playback, animated GIF, external JS/fetch, embedded widget, form and link; parent isolation");

  await frame.locator("#counter").click(); await frame.locator("#draft").fill("Retain draft");
  const handle = page.locator(".window-resizable-handle");
  const initial = await page.locator(".agentos-shard-reader").boundingBox();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 140, grip.y + grip.height / 2 - 100, { steps: 15 }); await page.mouse.up();
  const resized = await page.locator(".agentos-shard-reader").boundingBox();
  assert.ok(resized.width < initial.width - 100 && resized.height < initial.height - 60, `Native resize handle must shrink the reader across its iframe: ${JSON.stringify({ initial, resized })}`);
  for (let i = 0; i < 3; i++) await page.locator("[data-action=shard-zoom-in]").click();
  assert.equal(await page.locator("[data-action=shard-zoom-reset]").textContent(), "130%");
  assert.equal(await frame.locator("#counter").textContent(), "1"); assert.equal(await frame.locator("#draft").inputValue(), "Retain draft");
  assert.equal(await frame.locator("body").evaluate(() => window.starts), 1);
  assert.equal(await frame.locator("#music").evaluate(a => a.paused), false);
  await page.locator("[data-action=shard-zoom-reset]").click();
  assert.equal(await page.evaluate(() => reader.pageZoom), 1);
  await page.evaluate(() => reader.close());
  const atClose = beats; await new Promise(r => setTimeout(r, 350)); const afterClose = beats;
  await new Promise(r => setTimeout(r, 350)); assert.equal(beats, afterClose); assert.ok(afterClose <= atClose + 2);
  assert.equal(await page.locator(".agentos-shard-reader").count(), 0);
  console.log("PASS: native v12 resizing, 130% content zoom without restart or lost playback/input, close cleans up the document");
  await page.setViewportSize({ width: 420, height: 820 });
  await page.evaluate(async () => {
    const { ShardReader } = await import("/scripts/shard-reader.js");
    globalThis.plainReader = new ShardReader({ title: "Plain", format: "plain", body: '<script>parent.document.body.dataset.escaped="yes"</script>\nSecond line' });
    globalThis.mdReader = new ShardReader({ title: "Markdown", format: "markdown", body: "# Heading\n\n**Bold**\n\n[Music](https://example.com/music.ogg)" });
    await plainReader._render(true, { focus: false }); await mdReader._render(true, { focus: false });
  });
  assert.equal(await page.locator(".agentos-shard-reader").count(), 2);
  // Frame locators start at the document; pick each native app via its unique id.
  const ids = await page.evaluate(() => [plainReader.id, mdReader.id]); assert.notEqual(ids[0], ids[1]);
  const plainFrame = page.frameLocator(`#${ids[0]} .agentos-reader-frame`), markdown = page.frameLocator(`#${ids[1]} .agentos-reader-frame`);
  assert.ok((await plainFrame.locator("body").textContent()).includes("<script>"));
  assert.equal(await markdown.locator("h1").textContent(), "Heading"); assert.equal(await markdown.locator("strong").textContent(), "Bold");
  assert.equal(await markdown.locator("a").getAttribute("href"), "https://example.com/music.ogg");
  assert.equal(await page.locator("body").getAttribute("data-escaped"), null);
  for (const app of await page.locator(".agentos-shard-reader").all()) assert.ok((await app.boundingBox()).width <= 420);
  await page.evaluate(async () => { await plainReader.close(); await mdReader.close(); });
  console.log("PASS: independent windows, small viewport, escaped plain text and Markdown headings/links");
  await page.evaluate(async () => {
    game.user.id = "player"; game.user.isGM = false;
    const world = { agentShards: [
      { id: "received", title: "Delivered", body: "Recipient copy", format: "plain", createdBy: "other", isCopy: true, recipients: { player: 1 } },
      { id: "private", title: "Private", body: "GM view", format: "plain", createdBy: "other", recipients: {} }
    ] };
    game.settings = { get: (m, key) => world[key] };
    globalThis.shardApp = { state: { shardId: "received" }, render() {} };
    const html = $('<div id="shard-ui"><button data-action="shard-popout">Open</button></div>');
    $(document.body).append(html);
    (await import("/scripts/apps/datapool.js")).activateListeners(shardApp, html);
    globalThis.shardWorld = world;
  });
  await page.locator("[data-action=shard-popout]").click();
  await page.frameLocator(".agentos-reader-frame").locator("body").filter({ hasText: "Recipient copy" }).waitFor();
  assert.equal(await page.evaluate(() => shardWorld.agentShards.length), 2, "Opening a reader never imports or writes a shard");
  await page.evaluate(async () => { await Object.values(ui.windows)[0].close(); shardApp.state.shardId = "private"; });
  await page.locator("[data-action=shard-popout]").click();
  assert.equal(await page.locator(".agentos-shard-reader").count(), 0, "A player cannot pop out an inaccessible shard");
  await page.evaluate(() => { game.user.isGM = true; });
  await page.locator("[data-action=shard-popout]").click();
  await page.frameLocator(".agentos-reader-frame").locator("body").filter({ hasText: "GM view" }).waitFor();
  await page.evaluate(() => Object.values(ui.windows)[0].close());
  console.log("PASS: Datapool pop-out action, GM/player visibility and received copies without imports or world writes");
  assert.deepEqual(errors, []);
} finally {
  if (browser) await browser.close();
  await Promise.all([localServer, externalServer].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
  await rm(temp, { recursive: true, force: true });
}
