// Pure renaming logic (no DOM) plus the safe two-phase rename on a directory handle.
(function (global) {
  const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
  const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

  function splitName(name) {
    const i = name.lastIndexOf(".");
    return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ""];
  }

  const pad = (v, w) => String(v).padStart(w, "0");

  function formatDate(d, fmt = "YYYY-MM-DD") {
    return fmt
      .replace("YYYY", d.getFullYear())
      .replace("MM", pad(d.getMonth() + 1, 2))
      .replace("DD", pad(d.getDate(), 2))
      .replace("hh", pad(d.getHours(), 2))
      .replace("mm", pad(d.getMinutes(), 2))
      .replace("ss", pad(d.getSeconds(), 2));
  }

  const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_\-.]+/).filter(Boolean);
  const CASES = {
    keep: (s) => s,
    lower: (s) => s.toLowerCase(),
    upper: (s) => s.toUpperCase(),
    title: (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" "),
    kebab: (s) => words(s).join("-").toLowerCase(),
    snake: (s) => words(s).join("_").toLowerCase(),
  };

  function buildMatcher(opts) {
    if (!opts.find) return null;
    const flags = "g" + (opts.matchCase ? "" : "i");
    const src = opts.regex ? opts.find : opts.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(src, flags); // may throw on a bad regex; caller shows it
  }

  /**
   * files: [{ name, lastModified, size }]
   * opts:  { template, find, replace, regex, matchCase, case, extMode, sort, start, only, parent, excluded:Set }
   * returns rows: [{ old, new, status: ok|same|conflict|invalid|skip, why }]
   */
  function plan(files, opts) {
    const matcher = buildMatcher(opts);
    const only = (opts.only || "").split(/[\s,]+/).map((e) => e.replace(/^\./, "").toLowerCase()).filter(Boolean);
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      date: (a, b) => a.lastModified - b.lastModified || sorters.name(a, b),
      size: (a, b) => a.size - b.size || sorters.name(a, b),
    };
    const sorted = [...files].sort(sorters[opts.sort] || sorters.name);
    let counter = Number.isFinite(+opts.start) ? +opts.start : 1;

    const rows = sorted.map((f) => {
      const [base, ext] = splitName(f.name);
      const typeMatch = !only.length || only.includes(ext.toLowerCase());
      if (!typeMatch || opts.excluded?.has(f.name)) {
        return { old: f.name, new: f.name, status: "skip", filtered: !typeMatch };
      }
      const n = counter++;
      const name = matcher ? base.replace(matcher, opts.replace ?? "") : base;
      let out = (opts.template || "{name}").replace(/\{(\w+)(?::([^}]*))?\}/g, (m, key, arg) => {
        switch (key) {
          case "name": return name;
          case "ext": return ext;
          case "n": return pad(n, +arg || 1);
          case "date": return formatDate(new Date(f.lastModified), arg || undefined);
          case "parent": return opts.parent || "";
          default: return m;
        }
      });
      out = (CASES[opts.case] || CASES.keep)(out).replace(ILLEGAL, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
      const newExt = opts.extMode === "lower" ? ext.toLowerCase() : opts.extMode === "upper" ? ext.toUpperCase() : ext;
      const full = newExt ? `${out}.${newExt}` : out;
      return { old: f.name, new: full, base: out };
    });

    // Windows/macOS treat names case-insensitively, so compare lowercased.
    const finalNames = new Map();
    for (const r of rows) {
      const k = r.new.toLowerCase();
      finalNames.set(k, (finalNames.get(k) || 0) + 1);
    }
    for (const r of rows) {
      if (r.status === "skip") continue;
      if (!r.base) { r.status = "invalid"; r.why = "Name would be empty"; }
      else if (RESERVED.test(r.base)) { r.status = "invalid"; r.why = "Reserved name on Windows"; }
      else if (r.new.length > 255) { r.status = "invalid"; r.why = "Name too long"; }
      else if (finalNames.get(r.new.toLowerCase()) > 1) { r.status = "conflict"; r.why = "Same name as another file"; }
      else r.status = r.new === r.old ? "same" : "ok";
    }
    return rows;
  }

  async function moveFile(dir, from, to) {
    const handle = await dir.getFileHandle(from);
    if (typeof handle.move === "function") {
      await handle.move(to);
      return;
    }
    // Fallback for browsers without FileSystemHandle.move(): copy, then delete.
    const file = await handle.getFile();
    const target = await dir.getFileHandle(to, { create: true });
    const w = await target.createWritable();
    await w.write(file);
    await w.close();
    await dir.removeEntry(from);
  }

  /**
   * Renames pairs [{from, to}] safely: everything goes to a temporary name first,
   * so swaps (a->b, b->a) and case-only changes work. Returns {done, failed}.
   */
  async function applyRenames(dir, pairs, onProgress) {
    const tag = Math.random().toString(36).slice(2, 8);
    const staged = [];
    const failed = [];
    let step = 0;
    const total = pairs.length * 2;
    for (const [i, p] of pairs.entries()) {
      const tmp = `.renaming-${tag}-${i}`;
      try { await moveFile(dir, p.from, tmp); staged.push({ ...p, tmp }); }
      catch (e) { failed.push({ ...p, error: e.message }); }
      onProgress?.(++step, total);
    }
    const done = [];
    for (const p of staged) {
      try { await moveFile(dir, p.tmp, p.to); done.push(p); }
      catch (e) {
        // Put it back under its original name rather than leave a temp file behind.
        try { await moveFile(dir, p.tmp, p.from); } catch {}
        failed.push({ ...p, error: e.message });
      }
      onProgress?.(++step, total);
    }
    return { done, failed };
  }

  global.Renamer = { plan, applyRenames, splitName, formatDate };
})(typeof window !== "undefined" ? window : globalThis);
