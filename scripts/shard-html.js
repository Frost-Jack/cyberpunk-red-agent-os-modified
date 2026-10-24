/* A shard is its own opaque-origin document. Never insert its HTML into Foundry. */
export const MAX_SHARD_LENGTH = 2_000_000;
export const SHARD_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups allow-downloads";

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderMarkdown(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inList = false, inCode = false;
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(raw)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(raw.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (/^\s*---+\s*$/.test(raw)) { out.push("<hr>"); continue; }
    if (raw.trim() === "") { out.push("<br>"); continue; }
    out.push(`<p>${inline(raw)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</pre>");
  return out.join("\n");
}

export function renderShardBody(shard) {
  if (shard.format === "html") return ""; // rendered only inside the sandbox below
  if (shard.format === "markdown") return renderMarkdown(shard.body);
  return escapeHtml(shard.body).replace(/\r?\n/g, "<br>");
}

export function mountShardFrame(frame, source) {
  frame.setAttribute("sandbox", SHARD_SANDBOX);
  frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
  frame.setAttribute("allowfullscreen", "");
  frame.referrerPolicy = "no-referrer";
  frame.srcdoc = shardDocument(source);
}

export function shardDocument(source) {
  const doc = new DOMParser().parseFromString(String(source || ""), "text/html");
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; style-src 'unsafe-inline' https: http:; " +
    "img-src data: blob: https: http:; font-src data: https: http:; " +
    "media-src data: blob: https: http:; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; " +
    "connect-src https: http: wss: ws:; frame-src data: blob: https: http:; worker-src blob:; " +
    "object-src 'none'; base-uri https: http:; form-action https: http:";
  doc.head.prepend(policy);
  if (!doc.querySelector('meta[name="viewport"]')) {
    const viewport = doc.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1";
    doc.head.append(viewport);
  }
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}
