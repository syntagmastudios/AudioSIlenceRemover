"use strict";

const $ = (id) => document.getElementById(id);
const bridge = window.api;

const els = {
  health: $("health"),
  folder: $("folder"),
  chooseFolderBtn: $("chooseFolderBtn"),
  chooseFileBtn: $("chooseFileBtn"),
  scanBtn: $("scanBtn"),
  minSilence: $("minSilence"),
  minSilenceNum: $("minSilenceNum"),
  thresh: $("thresh"),
  threshNum: $("threshNum"),
  padding: $("padding"),
  paddingNum: $("paddingNum"),
  trimEnd: $("trimEnd"),
  trimEndNum: $("trimEndNum"),
  outputDir: $("outputDir"),
  backup: $("backup"),
  analyzeAllBtn: $("analyzeAllBtn"),
  cutSelectedBtn: $("cutSelectedBtn"),
  analyzeVolBtn: $("analyzeVolBtn"),
  normalizeBtn: $("normalizeBtn"),
  progressWrap: $("progressWrap"),
  progressFill: $("progressFill"),
  progressLabel: $("progressLabel"),
  summary: $("summary"),
  fileList: $("fileList"),
  log: $("log"),
  selectAll: $("selectAll"),
};

const state = {
  root: null,
  files: [],
  analyses: {},
  status: {},
  loudness: {},
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
    minSilenceMs: Math.round(parseFloat(els.minSilence.value) * 1000),
    thresholdDb: parseFloat(els.thresh.value),
    paddingMs: Math.round(parseFloat(els.padding.value) * 1000),
    trimEndMs: Math.round(parseFloat(els.trimEnd.value) * 1000),
    mode: document.querySelector('input[name="scopemode"]:checked').value,
  };
}

function getOutputMode() {
  return document.querySelector('input[name="outmode"]:checked').value;
}

/* ---------- logging ---------- */

function log(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
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
bindRange(els.trimEnd, els.trimEndNum, (v) => v.toFixed(2));

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

function setProgress(current, total, label) {
  els.progressWrap.hidden = false;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressLabel.textContent = label || `${current} / ${total}`;
}

function hideProgress() {
  els.progressWrap.hidden = true;
  els.progressFill.style.width = "0%";
  els.progressLabel.textContent = "";
}

function renderList() {
  if (state.files.length === 0) {
    els.fileList.innerHTML =
      `<div class="empty">Choose a folder to see its audio files here.</div>`;
    return;
  }

  els.fileList.innerHTML = state.files
    .map((f) => {
      const a = state.analyses[f.path];
      const dur = a ? fmtMs(a.duration_ms) : "—";
      const sil = a ? String(a.silence_count) : "—";
      const cut = a ? (a.silence_count ? fmtMs(a.removed_ms) : "—") : "—";
      const loud = state.loudness[f.path];
      const loudCell = loud && loud.integrated_lufs != null
        ? `${loud.integrated_lufs.toFixed(1)} LUFS`
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
          <span>${loudCell}</span>
          <span>${statusBadge(f.path)}</span>
        </div>`;
    })
    .join("");

  els.fileList.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const p = cb.closest(".file-row").dataset.path;
      const f = state.files.find((x) => x.path === p);
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

async function chooseFolder() {
  const p = await bridge.selectFolder();
  if (p) {
    els.folder.value = p;
    await scan();
  }
}

async function chooseFile() {
  const p = await bridge.selectFile();
  if (p) {
    els.folder.value = p;
    await scan();
  }
}

async function scan() {
  const p = els.folder.value.trim();
  if (!p) {
    log("Choose a folder or file first.", "warn");
    return;
  }
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = "Scanning…";
  log(`Scanning ${p} …`);
  try {
    const r = await bridge.scan(p);
    state.root = r.root;
    state.files = r.files.map((f) => ({ ...f, checked: true }));
    state.analyses = {};
    state.status = {};
    state.loudness = {};
    els.fileList.innerHTML = "";
    log(`Found ${r.count} audio file(s).`);
    renderList();
    renderSummary();
  } catch (e) {
    log(`Scan failed: ${e.message}`, "err");
  } finally {
    els.scanBtn.disabled = false;
    els.scanBtn.textContent = "Scan";
  }
}

async function analyzeOne(file) {
  state.status[file.path] = "analyzing";
  renderList();
  try {
    const s = getSettings();
    const r = await bridge.analyze(file.path, s);
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

async function analyzeSelected() {
  if (state.busy) return;
  const targets = state.files.filter((f) => f.checked);
  if (targets.length === 0) {
    log("No files selected.", "warn");
    return;
  }
  state.busy = true;
  els.analyzeAllBtn.disabled = true;
  els.analyzeAllBtn.textContent = "Analyzing…";
  let done = 0;
  setProgress(0, targets.length, `Analyzing 0 / ${targets.length}`);
  for (const f of targets) {
    await analyzeOne(f);
    done++;
    setProgress(done, targets.length, `Analyzing ${done} / ${targets.length}`);
  }
  hideProgress();
  els.analyzeAllBtn.disabled = false;
  els.analyzeAllBtn.textContent = "Analyze selected";
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

  const overwrite = getOutputMode() === "overwrite";
  const outputDir = els.outputDir.value.trim();

  state.busy = true;
  els.cutSelectedBtn.disabled = true;
  els.cutSelectedBtn.textContent = "Cutting…";
  log(`Cutting ${targets.length} file(s) — mode: ${overwrite ? "overwrite" : "folder"}.`);

  let done = 0;
  setProgress(0, targets.length, `Cutting 0 / ${targets.length}`);
  for (const f of targets) {
    try {
      const s = getSettings();
      const r = await bridge.process(f.path, {
        sourceRoot: state.root,
        outputDir,
        overwrite,
        backup: els.backup.checked,
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
    done++;
    setProgress(done, targets.length, `Cutting ${done} / ${targets.length}`);
    renderList();
  }

  hideProgress();
  els.cutSelectedBtn.textContent = "Cut selected";
  state.busy = false;
  updateCutBtn();
  renderSummary();
}

async function analyzeVolume() {
  if (state.busy) return;
  const targets = state.files.filter((f) => f.checked);
  if (targets.length === 0) {
    log("No files selected.", "warn");
    return;
  }
  state.busy = true;
  els.analyzeVolBtn.disabled = true;
  els.analyzeVolBtn.textContent = "Analyzing…";
  let done = 0;
  setProgress(0, targets.length, `Analyzing volume 0 / ${targets.length}`);
  for (const f of targets) {
    try {
      const r = await bridge.analyzeVolume(f.path, {});
      if (r.integrated_lufs != null) {
        state.loudness[f.path] = r;
        log(`${f.name}: ${r.integrated_lufs.toFixed(1)} LUFS (peak ${r.true_peak != null ? r.true_peak.toFixed(1) : "?"} dBTP)`, "ok");
      } else {
        log(`${f.name}: loudness measurement failed`, "err");
      }
    } catch (e) {
      log(`${f.name}: ${e.message}`, "err");
    }
    done++;
    setProgress(done, targets.length, `Analyzing volume ${done} / ${targets.length}`);
    renderList();
  }
  hideProgress();
  els.analyzeVolBtn.disabled = false;
  els.analyzeVolBtn.textContent = "Analyze volume";
  state.busy = false;
}

async function normalizeSelected() {
  if (state.busy) return;
  const targets = state.files.filter((f) => f.checked);
  if (targets.length === 0) {
    log("No files selected.", "warn");
    return;
  }
  const overwrite = getOutputMode() === "overwrite";
  const outputDir = els.outputDir.value.trim();
  state.busy = true;
  els.normalizeBtn.disabled = true;
  els.normalizeBtn.textContent = "Normalizing…";
  log(`Normalizing ${targets.length} file(s) to -16 LUFS — mode: ${overwrite ? "overwrite" : "folder"}.`);
  let done = 0;
  setProgress(0, targets.length, `Normalizing 0 / ${targets.length}`);
  for (const f of targets) {
    try {
      const r = await bridge.normalize(f.path, {
        sourceRoot: state.root,
        outputDir,
        overwrite,
        backup: els.backup.checked,
      });
      if (r.error) {
        log(`${f.name}: ${r.error}`, "err");
      } else {
        state.loudness[f.path] = { integrated_lufs: r.target_lufs, true_peak: null };
        log(`${f.name}: ${r.input_lufs.toFixed(1)} → ${r.target_lufs} LUFS → ${r.out_path}`, "ok");
      }
    } catch (e) {
      log(`${f.name}: ${e.message}`, "err");
    }
    done++;
    setProgress(done, targets.length, `Normalizing ${done} / ${targets.length}`);
    renderList();
  }
  hideProgress();
  els.normalizeBtn.disabled = false;
  els.normalizeBtn.textContent = "Normalize";
  state.busy = false;
}

/* ---------- wiring ---------- */

els.scanBtn.addEventListener("click", scan);
els.chooseFolderBtn.addEventListener("click", chooseFolder);
els.chooseFileBtn.addEventListener("click", chooseFile);
els.analyzeAllBtn.addEventListener("click", analyzeSelected);
els.cutSelectedBtn.addEventListener("click", cutSelected);
els.analyzeVolBtn.addEventListener("click", analyzeVolume);
els.normalizeBtn.addEventListener("click", normalizeSelected);
els.folder.addEventListener("keydown", (e) => {
  if (e.key === "Enter") scan();
});
els.selectAll.addEventListener("change", () => {
  const v = els.selectAll.checked;
  state.files.forEach((f) => (f.checked = v));
  renderList();
});

if (bridge) {
  els.health.textContent = "ready";
  els.health.classList.add("online");
} else {
  els.health.textContent = "no api";
}

renderList();
renderSummary();
