/* NCPD Database: rap sheets. GM can drop an Actor to prefill a record. */

import { loc } from "../constants.js";
import * as Data from "../data.js";
import { AgentAudio } from "../audio.js";

export async function getData(app) {
  const isGM = game.user.isGM;
  const st = app.state;
  const records = (Data.getWorld("ncpdRecords") || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  if (st.recordId) {
    const record = records.find(r => r.id === st.recordId);
    if (!record) { app.state = {}; return getData(app); }
    return { viewing: true, isGM, record };
  }

  return {
    viewing: false,
    isGM,
    records,
    editing: st.editing || null,
    search: st.search || "",
    filtered: (st.search
      ? records.filter(r =>
          r.name.toLowerCase().includes(st.search.toLowerCase()) ||
          (r.faction || "").toLowerCase().includes(st.search.toLowerCase()))
      : records)
  };
}

function readDraft(html, st) {
  const d = st.editing || {};
  d.name = String(html.find("[name='ncpd-name']").val() ?? d.name ?? "");
  d.faction = String(html.find("[name='ncpd-faction']").val() ?? d.faction ?? "");
  d.status = String(html.find("[name='ncpd-status']").val() ?? d.status ?? "");
  d.description = String(html.find("[name='ncpd-desc']").val() ?? d.description ?? "");
  return d;
}

export function activateListeners(app, html) {
  const st = app.state;

  html.on("input", "[name='ncpd-search']", foundry.utils.debounce((ev) => {
    st.search = ev.target.value;
    st.focusSearch = true;
    app.render(false);
  }, 250));
  html.find("[name='ncpd-search']").on("blur", () => { st.focusSearch = false; });
  if (st.focusSearch) {
    const inp = html.find("[name='ncpd-search']")[0];
    if (inp) {
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* noop */ }
    }
  }

  html.on("click", "[data-action='ncpd-open']", (ev) => {
    app.state = { recordId: ev.currentTarget.dataset.recordId };
    AgentAudio.play("tap");
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-back']", () => {
    app.state = {};
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-new']", () => {
    st.editing = { name: "", img: "", faction: "", status: "", description: "" };
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-edit']", (ev) => {
    ev.stopPropagation();
    const r = (Data.getWorld("ncpdRecords") || []).find(x => x.id === ev.currentTarget.dataset.recordId);
    if (!r) return;
    app.state = { editing: foundry.utils.deepClone(r) };
    app.render(false);
  });

  html.on("input", ".agentos-ncpd-form input, .agentos-ncpd-form textarea", () => {
    st.editing = readDraft(html, st);
  });

  html.on("click", "[data-action='ncpd-cancel']", () => {
    st.editing = null;
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-img']", async () => {
    st.editing = readDraft(html, st);
    const path = await app.pickFile("image");
    if (path) st.editing.img = path;
    app.render(false);
  });

  html.on("click", "[data-action='ncpd-save']", (ev) => {
    ev.preventDefault();
    const draft = readDraft(html, st);
    if (!draft.name.trim()) return AgentAudio.play("error");
    st.editing = null;
    AgentAudio.play("tap");
    app.render(false);                      // optimistic: close the form now
    app.mutate("ncpd.save", { record: draft });
  });

  html.on("click", "[data-action='ncpd-delete']", async (ev) => {
    ev.stopPropagation();
    if (!(await app.confirm(loc("AGENTOS.Ncpd.DeleteConfirm")))) return;
    const recordId = ev.currentTarget.dataset.recordId || st.recordId;
    if (st.recordId) app.state = {};
    await app.mutate("ncpd.delete", { recordId });
  });

  /* Actor drag & drop onto the edit form prefills image + name. */
  const dropzone = html.find(".agentos-ncpd-drop")[0];
  if (dropzone) {
    dropzone.addEventListener("dragover", (ev) => { ev.preventDefault(); dropzone.classList.add("over"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
    dropzone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      dropzone.classList.remove("over");
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "Actor") return;
        const actor = await fromUuid(data.uuid);
        if (!actor) return;
        st.editing = readDraft(html, st);
        st.editing.name = st.editing.name || actor.name;
        st.editing.img = actor.img || st.editing.img;
        if (!st.editing.name) st.editing.name = actor.name;
        AgentAudio.play("tap");
        app.render(false);
      } catch (e) { /* not an actor drop */ }
    });
  }
}
