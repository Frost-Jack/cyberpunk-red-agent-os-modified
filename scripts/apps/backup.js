import { loc } from "../constants.js";
import { BACKUP_SECTIONS, exportBackup, previewBackup, validateBackup } from "../backup.js";

function download(sections) {
  const data = exportBackup(sections);
  saveDataToFile(JSON.stringify(data, null, 2), "application/json", `agent-${data.worldId}-${Date.now()}.json`);
}
export function getData(app) {
  if (!game.user.isGM) return {};
  const st = app.state;
  let mapping = {};
  try { mapping = JSON.parse(st.userMapText || "{}"); } catch { /* preview displays the error */ }
  return { sections: Object.keys(BACKUP_SECTIONS).map(id => ({ id, label: loc(`AGENTOS.Backup.Section.${id}`), selected: (st.sections || Object.keys(BACKUP_SECTIONS)).includes(id), available: !st.backup || st.backup.sections.includes(id) })),
    mode: st.mode || "merge", plan: st.plan, error: st.error || "", userMap: st.userMapText || "{}",
    users: st.backup?.users.map(u => ({ ...u, targets: game.users.map(target => ({ id: target.id, name: `${target.name}${target.character ? ` (${target.character.name})` : ""}`, selected: mapping[u.id] === target.id })) })), crossWorld: st.backup && st.backup.worldId !== game.world?.id };
}
export function activateListeners(app, html) {
  if (!game.user.isGM) return;
  const st = app.state;
  const selection = () => html.find("[name='backup-section']:checked:enabled").map((_, e) => e.value).get();
  html.on("change", "[data-action='backup-map-user']", ev => {
    let mapping = {};
    try { mapping = JSON.parse(st.userMapText || "{}"); } catch { /* start a new explicit mapping */ }
    const source = st.backup.users.find(u => u.id === ev.currentTarget.dataset.sourceId);
    const target = game.users.get(ev.currentTarget.value);
    mapping[source.id] = target?.id || null;
    if (source.actorUuid) { if (target?.character) mapping[source.actorUuid] = target.character.uuid; else delete mapping[source.actorUuid]; }
    st.userMapText = JSON.stringify(mapping, null, 2); st.plan = null; app.render(false);
  });
  html.on("change", "[name='backup-section'], [name='backup-mode'], [name='backup-map']", () => {
    st.sections = selection(); st.mode = html.find("[name='backup-mode']").val(); st.userMapText = html.find("[name='backup-map']").val(); st.plan = null;
  });
  html.on("click", "[data-action='backup-export']", () => download(selection()));
  html.on("change", "[name='backup-file']", async ev => {
    try {
      const file = ev.target.files[0];
      if (!file || file.size > 25 * 1024 * 1024) throw new Error(loc("AGENTOS.Backup.Invalid"));
      st.backup = validateBackup(JSON.parse(await file.text()));
      st.sections = st.backup.sections; st.plan = null; st.error = "";
    } catch (error) { st.backup = null; st.error = error.message; }
    app.render(false);
  });
  html.on("click", "[data-action='backup-preview']", async () => {
    try {
      st.sections = selection(); st.mode = html.find("[name='backup-mode']").val(); st.userMapText = html.find("[name='backup-map']").val();
      st.plan = await previewBackup(st.backup, st.sections, st.mode, JSON.parse(st.userMapText || "{}")); st.error = "";
    } catch (error) { st.plan = null; st.error = error.message; }
    app.render(false);
  });
  html.on("click", "[data-action='backup-restore']", async () => {
    if (!st.plan || st.restoring) return;
    if (!(await app.confirm(loc("AGENTOS.Backup.Restore"), loc(st.mode === "replace" ? "AGENTOS.Backup.ConfirmReplace" : "AGENTOS.Backup.ConfirmMerge")))) return;
    if (html.find("[name='backup-current']").prop("checked")) download(st.sections);
    st.restoring = true;
    try { await app.mutate("backup.restore", { backup: st.backup, sections: st.sections, mode: st.mode, userMap: JSON.parse(st.userMapText || "{}") }); }
    finally { st.restoring = false; }
  });
}
