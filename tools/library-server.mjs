#!/usr/bin/env node
/*
 * Agent OS — Library source server.
 *
 * Serves a local folder of PDF books to the module's "Update files" button.
 * Recursively indexes every .pdf under the folder, writes/serves an
 * `index.json`, and serves the PDFs themselves with permissive CORS so the
 * Foundry client can `fetch` them.
 *
 * No dependencies — plain Node (v18+).
 *
 * USAGE
 *   node library-server.mjs [rootDir] [port]
 *     rootDir  folder with your PDFs (default: current directory)
 *     port     HTTP port (default: 8777)
 *
 * Then expose it to the internet with a tunnel, e.g.:
 *     cloudflared tunnel --url http://localhost:8777
 *   (or)  ngrok http 8777
 *
 * Paste the tunnel's https URL into the Library "Update files" prompt in-game.
 * The module will read <url>/index.json and download every new book.
 *
 * Folder layout example:
 *   books/
 *     Core/Cyberpunk RED Core Rulebook.pdf
 *     DLC/Black Chrome.pdf
 *   -> index.json lists "Core/Cyberpunk RED Core Rulebook.pdf", etc.,
 *      and the module recreates the Core / DLC folders in the Library app.
 */

import fs from "fs";
import path from "path";
import http from "http";

const args = process.argv.slice(2);
const indexOnly = args.includes("--index-only");
const positional = args.filter(a => !a.startsWith("--"));
const ROOT = path.resolve(positional[0] || ".");
const PORT = Number(positional[1] || 8777);

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`Not a directory: ${ROOT}`);
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid port: ${positional[1]}`);
  process.exit(1);
}

/* Recursively collect every .pdf as a forward-slash relative path. */
function collectPdfs(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectPdfs(abs, rel));
    else if (/\.pdf$/i.test(entry.name)) out.push(rel);
  }
  return out;
}

function buildIndex() {
  const files = collectPdfs(ROOT).sort((a, b) => a.localeCompare(b)).map(p => ({
    path: p,
    name: path.basename(p).replace(/\.pdf$/i, "")
  }));
  return { generatedAt: new Date().toISOString(), count: files.length, files };
}

/* Standalone index writer: `node library-server.mjs <dir> --index-only` */
if (indexOnly) {
  const outFile = path.join(ROOT, "index.json");
  fs.writeFileSync(outFile, JSON.stringify(buildIndex(), null, 2));
  console.log(`Wrote ${outFile}`);
  process.exit(0);
}

const MIME = { ".pdf": "application/pdf", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

const server = http.createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { res.writeHead(400, cors); return res.end("bad url"); }

  if (urlPath === "/" || urlPath === "/index.json") {
    const body = JSON.stringify(buildIndex(), null, 2);   // rebuilt live each request
    res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8" });
    return res.end(body);
  }

  // Serve a file, strictly within ROOT (no path traversal).
  const safeRel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const abs = path.join(ROOT, safeRel);
  if (!abs.startsWith(ROOT)) { res.writeHead(403, cors); return res.end("forbidden"); }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404, cors); return res.end("not found"); }

  const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { ...cors, "Content-Type": type, "Content-Length": fs.statSync(abs).size });
  fs.createReadStream(abs).pipe(res);
});

server.listen(PORT, () => {
  const idx = buildIndex();
  console.log(`Agent OS Library source`);
  console.log(`  root : ${ROOT}`);
  console.log(`  books: ${idx.count} PDF(s) indexed`);
  console.log(`  local: http://localhost:${PORT}/index.json`);
  console.log(``);
  console.log(`Expose it with a tunnel, then paste the https URL into the`);
  console.log(`Library "Update files" prompt. For example:`);
  console.log(`  cloudflared tunnel --url http://localhost:${PORT}`);
  console.log(`  ngrok http ${PORT}`);
});

