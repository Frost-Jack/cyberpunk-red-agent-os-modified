/* Radio: streams the rekt.network / nightride.fm Icecast stations and shows
 * the live "now playing" track from their public SSE metadata feed.
 *
 * Verified endpoints:
 *   stream:  https://stream.nightride.fm/<slug>.ogg   (Ogg/Vorbis, plays in <audio>)
 *   meta:    https://nightride.fm/meta                (text/event-stream, CORS *)
 *
 * The <audio> element and the SSE connection live at MODULE level so playback
 * survives app re-renders and switching to other Agent apps. Whether it also
 * survives closing the whole device is controlled by the in-app "keep playing"
 * toggle (persisted in a client flag). Volume comes from the `radioVolume`
 * client setting (0–100), shared with the Agent settings slider.
 */

import { MODULE_ID, loc } from "../constants.js";
import { AgentAudio } from "../audio.js";
import * as Data from "../data.js";

const STREAM_BASE = "https://stream.nightride.fm";
const META_URL = "https://nightride.fm/meta";

/* Station roster as presented on rekt.network. `slug` maps to <slug>.ogg. */
const STATIONS = [
  { slug: "rekt",        name: "REKT",         genre: "Dubstep / DnB / Halftime", color: "#ff2b55" },
  { slug: "rektory",     name: "REKTORY",      genre: "Reefer Jazz / Fallout",    color: "#e5a53f" },
  { slug: "nightride",   name: "NIGHTRIDE FM", genre: "Synthwave / Outrun",       color: "#b06bff" },
  { slug: "chillsynth",  name: "CHILLSYNTH",   genre: "Chillwave",                color: "#38d4ff" },
  { slug: "datawave",    name: "DATAWAVE",     genre: "Glitch Synth / IDM",       color: "#2ff5d0" },
  { slug: "spacesynth",  name: "SPACESYNTH",   genre: "Space Disco / Italo",      color: "#ff9d3c" },
  { slug: "darksynth",   name: "DARKSYNTH",    genre: "Cyberpunk / Synthmetal",   color: "#ff4fd8" },
  { slug: "horrorsynth", name: "HORRORSYNTH",  genre: "Witch House",              color: "#7a6bff" },
  { slug: "ebsm",        name: "EBSM",         genre: "Industrial / Clubbing",    color: "#3df58a" }
];

/* ---------------- module-level engine (persists across renders) ---------- */

const engine = {
  audio: null,          // the <audio> element
  slug: null,           // current station slug (null = stopped)
  playing: false,
  loading: false,
  sse: null,            // EventSource on /meta
  meta: {},             // slug -> { artist, title, artwork }
  onUpdate: null,       // callback to re-render the open app, if any
  optOutTs: 0           // player: broadcast ts the user locally stopped (soft-lock)
};

/* ---------------- GM takeover / broadcast ---------------- */

/** Current broadcast state from the world setting. */
function broadcast() {
  const b = Data.getWorld("radioBroadcast") || {};
  return { active: !!b.active, slug: String(b.slug || ""), playing: !!b.playing, ts: Number(b.ts || 0) };
}

/** True when a GM broadcast is dictating this (non-GM) client's station. */
function following() {
  return !game.user.isGM && broadcast().active;
}

/**
 * Reconcile local playback with the GM broadcast. Called on every
 * `radioBroadcast` change (via main.js) so a player's audio follows the GM
 * even when the Radio app isn't open. Soft-lock: a player may stop locally,
 * but the GM's *next* command (new ts) re-engages them.
 */
export function syncBroadcast() {
  if (game.user.isGM) { engine.onUpdate?.(); return; }
  const b = broadcast();
  if (!b.active) {
    // takeover released — stop the forced stream (leave the player free again)
    engine.optOutTs = 0;
    if (engine.slug) stop(true);
    engine.onUpdate?.();
    return;
  }
  // A newer command overrides any local opt-out.
  if (b.ts > engine.optOutTs) engine.optOutTs = 0;
  const optedOut = engine.optOutTs === b.ts && b.ts !== 0;
  if (b.playing && b.slug && !optedOut) {
    if (engine.slug !== b.slug || !engine.playing) playStation(b.slug, true);
  } else if (!b.playing && engine.slug) {
    stop(true);
  }
  engine.onUpdate?.();
}

/** GM: push the current engine state to everyone (or clear when off). */
async function pushBroadcast(active) {
  await Data.mutate("radio.broadcast", {
    active,
    slug: active ? (engine.slug || "") : "",
    playing: active ? engine.playing : false
  });
}

/** Foundry's global music (playlist) volume, 0..1 — the master for radio. */
function foundryMusicVolume() {
  try {
    const g = Number(game.settings.get("core", "globalPlaylistVolume"));
    return Number.isFinite(g) ? Math.max(0, Math.min(1, g)) : 1;
  } catch (e) { return 1; }
}

/** Effective radio volume = own slider × Foundry's music volume. */
function volume() {
  try {
    const v = Number(game.settings.get(MODULE_ID, "radioVolume"));
    const own = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0.6;
    return own * foundryMusicVolume();
  } catch (e) { return 0.6; }
}

/** Whether playback should continue after the device window is closed. */
function keepPlaying() {
  return game.user.getFlag(MODULE_ID, "radioKeepPlaying") === true;
}

/** Exported so main.js can apply the settings slider live while playing. */
export function applyVolume() {
  if (engine.audio) engine.audio.volume = volume();
}

function ensureAudio() {
  if (engine.audio) return engine.audio;
  const el = document.createElement("audio");
  el.id = "agentos-radio-audio";
  el.preload = "none";
  el.crossOrigin = "anonymous";
  el.volume = volume();
  el.addEventListener("playing", () => { engine.loading = false; engine.playing = true; engine.onUpdate?.(); });
  el.addEventListener("waiting", () => { engine.loading = true; engine.onUpdate?.(); });
  el.addEventListener("pause",   () => { engine.playing = false; engine.onUpdate?.(); });
  el.addEventListener("error",   () => {
    engine.loading = false; engine.playing = false;
    ui.notifications.warn(loc("AGENTOS.Radio.StreamError"));
    engine.onUpdate?.();
  });
  document.body.appendChild(el);
  engine.audio = el;
  return el;
}

/** Connect to the SSE metadata feed once; cache latest track per station. */
function ensureMeta() {
  if (engine.sse) return;
  try {
    const src = new EventSource(META_URL);
    engine.sse = src;
    src.onmessage = (ev) => handleMeta(ev.data);
    // The feed emits named events per station on some deployments; catch those too.
    src.addEventListener("metadata", (ev) => handleMeta(ev.data));
    src.onerror = () => { /* auto-reconnect handled by EventSource */ };
  } catch (e) {
    console.warn(`${MODULE_ID} | radio meta unavailable`, e);
  }
}

function handleMeta(raw) {
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return; }
  // Payload is either a single station object or an array of them.
  const list = Array.isArray(data) ? data : [data];
  let changed = false;
  for (const d of list) {
    const slug = d.station || d.channel || d.slug;
    if (!slug) continue;
    engine.meta[slug] = {
      artist: d.artist || d.artists || "",
      title: d.title || d.song || "",
      artwork: d.artwork || d.cover || ""
    };
    changed = true;
  }
  if (changed) engine.onUpdate?.();
}

async function playStation(slug, fromSync = false) {
  const el = ensureAudio();
  ensureMeta();
  engine.slug = slug;
  engine.loading = true;
  engine.playing = false;
  el.volume = volume();
  // Cache-bust so re-selecting a station forces a fresh connection.
  el.src = `${STREAM_BASE}/${slug}.ogg`;
  try {
    await el.play();
  } catch (e) {
    engine.loading = false;
    // Autoplay can be blocked until a user gesture. When the GM broadcast tries
    // to start a stream without a local gesture this can fail silently; only
    // surface an error for the user's own explicit action.
    if (!fromSync) ui.notifications.warn(loc("AGENTOS.Radio.StreamError"));
  }
  engine.onUpdate?.();
}

function stop(fromSync = false) {
  if (engine.audio) {
    engine.audio.pause();
    engine.audio.removeAttribute("src");
    engine.audio.load();
  }
  engine.slug = null;
  engine.playing = false;
  engine.loading = false;
  if (!fromSync) engine.onUpdate?.();
}

/** Called by the shell when the device window closes. */
export function onDeviceClose() {
  if (!keepPlaying()) stop();
}

/* ---------------- app view ---------------- */

export async function getData(app) {
  const cur = engine.slug;
  const meta = cur ? (engine.meta[cur] || {}) : {};
  const def = STATIONS.find(s => s.slug === cur) || null;
  const isGM = game.user.isGM;
  const b = broadcast();
  const isFollowing = following();
  // players can't switch stations while the GM broadcast is on (soft-lock)
  const locked = isFollowing;
  return {
    isGM,
    takeover: isGM && b.active,          // GM: takeover currently engaged
    following: isFollowing,              // player: currently under GM broadcast
    locked,
    stations: STATIONS.map(s => ({
      ...s,
      active: s.slug === cur,
      playing: s.slug === cur && engine.playing,
      locked
    })),
    hasStation: !!cur,
    loading: engine.loading,
    playing: engine.playing,
    stationName: def?.name || "",
    stationGenre: def?.genre || "",
    stationColor: def?.color || "#b06bff",
    npArtist: meta.artist || "",
    npTitle: meta.title || "",
    npArtwork: meta.artwork || "",
    hasTrack: !!(meta.artist || meta.title),
    volume: Math.round(volume() * 100),
    keepPlaying: keepPlaying()
  };
}

export function onClose() {
  // Switching to another Agent app keeps playing; just drop the re-render hook.
  if (engine.onUpdate) engine.onUpdate = null;
}

export function activateListeners(app, html) {
  engine.onUpdate = () => { if (app.rendered && app.currentApp === "radio") app.render(false); };

  html.on("click", "[data-action='radio-play']", async (ev) => {
    const slug = ev.currentTarget.dataset.slug;
    // Players may not switch stations while a GM broadcast is running.
    if (following()) { AgentAudio.play("error"); ui.notifications.info(loc("AGENTOS.Radio.Locked")); return; }
    AgentAudio.play("tap");
    if (engine.slug === slug && engine.playing) stop();
    else await playStation(slug);
    // GM with takeover on: propagate the change to everyone.
    if (game.user.isGM && broadcast().active) await pushBroadcast(true);
  });

  html.on("click", "[data-action='radio-stop']", async () => {
    AgentAudio.play("tap");
    // A following player who stops opts out of THIS broadcast command locally.
    if (following()) engine.optOutTs = broadcast().ts;
    stop();
    if (game.user.isGM && broadcast().active) await pushBroadcast(true);
  });

  /* GM only: toggle "takeover" — broadcast the current station to all players. */
  html.on("click", "[data-action='radio-takeover']", async () => {
    if (!game.user.isGM) return;
    AgentAudio.play("tap");
    await pushBroadcast(!broadcast().active);
    app.render(false);
  });

  html.on("click", "[data-action='radio-toggle-keep']", async () => {
    await game.user.setFlag(MODULE_ID, "radioKeepPlaying", !keepPlaying());
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("input", "[name='radio-volume']", (ev) => {
    const v = Math.max(0, Math.min(100, Number(ev.currentTarget.value) || 0));
    game.settings.set(MODULE_ID, "radioVolume", v);
    applyVolume();
    const lbl = html.find(".agentos-radio-vol-val")[0];
    if (lbl) lbl.textContent = `${v}%`;
  });
}
