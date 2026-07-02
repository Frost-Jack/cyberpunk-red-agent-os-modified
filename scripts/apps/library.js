/* Library — a phone-style file browser for system PDF books.
 *
 * The tree (folders + file metadata) lives in the world setting `libraryTree`;
 * the PDFs themselves are downloaded by the GM into a module upload folder so
 * players open them locally without needing the external source online.
 *
 * Tree node shapes (flat list, linked by parentId):
 *   folder: { id, type:'folder', name, parentId }
 *   file:   { id, type:'file', name, parentId, src, cover, sourceKey }
 *     - src       : Foundry-relative path to the downloaded PDF
 *     - cover     : Foundry-relative path to the rendered first-page PNG ("" if none)
 *     - sourceKey : the source-relative path, used to skip re-downloads
 */

import { MODULE_ID, loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

const UPLOAD_DIR = `${MODULE_ID}-library`;

/* ------------------------------------------------------------------ */
/* getData                                                             */
/* ------------------------------------------------------------------ */

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const tree = Data.getWorld("libraryTree") || [];
  const cwd = st.folderId || null;

  const folder = cwd ? tree.find(n => n.id === cwd && n.type === "folder") : null;
  if (cwd && !folder) { st.folderId = null; return getData(app); }

  const children = tree.filter(n => (n.parentId || null) === cwd);
  const folders = children.filter(n => n.type === "folder")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(n => ({ id: n.id, name: n.name, count: tree.filter(c => c.parentId === n.id).length }));
  const files = children.filter(n => n.type === "file")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(n => ({ id: n.id, name: displayName(n.name), src: n.src, cover: n.cover || "" }));

  /* breadcrumb path root → cwd */
  const crumbs = [];
  let p = folder;
  while (p) { crumbs.unshift({ id: p.id, name: p.name }); p = tree.find(n => n.id === p.parentId); }

  return {
    isGM,
    atRoot: !cwd,
    crumbs,
    folders,
    files,
    empty: !folders.length && !files.length,
    busy: !!st.busy,
    busyText: st.busyText || "",
    sourceUrl: game.settings.get(MODULE_ID, "librarySourceUrl") || ""
  };
}

/** Strip a trailing .pdf (case-insensitive) for display. */
function displayName(name) {
  return String(name).replace(/\.pdf$/i, "");
}

/* ------------------------------------------------------------------ */
/* listeners                                                          */
/* ------------------------------------------------------------------ */

export function activateListeners(app, html) {
  const st = app.state;
  const isGM = game.user.isGM;

  html.on("click", "[data-action='lib-open-folder']", (ev) => {
    st.folderId = ev.currentTarget.dataset.nodeId;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='lib-crumb']", (ev) => {
    st.folderId = ev.currentTarget.dataset.nodeId || null;
    app.render(false);
  });

  html.on("click", "[data-action='lib-up']", () => {
    const tree = Data.getWorld("libraryTree") || [];
    const cur = tree.find(n => n.id === st.folderId);
    st.folderId = cur?.parentId || null;
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='lib-open-file']", (ev) => {
    openBook(ev.currentTarget.dataset.src, ev.currentTarget.dataset.title);
  });

  /* GM: right-click a book → rename / delete */
  if (isGM) {
    html.on("contextmenu", "[data-action='lib-open-file']", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showFileMenu(app, html, ev);
    });

    html.on("click", "[data-action='lib-refresh']", async () => {
      const url = await app.promptText(
        loc("AGENTOS.Library.SourcePrompt"),
        game.settings.get(MODULE_ID, "librarySourceUrl") || "",
        "https://example.com/library/"
      );
      if (url === null) return;
      const clean = url.trim();
      if (!clean) return;
      await game.settings.set(MODULE_ID, "librarySourceUrl", clean);
      await refreshFromSource(app, clean);
    });
  }
}

/* ------------------------------------------------------------------ */
/* open a book in Foundry's built-in PDF viewer                        */
/* ------------------------------------------------------------------ */

function openBook(src, title) {
  if (!src) return;
  AgentAudio.play("tap");
  const url = foundry.utils.getRoute(src);
  try {
    // Foundry v12 bundles pdf.js; ImagePopout-style frame keeps focus in-app.
    new LibraryReader({ src: url, title: title || "PDF" }).render(true);
  } catch (e) {
    window.open(url, "_blank", "noopener");
  }
}

/** A minimal framed PDF reader (Foundry's bundled pdf.js viewer in an iframe). */
class LibraryReader extends Application {
  constructor({ src, title }, options = {}) {
    super(options);
    this._src = src;
    this._docTitle = title;
  }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["agentos-pdf-reader"],
      width: 860,
      height: 900,
      resizable: true,
      popOut: true
    });
  }
  get title() { return this._docTitle; }
  async _renderInner() {
    const viewer = foundry.utils.getRoute("scripts/pdfjs/web/viewer.html");
    const url = `${viewer}?file=${encodeURIComponent(this._src)}`;
    return $(`<iframe class="agentos-pdf-frame" src="${url}"></iframe>`);
  }
}

/* ------------------------------------------------------------------ */
/* GM context menu (rename / delete)                                   */
/* ------------------------------------------------------------------ */

function showFileMenu(app, html, ev) {
  const nodeId = ev.currentTarget.dataset.nodeId;
  const currentName = ev.currentTarget.dataset.title || "";
  const body = html.find(".agentos-app-body")[0];
  if (!body) return;
  body.querySelector(".agentos-ctx-menu")?.remove();

  const zoom = app.zoom || 1;
  const rect = body.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "agentos-ctx-menu";

  const mkItem = (icon, label, danger, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "agentos-ctx-item" + (danger ? " danger" : "");
    b.innerHTML = `<i class="fas ${icon}"></i> ${Handlebars.escapeExpression(label)}`;
    b.addEventListener("click", fn);
    return b;
  };

  menu.appendChild(mkItem("fa-pen", loc("AGENTOS.Common.Edit"), false, async () => {
    menu.remove();
    const name = await app.promptText(loc("AGENTOS.Library.RenameBook"), currentName);
    if (name === null || !name.trim()) return;
    await app.mutate("library.renameFile", { nodeId, name: name.trim() });
  }));
  menu.appendChild(mkItem("fa-trash", loc("AGENTOS.Common.Delete"), true, async () => {
    menu.remove();
    if (!(await app.confirm(loc("AGENTOS.Library.DeleteBook")))) return;
    await app.mutate("library.deleteFile", { nodeId });
  }));
  body.appendChild(menu);

  let x = (ev.clientX - rect.left) / zoom + body.scrollLeft;
  let y = (ev.clientY - rect.top) / zoom + body.scrollTop;
  x = Math.min(x, body.scrollLeft + body.clientWidth - menu.offsetWidth - 6);
  y = Math.min(y, body.scrollTop + body.clientHeight - menu.offsetHeight - 6);
  menu.style.left = `${Math.max(2, x)}px`;
  menu.style.top = `${Math.max(2, y)}px`;

  const dismiss = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener("pointerdown", dismiss, true);
  };
  document.addEventListener("pointerdown", dismiss, true);
}

/* ------------------------------------------------------------------ */
/* refresh: pull index.json, download new PDFs, render covers          */
/* ------------------------------------------------------------------ */

async function refreshFromSource(app, rawUrl) {
  const st = app.state;
  const setBusy = (text) => { st.busy = true; st.busyText = text; app.render(false); };
  setBusy(loc("AGENTOS.Library.Fetching"));

  try {
    // Resolve the index URL and the base directory that book paths are
    // relative to. If the user pasted ".../index.json", the base is that
    // file's DIRECTORY (not the file itself + "/").
    const isJson = /\.json($|\?)/i.test(rawUrl);
    const indexUrl = isJson ? rawUrl : (rawUrl.endsWith("/") ? rawUrl : rawUrl + "/") + "index.json";
    const base = indexUrl.replace(/[^/]*$/, "");   // strip the filename → directory URL
    const res = await fetch(indexUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = await res.json();
    const entries = normalizeIndex(index);
    if (!entries.length) throw new Error("empty index");

    // ensure upload dir
    try { await FilePicker.createDirectory("data", UPLOAD_DIR); } catch (e) { /* exists */ }

    const tree = Data.getWorld("libraryTree") || [];
    const bySourceKey = new Map(tree.filter(n => n.type === "file" && n.sourceKey).map(n => [n.sourceKey, n]));
    const folderByPath = new Map();
    // seed folderByPath from existing folders (rebuild path → id)
    const pathOf = (node) => {
      const parts = [];
      let p = node;
      while (p) { parts.unshift(p.name); p = tree.find(n => n.id === p.parentId); }
      return parts.join("/");
    };
    for (const n of tree) if (n.type === "folder") folderByPath.set(pathOf(n), n.id);

    let added = 0, skipped = 0, failed = 0;
    const total = entries.length;
    let done = 0;

    for (const entry of entries) {
      done++;
      setBusy(loc("AGENTOS.Library.Downloading", { done, total }));

      if (bySourceKey.has(entry.path)) { skipped++; continue; }

      // ensure folder chain exists
      const dirParts = entry.path.split("/").slice(0, -1);
      let parentId = null;
      let accum = "";
      for (const part of dirParts) {
        accum = accum ? `${accum}/${part}` : part;
        if (folderByPath.has(accum)) { parentId = folderByPath.get(accum); continue; }
        const fid = `libf_${foundry.utils.randomID(10)}`;
        tree.push({ id: fid, type: "folder", name: part, parentId });
        folderByPath.set(accum, fid);
        parentId = fid;
      }

      try {
        const fileUrl = base + entry.path.split("/").map(encodeURIComponent).join("/");
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const safe = safeName(entry.path);
        const file = new File([blob], safe, { type: "application/pdf" });
        const up = await FilePicker.upload("data", UPLOAD_DIR, file, {});
        const src = up?.path;
        if (!src) throw new Error("upload failed");

        let cover = "";
        try { cover = await renderCover(src, safe); } catch (e) { /* cover optional */ }

        tree.push({
          id: `libx_${foundry.utils.randomID(10)}`,
          type: "file",
          name: entry.name || displayName(safe),
          parentId,
          src,
          cover,
          sourceKey: entry.path
        });
        added++;
      } catch (e) {
        console.warn(`${MODULE_ID} | library download failed for ${entry.path}`, e);
        failed++;
      }
    }

    await Data.setWorldGM("libraryTree", tree);
    st.busy = false;
    st.busyText = "";
    app.render(false);
    ui.notifications.info(loc("AGENTOS.Library.Done", { added, skipped, failed }));
    AgentAudio.play("cash");
  } catch (e) {
    console.error(`${MODULE_ID} | library refresh failed`, e);
    st.busy = false;
    st.busyText = "";
    app.render(false);
    ui.notifications.error(loc("AGENTOS.Library.Failed"));
    AgentAudio.play("error");
  }
}

/** Accept either a flat {files:[...]} list or a nested folder tree. */
function normalizeIndex(index) {
  const out = [];
  const isPdf = (n) => /\.pdf$/i.test(n);
  if (Array.isArray(index)) {
    for (const f of index) if (typeof f === "string" && isPdf(f)) out.push({ path: f, name: displayName(f.split("/").pop()) });
    return out;
  }
  if (Array.isArray(index?.files)) {
    for (const f of index.files) {
      if (typeof f === "string") { if (isPdf(f)) out.push({ path: f, name: displayName(f.split("/").pop()) }); }
      else if (f?.path && isPdf(f.path)) out.push({ path: f.path, name: f.name || displayName(f.path.split("/").pop()) });
    }
    return out;
  }
  // nested { name, children:[...] } tree
  const walk = (node, prefix) => {
    if (!node) return;
    if (Array.isArray(node.children)) {
      const dir = prefix ? `${prefix}/${node.name}` : (node.name || "");
      for (const c of node.children) walk(c, node.name === undefined ? prefix : dir);
    } else if (node.file && isPdf(node.file)) {
      out.push({ path: prefix ? `${prefix}/${node.file}` : node.file, name: node.name || displayName(node.file) });
    }
  };
  walk(index, "");
  return out;
}

function safeName(sourcePath) {
  // flatten the source path into a unique, filesystem-safe filename
  const base = sourcePath.replace(/[^\w.\-\/]+/g, "_").replace(/\//g, "__");
  return /\.pdf$/i.test(base) ? base : base + ".pdf";
}

/* Render the first PDF page to a PNG via Foundry's bundled pdf.js, upload it. */
async function renderCover(pdfSrc, baseName) {
  const pdfjsLib = globalThis.pdfjsLib || globalThis.pdfjsDistBuildPdf;
  if (!pdfjsLib) {
    // pdf.js not exposed as a global — try the viewer path dynamically
    try {
      const mod = await import(foundry.utils.getRoute("scripts/pdfjs/build/pdf.mjs"));
      if (mod?.getDocument) return await rasterize(mod, pdfSrc, baseName);
    } catch (e) { /* fall through */ }
    return "";
  }
  return await rasterize(pdfjsLib, pdfSrc, baseName);
}

async function rasterize(pdfjs, pdfSrc, baseName) {
  try {
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = foundry.utils.getRoute("scripts/pdfjs/build/pdf.worker.mjs");
    }
  } catch (e) { /* noop */ }
  const doc = await pdfjs.getDocument(foundry.utils.getRoute(pdfSrc)).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const targetW = 320;
  const scale = targetW / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(scaled.width);
  canvas.height = Math.round(scaled.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: scaled }).promise;
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return "";
  const file = new File([blob], baseName.replace(/\.pdf$/i, "") + ".cover.png", { type: "image/png" });
  const up = await FilePicker.upload("data", UPLOAD_DIR, file, {});
  return up?.path || "";
}
