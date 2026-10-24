import { TPL, loc } from "./constants.js";
import { mountShardFrame, renderShardBody } from "./shard-html.js";

/** An independent snapshot: resizing and zooming never recreate its document. */
export class ShardReader extends Application {
  constructor(shard, options = {}) {
    super(options);
    this.shard = { title: String(shard.title || ""), body: String(shard.body || ""), format: shard.format || "plain" };
    this.pageZoom = 1;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: TPL("shard-reader"), classes: ["agentos-shard-reader"],
      width: 820, height: 680, resizable: true, minimizable: true, popOut: true
    });
  }

  get title() { return this.shard.title || loc("AGENTOS.Data.Preview"); }

  getData() { return { title: this.title, zoom: Math.round(this.pageZoom * 100) }; }

  activateListeners(html) {
    super.activateListeners(html);
    const frame = html.find(".agentos-reader-frame")[0];
    this.element.find(".window-resizable-handle").off("pointerdown.agentosShard").on("pointerdown.agentosShard", ev => {
      ev.currentTarget.setPointerCapture(ev.originalEvent.pointerId);
    });
    const source = this.shard.format === "html" ? this.shard.body :
      `<!doctype html><html><head><style>body{margin:24px;font:16px/1.55 system-ui,sans-serif;overflow-wrap:anywhere;color:#e9edf2;background:#141920}a{color:#38d4ff}img,video{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${renderShardBody(this.shard)}</body></html>`;
    mountShardFrame(frame, source);
    const zoom = value => {
      this.pageZoom = Math.max(0.5, Math.min(2, Math.round(value * 100) / 100));
      frame.style.width = `${100 / this.pageZoom}%`;
      frame.style.height = `${100 / this.pageZoom}%`;
      frame.style.transform = `scale(${this.pageZoom})`;
      html.find("[data-action='shard-zoom-reset']").text(`${Math.round(this.pageZoom * 100)}%`);
    };
    html.on("click", "[data-action='shard-zoom-in']", () => zoom(this.pageZoom + 0.1));
    html.on("click", "[data-action='shard-zoom-out']", () => zoom(this.pageZoom - 0.1));
    html.on("click", "[data-action='shard-zoom-reset']", () => zoom(1));
    zoom(this.pageZoom);
  }
}
