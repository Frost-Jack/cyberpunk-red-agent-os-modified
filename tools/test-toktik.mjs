/* Isolated Tok Tik playback/preload checks; never connects to a Foundry world. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url), { chromium } = require(process.argv[2] || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const foundry = process.env.FOUNDRY_APP || path.join(process.env.ProgramFiles, "Foundry Virtual Tabletop/resources/app");
const templates = Object.fromEntries(await Promise.all((await readdir(path.join(root, "templates"))).filter(f => f.endsWith(".hbs")).map(async f => [f, await readFile(path.join(root, "templates", f), "utf8")])));
const lang = JSON.parse(await readFile(path.join(root, "lang/ru.json"), "utf8"));
const real = JSON.parse(await readFile(path.join(root, "assets/toktik/catalog.json"), "utf8"));
const localMedia = process.argv.includes("--local-media");
assert.equal(real.playlistId, "PLMlEOMdjfuIS7cxhd1Mg_ISXqM9TSo80A");
assert.equal(new Set(real.clips.map(c => c.id)).size, real.clips.length);
const temp = await mkdtemp(path.join(tmpdir(), "agent-toktik-test-"));
let server, browser, catalogRequests = 0;
try {
  let fixtureMovie = null;
  if (!localMedia) {
    const fixture = path.join(temp, "fixture.mp4");
    const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=22050", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", fixture], { encoding: "utf8", windowsHide: true });
    assert.equal(made.status, 0, made.stderr); fixtureMovie = await readFile(fixture);
  }
  const clips = (localMedia ? real.clips : real.clips.slice(0, 3)).map(c => ({ ...c, src: `clips/${c.id}.mp4` }));
  const mediaFiles = new Map(await Promise.all(clips.map(async c => [c.id, localMedia ? await readFile(path.join(root, "assets/toktik", c.src)) : fixtureMovie])));
  const calls = [];
  server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    calls.push({ path: pathname, dest: req.headers["sec-fetch-dest"] });
    if (pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end("<!doctype html><body></body>"); }
    if (pathname.endsWith("/assets/toktik/catalog.json")) { catalogRequests++; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ version: 1, clips })); }
    if (pathname.startsWith("/foundry-icons/")) {
      const fontRoot = path.join(foundry, "public/fonts/fontawesome");
      const target = path.resolve(fontRoot, pathname.slice("/foundry-icons/".length));
      if (!target.startsWith(fontRoot + path.sep)) { res.writeHead(403); return res.end(); }
      try { const data = await readFile(target); res.setHeader("Content-Type", target.endsWith(".css") ? "text/css" : "font/woff2"); return res.end(data); }
      catch { res.writeHead(404); return res.end(); }
    }
    if (pathname.includes("/assets/toktik/clips/")) {
      const movie = mediaFiles.get(path.basename(pathname, ".mp4"));
      if (!movie) { res.writeHead(404); return res.end(); }
      res.setHeader("Content-Type", "video/mp4"); res.setHeader("Accept-Ranges", "bytes");
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) { const start = Number(range[1]), end = Math.min(movie.length - 1, range[2] ? Number(range[2]) : movie.length - 1); res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${movie.length}`, "Content-Length": end - start + 1 }); return res.end(movie.subarray(start, end + 1)); }
      res.setHeader("Content-Length", movie.length); return res.end(movie);
    }
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try { const data = await readFile(target); res.setHeader("Content-Type", target.endsWith(".js") ? "text/javascript" : target.endsWith(".css") ? "text/css" : target.endsWith(".jpg") ? "image/jpeg" : target.endsWith(".ttf") ? "font/ttf" : "text/plain"); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 }, hasTouch: true });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ path: path.join(foundry, "node_modules/jquery/dist/jquery.js") });
  await page.addScriptTag({ path: path.join(foundry, "node_modules/handlebars/dist/handlebars.js") });
  await page.addStyleTag({ content: await readFile(path.join(foundry, "public/css/style.css"), "utf8") });
  await page.addStyleTag({ content: await readFile(path.resolve(root, "../../systems/cyberpunk-red-core/main.css"), "utf8") });
  await page.addStyleTag({ content: "*,*::before,*::after{box-sizing:border-box}body{background:#181b20}" });
  await page.addStyleTag({ url: "/styles/agent.css" });
  await page.addStyleTag({ url: "/foundry-icons/css/all.min.css" });
  const cdp = await page.context().newCDPSession(page);
  const online = { offline: false, latency: 60, downloadThroughput: 1024 * 1024, uploadThroughput: 1024 * 1024, connectionType: "wifi" };
  await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", online);
  await page.evaluate(async ({ templates, lang, count, previousStart }) => {
    globalThis.settings = { radioVolume: 60, toktikLastStart: previousStart }, globalThis.writes = [];
    globalThis.originalRandom = Math.random; Math.random = () => 0;
    globalThis.game = { user: { id: "p", isGM: false }, settings: {
      get: (module, key) => settings[key],
      set: async (module, key, value) => { writes.push(key); settings[key] = value; }
    }, i18n: { localize: key => key.split(".").reduce((o, k) => o?.[k], lang) || key } };
    Handlebars.registerHelper("agEq", (a, b) => a === b); Handlebars.registerHelper("localize", game.i18n.localize);
    for (const [file, html] of Object.entries(templates)) Handlebars.registerPartial(`modules/cyberpunk-red-agent-os-modified/templates/${file}`, html);
    globalThis.shell = Handlebars.compile(templates["shell.hbs"]);
    globalThis.createdUrls = new Set(), globalThis.revokedUrls = new Set(), globalThis.mediaEvents = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL), originalFetch = fetch;
    URL.createObjectURL = blob => { const url = create(blob); createdUrls.add(url); return url; };
    URL.revokeObjectURL = url => { revokedUrls.add(url); revoke(url); };
    globalThis.fetch = (input, options) => {
      if (String(input).endsWith(".mp4")) mediaEvents.push({ type: "prefetch", at: performance.now(), url: String(input) });
      return originalFetch(input, options);
    };
    document.addEventListener("playing", event => { if (event.target.tagName === "VIDEO") mediaEvents.push({ type: "playing", at: performance.now() }); }, true);
    globalThis.toktik = await import("/scripts/apps/toktik.js");
    globalThis.clipCount = count;
    globalThis.app = { state: {}, currentApp: "toktik", mode: "phone", paints: 0,
      async render() {
        const data = await toktik.getData(this);
        $(document.body).off();
        document.body.innerHTML = shell({ mode: this.mode, zoom: 1.3, theme: "red", view: "toktik", viewTitle: game.i18n.localize("AGENTOS.App.toktik"), viewData: data });
        this.element = $(document.body); toktik.activateListeners(this, this.element); this.paints++;
      }
    };
    document.body.innerHTML = '<button id="open">Tok Tik</button>';
    document.querySelector("#open").onclick = () => app.render();
  }, { templates, lang, count: clips.length, previousStart: clips[1].id });
  await page.locator("#open").click();
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.1);
  assert.equal(await page.locator("video").evaluate(v => !v.muted && v.volume === 1 && !v.controls), true);
  await page.evaluate(() => { Math.random = originalRandom; });
  assert.notEqual(await page.evaluate(() => app.state.clips[0].id), clips[1].id, "A new opening must avoid the previous starting ad, even with the same RNG result");
  assert.equal(await page.locator(".agentos-toktik").locator("button").count(), 2);
  assert.equal(await page.locator(".agentos-toktik").locator("a,[name='toktik-seek'],[data-action=toktik-play]").count(), 0);
  assert.equal(await page.locator(".agentos-app-title").innerText(), "Tok Tik");
  assert.ok(!(await page.locator(".agentos-toktik-product").innerText()).includes("Cyberpunk 2077"));
  const quality = await page.locator("video").evaluate(async v => {
    const before = v.getVideoPlaybackQuality(), start = v.currentTime;
    let stalls = 0; const stalled = () => stalls++;
    v.addEventListener("waiting", stalled);
    await new Promise(resolve => setTimeout(resolve, 3000));
    v.removeEventListener("waiting", stalled);
    const after = v.getVideoPlaybackQuality();
    return { advanced: v.currentTime - start, total: after.totalVideoFrames - before.totalVideoFrames, dropped: after.droppedVideoFrames - before.droppedVideoFrames, stalls };
  });
  console.log("Playback at 8 Mbps / 60 ms while preloading:", JSON.stringify(quality));
  assert.ok(quality.advanced > 2.5, "Playback must progress while background downloads run");
  assert.equal(quality.stalls, 0, "Background downloads must not stall the current video");
  assert.ok(quality.dropped <= Math.max(3, quality.total * 0.1), "Too many dropped frames");
  assert.equal(await page.evaluate(() => mediaEvents[0].type), "playing", "Start playback before prefetch");
  await page.waitForFunction(() => createdUrls.size === clipCount, null, { timeout: 120000 });
  await cdp.send("Network.emulateNetworkConditions", { ...online, offline: true });
  const beforeRequests = calls.filter(c => c.path.endsWith(".mp4")).length;
  const paints = await page.evaluate(() => app.paints);
  while (await page.evaluate(() => app.state.clipIndex !== 0 || !document.querySelector("video").currentSrc.startsWith("blob:"))) await page.locator("[data-action=toktik-next]").click();
  const round = await page.evaluate(() => app.state.clips.map(c => c.id));
  assert.equal(new Set(round).size, clips.length);
  const shown = [];
  for (let i = 0; i < clips.length; i++) {
    await page.waitForFunction(() => document.querySelector("video")?.currentSrc.startsWith("blob:") && document.querySelector("video").currentTime > 0.05);
    shown.push(await page.evaluate(() => app.state.clips[app.state.clipIndex].id));
    if (i < clips.length - 1) await page.locator("[data-action=toktik-next]").click();
  }
  assert.deepEqual(shown, round, "Every ad must appear exactly once before a new round");
  await page.locator("[data-action=toktik-next]").click();
  assert.equal(await page.evaluate(() => app.state.clipIndex), 0);
  assert.notEqual(await page.evaluate(() => app.state.clips[0].id), shown.at(-1), "Round boundaries must not repeat the same ad");
  assert.equal(await page.evaluate(() => new Set(app.state.clips.map(c => c.id)).size), clips.length);
  assert.equal(await page.locator("[data-action=toktik-previous]").isDisabled(), true);
  await page.locator("[data-action=toktik-next]").click();
  await page.locator("[data-action=toktik-previous]").click();
  assert.equal(await page.evaluate(() => app.state.clipIndex), 0, "Up must return to the previous ad in the same queue");
  assert.equal(calls.filter(c => c.path.endsWith(".mp4")).length, beforeRequests, "Cached videos must play without new network requests");
  assert.equal(await page.evaluate(() => app.paints), paints);
  console.log(`PASS: all ${clips.length} ads play offline exactly once per shuffled round; fresh round avoids boundary repeats; up/down navigate the queue`);
  await cdp.send("Network.emulateNetworkConditions", { ...online, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  for (const mode of ["phone", "tablet", "pc"]) {
    assert.equal(await page.evaluate(async mode => { const queue = app.state.clips; app.mode = mode; await app.render(); return app.state.clips === queue; }, mode), true, "Repaint must preserve the queue");
    assert.ok(await page.locator(".agentos-app-body").evaluate(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1), `${mode}: feed must fit at 130%`);
    const video = await page.locator("video").boundingBox(), footer = await page.locator(".agentos-toktik-footer").boundingBox();
    assert.ok(footer.y >= video.y + video.height - 1, "Product and volume must be outside the video");
    assert.equal(await page.locator("video").evaluate(v => getComputedStyle(v).objectFit), "contain");
    await page.locator("video").focus(); await page.keyboard.press("ArrowDown");
  }
  if (await page.evaluate(() => app.state.clipIndex === 0)) await page.locator("[data-action=toktik-next]").click();
  const initial = await page.evaluate(() => app.state.clipIndex);
  await page.locator(".agentos-toktik").dispatchEvent("wheel", { deltaY: -120, deltaMode: 0 });
  assert.equal(await page.evaluate(() => app.state.clipIndex), (initial + clips.length - 1) % clips.length);
  await page.locator(".agentos-toktik").dispatchEvent("wheel", { deltaY: -120, deltaMode: 0 });
  assert.equal(await page.evaluate(() => app.state.clipIndex), (initial + clips.length - 1) % clips.length);
  const rect = await page.locator("video").boundingBox();
  await page.mouse.move(rect.x + 20, rect.y + rect.height * 0.7); await page.mouse.down();
  await page.mouse.move(rect.x + 20, rect.y + rect.height * 0.3, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => app.state.clipIndex), initial);
  await page.locator("[name=toktik-volume]").fill("35");
  assert.equal(await page.locator("video").evaluate(v => v.volume), 0.35);
  assert.deepEqual(await page.evaluate(() => ({ radio: settings.radioVolume, saved: settings.toktikVolume, writes })), { radio: 60, saved: 35, writes: ["toktikLastStart", "toktikVolume"] });
  assert.equal(await page.locator(".agentos-toktik-volume-value").innerText(), "35%");
  assert.equal(await page.locator("[name=toktik-volume]").evaluate(e => getComputedStyle(e).appearance), "none");
  await page.locator("video").evaluate(v => { v.pause(); v.currentTime = 1.5; globalThis.previousVideo = v; });
  const cached = await page.evaluate(() => createdUrls.size);
  await page.evaluate(() => app.render());
  assert.equal(await page.locator("video").evaluate(v => v === previousVideo && v.paused && Math.abs(v.currentTime - 1.5) < 0.2 && v.volume === 0.35), true);
  assert.equal(await page.evaluate(() => createdUrls.size), cached, "Refresh must preserve the cache");
  const index = await page.evaluate(() => app.state.clipIndex);
  await page.locator("video").evaluate(async v => { v.currentTime = v.duration - 0.2; await v.play(); });
  await page.waitForFunction(index => app.state.clipIndex === (index + 1) % clipCount, index);
  await page.evaluate(async () => { app.mode = "phone"; await app.render(); await document.fonts.ready; });
  if (localMedia) await page.locator(".agentos-chassis").screenshot({ path: path.join(root, "tools/.toktik-fetch/toktik-phone.png") });
  await page.evaluate(() => { toktik.onClose(app); document.body.innerHTML = '<textarea id="outside"></textarea>'; });
  assert.equal(await page.evaluate(() => previousVideo.paused && !previousVideo.getAttribute("src") && [...createdUrls].every(u => revokedUrls.has(u))), true);
  await page.locator("#outside").focus(); await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => app.state.clipIndex), 0);
  const previousStart = await page.evaluate(() => settings.toktikLastStart);
  await page.evaluate(() => { app.state = {}; return app.render(); });
  await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.1);
  assert.equal(await page.locator("video").evaluate(v => v.volume), 0.35);
  assert.notEqual(await page.evaluate(() => app.state.clips[0].id), previousStart);
  const before = await page.evaluate(() => app.state.clipIndex);
  await page.locator("video").focus(); await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => app.state.clipIndex), (before + 1) % clips.length);
  await page.evaluate(() => toktik.onClose(app));
  await page.waitForFunction(() => [...createdUrls].every(u => revokedUrls.has(u)));
  for (let i = 0; i < 8; i++) {
    const previous = await page.evaluate(() => settings.toktikLastStart);
    assert.equal(await page.evaluate(async () => { const data = await toktik.getData(app); return data.hasClips; }), true);
    assert.notEqual(await page.evaluate(() => app.state.clips[0].id), previous);
    await page.evaluate(() => { app.state.clips = null; });
  }
  assert.equal(catalogRequests, 1);
  assert.deepEqual(errors, []);
  console.log("PASS: different starting ad on repeated openings; themed independent volume; three device layouts; gestures/autoplay; stable queue/cache on refresh and cleanup on exit");
} finally {
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(temp, { recursive: true, force: true });
}
