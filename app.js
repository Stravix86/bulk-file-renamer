(function () {
  const $ = (s) => document.querySelector(s);
  const FIELDS = ["template", "find", "replace", "regex", "matchCase", "case", "extMode", "sort", "start", "only"];
  const PRESETS = {
    photos: { template: "{date}_{n:3}", case: "keep", extMode: "lower", sort: "date", start: 1 },
    numbered: { template: "{parent}_{n:3}", case: "keep", sort: "name", start: 1 },
    clean: { template: "{name}", case: "kebab", extMode: "lower", find: "", replace: "" },
    reset: { template: "{name}", find: "", replace: "", regex: false, matchCase: false, case: "keep", extMode: "keep", sort: "name", start: 1, only: "" },
  };
  const state = { dir: null, files: [], rows: [], excluded: new Set(), undo: null, busy: false };

  const setMsg = (text, error = false) => {
    $("#message").textContent = text;
    $("#message").className = error ? "error" : "";
  };

  function readOpts() {
    const o = {};
    for (const id of FIELDS) {
      const el = $("#" + id);
      o[id] = el.type === "checkbox" ? el.checked : el.value;
    }
    o.parent = state.dir?.name || "";
    o.excluded = state.excluded;
    return o;
  }

  function writeOpts(o) {
    for (const [k, v] of Object.entries(o)) {
      const el = $("#" + k);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    }
  }

  function save() {
    try {
      const { parent, excluded, ...o } = readOpts();
      localStorage.setItem("bfr-opts", JSON.stringify(o));
    } catch {}
  }

  async function scan() {
    const files = [];
    for await (const [name, handle] of state.dir.entries()) {
      if (handle.kind !== "file" || name.startsWith(".renaming-")) continue;
      const f = await handle.getFile();
      files.push({ name, lastModified: f.lastModified, size: f.size });
    }
    state.files = files;
    for (const n of [...state.excluded]) if (!files.some((f) => f.name === n)) state.excluded.delete(n);
  }

  function render() {
    if (!state.dir) return;
    let rows;
    try {
      rows = Renamer.plan(state.files, readOpts());
      if (!state.busy) setMsg("");
    } catch (e) {
      setMsg("Find pattern isn't valid: " + e.message, true);
      return;
    }
    state.rows = rows;

    const frag = document.createDocumentFragment();
    for (const r of rows) {
      if (r.filtered) continue;
      const tr = document.createElement("tr");
      tr.className = r.status;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !state.excluded.has(r.old);
      cb.dataset.name = r.old;
      const c0 = document.createElement("td"); c0.className = "c"; c0.append(cb);
      const c1 = document.createElement("td"); c1.className = "old"; c1.textContent = r.old;
      const c2 = document.createElement("td"); c2.className = "new"; c2.textContent = r.status === "skip" ? "(not renamed)" : r.new;
      if (r.why) { const s = document.createElement("span"); s.className = "why"; s.textContent = r.why; c2.append(s); }
      tr.append(c0, c1, c2);
      frag.append(tr);
    }
    $("#rows").replaceChildren(frag);

    const count = (s) => rows.filter((r) => r.status === s).length;
    const ok = count("ok"), bad = count("conflict") + count("invalid"), shown = rows.filter((r) => !r.filtered).length;
    $("#summary").textContent = `${shown} file${shown === 1 ? "" : "s"} · ${ok} will be renamed` + (bad ? ` · ${bad} problem${bad === 1 ? "" : "s"} to fix` : "");
    $("#apply").disabled = state.busy || ok === 0 || bad > 0;
    $("#apply").textContent = ok ? `Rename ${ok} file${ok === 1 ? "" : "s"}` : "Rename files";
    $("#all").checked = rows.every((r) => r.filtered || !state.excluded.has(r.old));
  }

  let timer;
  const update = () => { clearTimeout(timer); timer = setTimeout(() => { save(); render(); }, 60); };

  async function loadDir(dir) {
    state.dir = dir;
    state.excluded.clear();
    state.undo = null;
    $("#undo").disabled = true;
    $("#folder").textContent = "📁 " + dir.name;
    await scan();
    render();
  }

  async function run(pairs, label) {
    state.busy = true;
    $("#apply").disabled = $("#undo").disabled = $("#pick").disabled = true;
    try {
      const res = await Renamer.applyRenames(state.dir, pairs, (i, t) => setMsg(`${label}… ${Math.round((i / t) * 100)}%`));
      await scan();
      return res;
    } finally {
      state.busy = false;
      $("#pick").disabled = false;
    }
  }

  async function apply() {
    const pairs = state.rows.filter((r) => r.status === "ok").map((r) => ({ from: r.old, to: r.new }));
    if (!pairs.length) return;
    if (!confirm(`Rename ${pairs.length} file${pairs.length === 1 ? "" : "s"} in "${state.dir.name}"?`)) return;
    const { done, failed } = await run(pairs, "Renaming");
    state.undo = done.map((p) => ({ from: p.to, to: p.from }));
    render();
    $("#undo").disabled = !state.undo.length;
    setMsg(failed.length
      ? `Renamed ${done.length}. ${failed.length} failed: ${failed.slice(0, 3).map((f) => `${f.from} (${f.error})`).join("; ")}`
      : `Renamed ${done.length} file${done.length === 1 ? "" : "s"}. You can undo this.`, failed.length > 0);
  }

  async function undo() {
    if (!state.undo?.length) return;
    const { done, failed } = await run(state.undo, "Undoing");
    state.undo = null;
    render();
    setMsg(failed.length ? `Restored ${done.length}. ${failed.length} couldn't be restored.` : `Restored ${done.length} original name${done.length === 1 ? "" : "s"}.`, failed.length > 0);
  }

  // ---- wiring ----
  if (!("showDirectoryPicker" in window)) {
    $("#unsupported").hidden = false;
    $("#pick").disabled = true;
  }
  try { writeOpts(JSON.parse(localStorage.getItem("bfr-opts") || "{}")); } catch {}

  $("#pick").onclick = async () => {
    try { await loadDir(await window.showDirectoryPicker({ mode: "readwrite" })); }
    catch (e) { if (e.name !== "AbortError") setMsg(e.message, true); }
  };
  $("#apply").onclick = apply;
  $("#undo").onclick = undo;
  for (const id of FIELDS) $("#" + id).addEventListener("input", update);
  document.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => { writeOpts(PRESETS[b.dataset.preset]); update(); }));
  document.querySelectorAll("[data-token]").forEach((b) => (b.onclick = () => {
    const t = $("#template"), pos = t.selectionStart ?? t.value.length;
    t.value = t.value.slice(0, pos) + b.dataset.token + t.value.slice(t.selectionEnd ?? pos);
    t.focus();
    update();
  }));
  $("#rows").addEventListener("change", (e) => {
    const n = e.target.dataset.name;
    if (!n) return;
    e.target.checked ? state.excluded.delete(n) : state.excluded.add(n);
    update();
  });
  $("#all").onchange = (e) => {
    for (const r of state.rows) if (!r.filtered) e.target.checked ? state.excluded.delete(r.old) : state.excluded.add(r.old);
    update();
  };

  // Hook for automated tests (e.g. against the browser's private file system).
  window.__renamerApp = { loadDir, apply, undo, state };
})();
