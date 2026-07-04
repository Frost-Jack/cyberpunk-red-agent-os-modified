/* CI verifier for the Agent OS module. Run from anywhere:
 *   node tools/verify.mjs
 *
 * Checks:
 *   1. module.json / lang JSON validity + full en↔ru key parity
 *   2. Handlebars block balance + partial paths + i18n key existence
 *   3. JS syntax (node --check on every scripts/*.js as an ES module)
 *   4. data-action / field cross-reference between templates and JS
 *   5. CSS brace balance
 *   6. loadTemplates() names vs template files on disk
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let errors = 0;
const err = (m) => { errors++; console.log("ERROR: " + m); };

/* ---- 1. JSON validity + key parity ---- */
const flat = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  typeof v === "object" && v !== null ? flat(v, prefix + k + ".") : [prefix + k]);

let en = {}, ru = {};
try { en = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8")); } catch (e) { err("en.json: " + e.message); }
try { ru = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/ru.json"), "utf8")); } catch (e) { err("ru.json: " + e.message); }
try { JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")); } catch (e) { err("module.json: " + e.message); }

const enKeys = new Set(flat(en)), ruKeys = new Set(flat(ru));
for (const k of enKeys) if (!ruKeys.has(k)) err("ru.json missing: " + k);
for (const k of ruKeys) if (!enKeys.has(k)) err("en.json missing: " + k);
console.log(`Lang parity: en=${enKeys.size} ru=${ruKeys.size}`);

/* ---- 2. HBS block balance + i18n keys + partial paths ---- */
const tplDir = path.join(ROOT, "templates");
const tplFiles = fs.readdirSync(tplDir).filter(f => f.endsWith(".hbs"));
const usedKeys = new Set();
const tplActions = new Set();
const tplNames = new Set();

for (const f of tplFiles) {
  const src = fs.readFileSync(path.join(tplDir, f), "utf8");
  const stack = [];
  const re = /\{\{([#/])(\w+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === "#") stack.push(m[2]);
    else {
      const open = stack.pop();
      if (open !== m[2]) err(`${f}: block mismatch — {{/${m[2]}}} closes {{#${open}}}`);
    }
  }
  if (stack.length) err(`${f}: unclosed blocks: ${stack.join(", ")}`);

  for (const km of src.matchAll(/localize\s+"([^"]+)"/g)) usedKeys.add(km[1]);
  for (const am of src.matchAll(/data-action="([\w-]+)"/g)) tplActions.add(am[1]);
  for (const nm of src.matchAll(/name="([\w-]+)"/g)) tplNames.add(nm[1]);
  for (const pm of src.matchAll(/\{\{>\s*"([^"]+)"/g)) {
    const rel = pm[1].replace(/^modules\/[^/]+\//, "");
    if (!fs.existsSync(path.join(ROOT, rel))) err(`${f}: missing partial ${pm[1]}`);
  }
}
console.log(`HBS files checked: ${tplFiles.length}`);

/* ---- 3. JS syntax + i18n keys + actions ---- */
const jsFiles = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".js")) jsFiles.push(p);
  }
};
walk(path.join(ROOT, "scripts"));

const jsActions = new Set(), jsNames = new Set();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-verify-"));
for (const p of jsFiles) {
  const src = fs.readFileSync(p, "utf8");
  for (const km of src.matchAll(/(?:localize|loc)\(\s*"(AGENTOS\.[^"]+)"/g)) usedKeys.add(km[1]);
  for (const am of src.matchAll(/data-action='([\w-]+)'/g)) jsActions.add(am[1]);
  for (const nm of src.matchAll(/\[name='([\w-]+)'\]/g)) jsNames.add(nm[1]);

  const tmp = path.join(tmpDir, path.basename(path.dirname(p)) + "_" + path.basename(p, ".js") + ".mjs");
  fs.copyFileSync(p, tmp);
  const res = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  if (res.status !== 0) err(`syntax ${path.relative(ROOT, p)}: ${res.stderr.split("\n")[0]}`);
}
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`JS files checked: ${jsFiles.length}`);

/* dynamic i18n keys built at runtime */
["stable", "wounded", "critical"].forEach(s => usedKeys.add("AGENTOS.Bio.State." + s));
["phone", "tablet", "pc"].forEach(s => usedKeys.add("AGENTOS.Mode." + s));
["chat", "datapool", "wallet", "contacts", "map", "bio", "chrome", "radio", "store", "id",
 "ncpd", "garden", "library", "tools", "arcade", "admin"].forEach(s => usedKeys.add("AGENTOS.AppShort." + s));

for (const k of usedKeys) {
  if (k.startsWith("AGENTOS.") && !enKeys.has(k)) err("en.json missing used key: " + k);
}
console.log(`i18n keys referenced: ${usedKeys.size}`);

const constSrc = fs.readFileSync(path.join(ROOT, "scripts/constants.js"), "utf8");
for (const km of constSrc.matchAll(/labelKey:\s*"([^"]+)"/g)) {
  if (!enKeys.has(km[1])) err("en.json missing labelKey: " + km[1]);
}

/* ---- 4. action / field cross-reference ---- */
for (const a of tplActions) if (!jsActions.has(a)) err("template action WITHOUT JS handler: " + a);
for (const a of jsActions) if (!tplActions.has(a)) err("JS handler WITHOUT template action: " + a);
for (const n of jsNames) if (!tplNames.has(n)) err("JS reads field missing in templates: " + n);
console.log(`actions: templates=${tplActions.size} js=${jsActions.size}`);

/* ---- 5. CSS brace balance ---- */
const css = fs.readFileSync(path.join(ROOT, "styles/agent.css"), "utf8");
let depth = 0, line = 1;
for (const ch of css) {
  if (ch === "\n") line++;
  if (ch === "{") depth++;
  if (ch === "}") depth--;
  if (depth < 0) { err("CSS: extra } at line " + line); break; }
}
if (depth > 0) err("CSS: " + depth + " unclosed {");
console.log("CSS brace depth final: " + depth);

/* ---- 6. loadTemplates names vs files ---- */
const mainSrc = fs.readFileSync(path.join(ROOT, "scripts/main.js"), "utf8");
const ltMatch = mainSrc.match(/await loadTemplates\(\[([\s\S]*?)\]\.map/);
if (ltMatch) {
  const names = [...ltMatch[1].matchAll(/"([\w-]+)"/g)].map(m => m[1]);
  for (const n of names) {
    if (!fs.existsSync(path.join(tplDir, n + ".hbs"))) err("loadTemplates references missing template: " + n);
  }
}

console.log(errors ? `\n${errors} ERROR(S)` : "\nALL CHECKS PASSED");
process.exit(errors ? 1 : 0);
