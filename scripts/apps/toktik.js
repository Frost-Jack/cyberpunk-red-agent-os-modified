import { MODULE_ID, loc } from "../constants.js";

const CATALOG = new URL("../../assets/toktik/catalog.json", import.meta.url);
let catalogTask = null, mounted = null;

async function catalog() {
  return catalogTask ||= fetch(CATALOG).then(async response => {
    if (!response.ok) throw new Error("Tok Tik catalog unavailable");
    const data = await response.json();
    if (data.version !== 1 || !Array.isArray(data.clips)) throw new Error("Invalid Tok Tik catalog");
    return data.clips.filter(c => /^[\w-]{11}$/.test(c.id) && /^clips\/[\w-]{11}\.mp4$/.test(c.src || "")).map(c => ({
      ...c, src: new URL(c.src, CATALOG).href,
      product: c.title.replace(/^Cyberpunk 2077\s*(?:-\s*)?/i, "").trim(),
      poster: /^posters\/[\w-]{11}\.jpg$/.test(c.poster || "") ? new URL(c.poster, CATALOG).href : ""
    }));
  });
}

function shuffle(clips, previousId) {
  const queue = [...clips];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  if (queue.length > 1 && queue[0].id === previousId) {
    const j = 1 + Math.floor(Math.random() * (queue.length - 1));
    [queue[0], queue[j]] = [queue[j], queue[0]];
  }
  return queue;
}

export async function getData(app) {
  try {
    if (!app.state.clips?.length) {
      app.state.clips = shuffle(await catalog(), game.settings.get(MODULE_ID, "toktikLastStart"));
      app.state.clipIndex = 0; app.state.clipTime = 0;
      if (app.state.clips.length) await game.settings.set(MODULE_ID, "toktikLastStart", app.state.clips[0].id);
    }
    const clips = app.state.clips;
    app.state.volume = Math.max(0, Math.min(100, Number(app.state.volume ?? game.settings.get(MODULE_ID, "toktikVolume") ?? 100)));
    return { hasClips: !!clips.length, clip: clips[app.state.clipIndex], volume: app.state.volume,
      error: clips.length ? "" : loc("AGENTOS.TokTik.MissingMedia") };
  } catch (error) {
    return { hasClips: false, error: loc("AGENTOS.TokTik.LoadError") };
  }
}

function remember(session) {
  session.app.state.clipTime = Number.isFinite(session.video.currentTime) ? session.video.currentTime : 0;
}

async function preload(session) {
  const media = session.media;
  if (media.started) return;
  media.started = true;
  const clips = session.app.state.clips, index = session.app.state.clipIndex;
  // Stream the visible video first; cache compressed files instead of 23 decoders.
  for (let offset = 0; offset < clips.length && !media.controller.signal.aborted; offset++) {
    const clip = clips[(index + offset) % clips.length];
    try {
      const response = await fetch(clip.src, { signal: media.controller.signal, priority: "low" });
      if (!response.ok) continue;
      const blob = await response.blob();
      if (media.controller.signal.aborted) break;
      media.urls.set(clip.id, URL.createObjectURL(blob));
    } catch (error) { if (media.controller.signal.aborted) break; }
  }
}

export function onClose(app) {
  if (!mounted || (app && mounted.app !== app)) return;
  const session = mounted; mounted = null;
  remember(session); session.events.abort(); session.media.controller.abort(); session.video.pause();
  session.video.removeAttribute("src"); session.video.load();
  for (const url of session.media.urls.values()) URL.revokeObjectURL(url);
  session.media.urls.clear();
  delete session.app.state.clips;
  session.app.state.clipIndex = 0; session.app.state.clipTime = 0;
}

export function activateListeners(app, html) {
  const root = html.find(".agentos-toktik")[0], slot = html.find(".agentos-toktik-stage")[0];
  if (!root || !slot) return;
  const st = app.state;
  let clips = st.clips || [];
  const previous = mounted, reuse = previous?.app === app && previous.id === clips[st.clipIndex]?.id;
  if (previous) { remember(previous); previous.events.abort(); if (!reuse) onClose(); }
  const video = reuse ? previous.video : document.createElement("video");
  video.className = "agentos-toktik-video";
  video.playsInline = true; video.preload = "auto"; video.muted = false; video.volume = st.volume / 100;
  video.tabIndex = 0;
  slot.prepend(video);
  const events = new AbortController(), options = { signal: events.signal };
  const media = reuse ? previous.media : { controller: new AbortController(), urls: new Map(), started: false };
  const session = mounted = { app, video, root, events, media, playing: reuse && previous.playing, id: clips[st.clipIndex]?.id };
  const title = html.find(".agentos-toktik-product")[0], status = html.find(".agentos-toktik-status")[0];
  const message = text => { status.textContent = text; status.hidden = !text; };
  const play = async () => {
    try { await video.play(); }
    catch (error) {
      if (mounted === session && error.name !== "AbortError") {
        message(loc("AGENTOS.TokTik.TapToPlay")); void preload(session);
      }
    }
  };
  const show = (index, restore = false) => {
    st.clipIndex = (index + clips.length) % clips.length;
    const clip = clips[st.clipIndex]; session.id = clip.id;
    title.textContent = clip.product; video.setAttribute("aria-label", clip.product);
    html.find("[data-action='toktik-previous']").prop("disabled", st.clipIndex === 0);
    message(""); video.poster = clip.poster;
    if (!restore) st.clipTime = 0;
    if (!restore || !reuse) video.src = media.urls.get(clip.id) || clip.src;
    if (!restore || !reuse || session.playing) void play();
  };
  const step = direction => {
    if (direction < 0 && st.clipIndex === 0) return;
    if (direction > 0 && st.clipIndex === clips.length - 1) {
      st.clips = clips = shuffle(clips, session.id);
      show(0);
    } else show(st.clipIndex + direction);
  };
  html.on("click", "[data-action='toktik-previous']", () => step(-1));
  html.on("click", "[data-action='toktik-next']", () => step(1));
  html.on("input", "[name='toktik-volume']", ev => {
    st.volume = Math.max(0, Math.min(100, Number(ev.currentTarget.value)));
    video.volume = st.volume / 100;
    html.find(".agentos-toktik-volume-value").text(`${st.volume}%`);
    ev.currentTarget.style.setProperty("--toktik-volume", `${st.volume}%`);
  });
  html.on("change", "[name='toktik-volume']", () => game.settings.set(MODULE_ID, "toktikVolume", st.volume));
  video.addEventListener("ended", () => step(1), options);
  video.addEventListener("play", () => { session.playing = true; message(""); }, options);
  video.addEventListener("playing", () => { void preload(session); }, options);
  video.addEventListener("pause", () => { if (video.isConnected) session.playing = false; }, options);
  video.addEventListener("error", () => message(loc("AGENTOS.TokTik.VideoError")), options);
  video.addEventListener("timeupdate", () => remember(session), options);
  video.addEventListener("loadedmetadata", () => {
    if (st.clipTime > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(st.clipTime, Math.max(0, video.duration - 0.1));
  }, options);
  let wheelAt = -Infinity, wheelLastAt = 0, wheelDelta = 0, swipe = null;
  root.addEventListener("wheel", ev => {
    if (ev.ctrlKey || ev.target.closest("input")) return;
    ev.preventDefault();
    const now = performance.now();
    if (now - wheelLastAt > 250) wheelDelta = 0;
    wheelLastAt = now;
    wheelDelta += ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? root.clientHeight : 1);
    if (now - wheelAt > 550 && Math.abs(wheelDelta) > 45) { step(wheelDelta > 0 ? 1 : -1); wheelDelta = 0; wheelAt = now; }
  }, { ...options, passive: false });
  video.addEventListener("pointerdown", ev => { if (ev.button === 0) { swipe = { x: ev.clientX, y: ev.clientY }; video.setPointerCapture(ev.pointerId); } }, options);
  video.addEventListener("pointerup", ev => {
    if (!swipe) return;
    const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y; swipe = null;
    if (Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx)) step(dy < 0 ? 1 : -1);
    else if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && video.paused) { video.load(); void play(); }
  }, options);
  video.addEventListener("pointercancel", () => { swipe = null; }, options);
  document.addEventListener("keydown", ev => {
    if (ev.target?.closest?.("input,textarea,select,[contenteditable='true']") || !app.element?.[0]?.contains(document.activeElement)) return;
    if (["ArrowDown", "ArrowUp"].includes(ev.key)) { ev.preventDefault(); step(ev.key === "ArrowDown" ? 1 : -1); }
    else if (ev.key === "Enter" && ev.target === video && video.paused) { ev.preventDefault(); void play(); }
  }, options);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) video.pause();
    else void play();
  }, options);
  show(st.clipIndex, true);
  if (!reuse) video.focus({ preventScroll: true });
}
