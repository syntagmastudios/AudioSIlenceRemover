"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  health: $("health"),
  folder: $("folder"),
  scanBtn: $("scanBtn"),
  minSilence: $("minSilence"),
  minSilenceNum: $("minSilenceNum"),
  thresh: $("thresh"),
  threshNum: $("threshNum"),
  padding: $("padding"),
  paddingNum: $("paddingNum"),
  outputDir: $("outputDir"),
  analyzeAllBtn: $("analyzeAllBtn"),
  cutSelectedBtn: $("cutSelectedBtn"),
  summary: $("summary"),
  fileList: $("fileList"),
  log: $("log"),
  selectAll: $("selectAll"),
};

const state = {
  root: null,
  files: [],          // {path, name, rel, size}
  analyses: {},       // path -> analyze result
  status: {},         // path -> 'idle' | 'analyzing' | 'done' | 'no-silence' | 'cut' | 'error' | 'skipped'
  busy: false,
};

/* ---------- formatting ---------- */

function fmtMs(ms) {
  const s = ms / 1000;
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m${String(Math.floor(s % 60)).padStart(2, "0")}s`;
  }
  if (s >= 60) return `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, "0")}s`;
  return `${s.toFixed(1)}s`;
}

function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function getSettings() {
  return {
    min_silence_ms: Math.round(parseFloat(els.minSilence.value) * 1000),
    silence_thresh_db: parseFloat(els.thresh.value),
    padding_ms: Math.round(parseFloat(els.padding.value) * 1000),
  };
}

function getOutputMode() {
  return document.querySelector('input[name="outmode"]:checked').value;
}

/* ---------- logging ---------- */

function log(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  const t = new Date().toLocaleTimeString();
  line.textContent = `[${t}] ${msg}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

/* ---------- settings sync ---------- */

function bindRange(range, num, fmt) {
  const syncFromRange = () => {
    num.value = fmt ? fmt(parseFloat(range.value)) : range.value;
  };
  const syncFromNum = () => {
    let v = parseFloat(num.value);
    if (isNaN(v)) return;
    v = Math.min(parseFloat(range.max), Math.max(parseFloat(range.min), v));
    range.value = v;
  };
  range.addEventListener("input", syncFromRange);
  num.addEventListener("change", syncFromNum);
  num.addEventListener("input", syncFromNum);
  syncFromRange();
}

bindRange(els.minSilence, els.minSilenceNum, (v) => v.toFixed(1));
bindRange(els.thresh, els.threshNum);
bindRange(els.padding, els.paddingNum, (v) => v.toFixed(2));

/* ---------- rendering ---------- */

function renderSummary() {
  const n = state.files.length;
  if (n === 0) {
    els.summary.textContent = "No files scanned yet.";
    return;
  }
  const analyzed = Object.keys(state.analyses).length;
  let totalCut = 0;
  let silCount = 0;
  for (const p of Object.keys(state.analyses)) {
    totalCut += state.analyses[p].removed_ms || 0;
    silCount += state.analyses[p].silence_count || 0;
  }
  els.summary.textContent =
    `${n} file(s) · ${analyzed} analyzed · ${silCount} silences · removable ${fmtMs(totalCut)}`;
}

function statusBadge(path) {
  const s = state.status[path] || "idle";
  const a = state.analyses[path];
  if (s === "analyzing") return `<span class="badge work">Analyzing…</span>`;
  if (s === "done") return `<span class="badge warn">${a.silence_count} found</span>`;
  if (s === "no-silence") return `<span class="badge ok">No silences</span>`;
  if (s === "cut") return `<span class="badge ok">Cut</span>`;
  if (s === "skipped") return `<span class="badge warn">Skipped</span>`;
  if (s === "error") return `<span class="badge err">Error</span>`;
  return `<span class="badge">Idle</span>`;
}

function renderList() {
  if (state.files.length === 0) {
    els.fileList.innerHTML =
      `<div class="empty">Scan a folder to see its MP3 files here.</div>`;
    return;
  }

  els.fileList.innerHTML = state.files
    .map((f) => {
      const a = state.analyses[f.path];
      const dur = a ? fmtMs(a.duration_ms) : "—";
      const sil = a ? String(a.silence_count) : "—";
      const cut = a
        ? (a.silence_count ? fmtMs(a.removed_ms) : "—")
        : "—";
      const checked = f.checked ? "checked" : "";
      const name = f.rel !== f.name ? f.rel : f.name;
      return `
        <div class="file-row" data-path="${escapeAttr(f.path)}">
          <input type="checkbox" class="row-check" ${checked} />
          <div class="file-name">${escapeHtml(f.name)}<span class="rel">${escapeHtml(name)} · ${fmtBytes(f.size)}</span></div>
          <span>${dur}</span>
          <span>${sil}</span>
          <span>${cut}</span>
          <span>${statusBadge(f.path)}</span>
        </div>`;
    })
    .join("");

  els.fileList.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const path = cb.closest(".file-row").dataset.path;
      const f = state.files.find((x) => x.path === path);
      if (f) f.checked = cb.checked;
      updateCutBtn();
    });
  });

  updateCutBtn();
}

function updateCutBtn() {
  const anyCuttable = state.files.some(
    (f) =>
      f.checked &&
      state.analyses[f.path] &&
      state.analyses[f.path].silence_count > 0
  );
  els.cutSelectedBtn.disabled = !anyCuttable || state.busy;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

/* ---------- actions ---------- */

async function api(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function scan() {
  const path = els.folder.value.trim();
  if (!path) {
    log("Enter a folder or file path first.", "warn");
    return;
  }
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = "Scanning…";
  log(`Scanning ${path} …`);
  try {
    const r = await api("/api/scan", { path });
    if (r.error) {
      log(r.error, "err");
      return;
    }
    state.root = r.root;
    state.files = r.files.map((f) => ({ ...f, checked: true }));
    state.analyses = {};
    state.status = {};
    els.fileList.innerHTML = "";
    log(`Found ${r.count} mp3 file(s).`);
    renderList();
    renderSummary();
  } catch (e) {
    log(`Scan failed: ${e.message}`, "err");
  } finally {
    els.scanBtn.disabled = false;
    els.scanBtn.textContent = "Scan folder";
  }
}

async function analyzeOne(file) {
  state.status[file.path] = "analyzing";
  renderList();
  try {
    const s = getSettings();
    const r = await api("/api/analyze", { path: file.path, ...s });
    if (r.error) {
      state.status[file.path] = "error";
      log(`${file.name}: ${r.error}`, "err");
    } else {
      state.analyses[file.path] = r;
      state.status[file.path] = r.silence_count > 0 ? "done" : "no-silence";
      log(
        `${file.name}: ${r.silence_count} silence(s), removable ${fmtMs(r.removed_ms)}`,
        r.silence_count ? "ok" : ""
      );
    }
  } catch (e) {
    state.status[file.path] = "error";
    log(`${file.name}: ${e.message}`, "err");
  }
  renderList();
  renderSummary();
}

async function analyzeAll() {
  if (state.busy) return;
  state.busy = true;
  els.analyzeAllBtn.disabled = true;
  els.analyzeAllBtn.textContent = "Analyzing…";
  for (const f of state.files) {
    await analyzeOne(f);
  }
  els.analyzeAllBtn.disabled = false;
  els.analyzeAllBtn.textContent = "Analyze all";
  state.busy = false;
  updateCutBtn();
}

async function cutSelected() {
  if (state.busy) return;
  const targets = state.files.filter(
    (f) => f.checked && state.analyses[f.path] && state.analyses[f.path].silence_count > 0
  );
  if (targets.length === 0) {
    log("No files with silences are selected.", "warn");
    return;
  }

  const mode = getOutputMode();
  const overwrite = mode === "overwrite";
  const outDir = els.outputDir.value.trim();

  state.busy = true;
  els.cutSelectedBtn.disabled = true;
  els.cutSelectedBtn.textContent = "Cutting…";
  log(`Cutting ${targets.length} file(s) — mode: ${mode}.`);

  for (const f of targets) {
    try {
      const s = getSettings();
      const r = await api("/api/process", {
        path: f.path,
        source_root: state.root,
        output_dir: outDir,
        overwrite,
        ...s,
      });
      if (r.error) {
        state.status[f.path] = "error";
        log(`${f.name}: ${r.error}`, "err");
      } else if (r.skipped) {
        state.status[f.path] = "skipped";
        log(`${f.name}: ${r.reason}`, "warn");
      } else {
        state.status[f.path] = "cut";
        log(`${f.name}: removed ${fmtMs(r.removed_ms)} → ${r.out_path}`, "ok");
      }
    } catch (e) {
      state.status[f.path] = "error";
      log(`${f.name}: ${e.message}`, "err");
    }
    renderList();
  }

  els.cutSelectedBtn.textContent = "Cut selected";
  state.busy = false;
  updateCutBtn();
  renderSummary();
}

/* ---------- wiring ---------- */

els.scanBtn.addEventListener("click", scan);
els.analyzeAllBtn.addEventListener("click", analyzeAll);
els.cutSelectedBtn.addEventListener("click", cutSelected);
els.folder.addEventListener("keydown", (e) => {
  if (e.key === "Enter") scan();
});
els.selectAll.addEventListener("change", () => {
  const v = els.selectAll.checked;
  state.files.forEach((f) => (f.checked = v));
  renderList();
});

/* health check */
fetch("/api/health")
  .then((r) => r.json())
  .then((j) => {
    if (j.ok) {
      els.health.textContent = "online";
      els.health.classList.add("online");
    }
  })
  .catch(() => {});

renderList();
renderSummary();
