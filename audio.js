'use strict';
/* Core MP3 silence + glitch removal, driven by ffmpeg directly.
 *
 * Tuned for cleaning ElevenLabs v3 TTS output:
 *   - leading silence  -> removed completely
 *   - interior gaps    -> trimmed, keeping `paddingMs` of silence each side
 *   - trailing silence -> removed completely
 *   - trailing glitch  -> removed via an explicit `trimEndMs` tail cut
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 128 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = ((stderr || err.message || '') + '').slice(-800) || err.message;
        reject(new Error(msg));
      } else {
        resolve({ stdout: (stdout || '') + '', stderr: (stderr || '') + '' });
      }
    });
  });
}

function bin(name) {
  // Packaged app: ffmpeg lives in resources/ffmpeg. Dev: PATH / env override.
  const bundled = path.join(process.resourcesPath || '', 'ffmpeg', name);
  if (fs.existsSync(bundled)) return bundled;
  return name;
}

function ffmpeg() {
  return process.env.FFMPEG_PATH || bin(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}
function ffprobe() {
  return process.env.FFPROBE_PATH || bin(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
}

async function ffprobeDuration(file) {
  const { stdout } = await run(ffprobe(), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  const v = parseFloat(stdout.trim());
  return Number.isFinite(v) ? Math.round(v * 1000) : 0;
}

async function ffprobeBitrate(file) {
  const { stdout } = await run(ffprobe(), [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=bit_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  const v = parseInt(stdout.trim(), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

async function detectSilences(file, minSilenceMs, thresholdDb) {
  const minSec = (minSilenceMs / 1000).toFixed(3);
  const { stderr } = await run(ffmpeg(), [
    '-hide_banner', '-nostats', '-i', file,
    '-af', `silencedetect=noise=${thresholdDb}dB:d=${minSec}`,
    '-f', 'null', '-',
  ]);
  const silences = [];
  let current = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) {
      current = { start_ms: Math.round(parseFloat(s[1]) * 1000), end_ms: null };
    } else if (e && current) {
      current.end_ms = Math.round(parseFloat(e[1]) * 1000);
      silences.push(current);
      current = null;
    }
  }
  return silences;
}

function selectSilences(silences, totalMs, mode) {
  // mode 'edges' keeps only leading (starts at 0) and trailing (ends at the
  // file end) silence; mode 'all' keeps everything detected.
  if (mode !== 'edges') return silences;
  const tol = 50; // ms — within this of a boundary counts as an edge silence
  return silences.filter((s) => s.start_ms <= tol || s.end_ms >= totalMs - tol);
}

function buildSegments(totalMs, silences, paddingMs, trimEndMs = 0) {
  // Tail trim shortens the effective file length, so it always cuts from the
  // very end (the glitch) instead of eating into speech before trailing silence.
  const endMs = Math.max(0, totalMs - trimEndMs);
  const eff = silences
    .filter((s) => s.start_ms < endMs)
    .map((s) => ({ start_ms: s.start_ms, end_ms: Math.min(s.end_ms, endMs) }));

  const regions = [];
  let cursor = 0;
  for (const s of eff) {
    if (s.start_ms > cursor) regions.push([cursor, s.start_ms]);
    cursor = Math.max(cursor, s.end_ms == null ? s.start_ms : s.end_ms);
  }
  if (cursor < endMs) regions.push([cursor, endMs]);

  // Leading/trailing silence removed entirely; interior gaps keep `paddingMs`
  // on each side.
  const segs = regions
    .map(([s, e], i) => {
      const isFirst = i === 0;
      const isLast = i === regions.length - 1;
      const start = isFirst ? s : Math.max(0, s - paddingMs);
      const end = isLast ? e : Math.min(endMs, e + paddingMs);
      return [start, end];
    })
    .filter(([s, e]) => e > s);

  const merged = [];
  for (const [s, e] of segs) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

async function analyze(file, opts = {}) {
  const minSilenceMs = opts.minSilenceMs || 500;
  const thresholdDb = opts.thresholdDb == null ? -50 : opts.thresholdDb;
  const paddingMs = opts.paddingMs == null ? 200 : opts.paddingMs;
  const trimEndMs = opts.trimEndMs || 0;
  const mode = opts.mode || 'edges';

  const totalMs = await ffprobeDuration(file);
  const silences = await detectSilences(file, minSilenceMs, thresholdDb);
  for (const s of silences) if (s.end_ms == null) s.end_ms = totalMs;
  const selected = selectSilences(silences, totalMs, mode);

  const segs = buildSegments(totalMs, selected, paddingMs, trimEndMs);
  const resultMs = segs.reduce((a, [s, e]) => a + (e - s), 0);
  const removedMs = Math.max(0, totalMs - resultMs);

  return {
    path: file,
    name: path.basename(file),
    duration_ms: totalMs,
    silence_count: selected.length,
    silences: selected,
    total_silence_ms: selected.reduce((a, s) => a + (s.end_ms - s.start_ms), 0),
    trim_end_ms: trimEndMs,
    mode,
    result_duration_ms: resultMs,
    removed_ms: removedMs,
    removed_pct: totalMs ? Math.round((removedMs / totalMs) * 10000) / 100 : 0,
  };
}

async function processFile(file, outPath, opts = {}) {
  const minSilenceMs = opts.minSilenceMs || 500;
  const thresholdDb = opts.thresholdDb == null ? -50 : opts.thresholdDb;
  const paddingMs = opts.paddingMs == null ? 200 : opts.paddingMs;
  const trimEndMs = opts.trimEndMs || 0;
  const mode = opts.mode || 'edges';
  const overwrite = opts.overwrite === true;
  const doBackup = opts.backup === true;

  const totalMs = await ffprobeDuration(file);
  const silences = await detectSilences(file, minSilenceMs, thresholdDb);
  for (const s of silences) if (s.end_ms == null) s.end_ms = totalMs;
  const selected = selectSilences(silences, totalMs, mode);
  const segs = buildSegments(totalMs, selected, paddingMs, trimEndMs);

  if (selected.length === 0 && trimEndMs <= 0) {
    return { skipped: true, reason: 'no silences to remove' };
  }
  if (segs.length === 0) {
    return { skipped: true, reason: 'nothing left to keep after trimming' };
  }

  if (overwrite && doBackup) {
    const backupPath = file + '.orig.mp3';
    if (!fs.existsSync(backupPath)) fs.copyFileSync(file, backupPath);
  }

  const dir = path.dirname(outPath);
  if (dir) fs.mkdirSync(dir, { recursive: true });

  const parts = [];
  const labels = [];
  segs.forEach(([s, e], i) => {
    parts.push(`[0:a]atrim=start=${(s / 1000).toFixed(3)}:end=${(e / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const filter = `${parts.join(';')};${labels.join('')}concat=n=${segs.length}:v=0:a=1[out]`;

  const bitrate = (await ffprobeBitrate(file)) || 192000;
  // ffmpeg can't edit a file in-place, so render to a temp file then move it
  // into place (this also keeps overwrite mode safe).
  const tmpOut = `${outPath}.tmp-${process.pid}-${Date.now()}.mp3`;
  try {
    await run(ffmpeg(), [
      '-hide_banner', '-y', '-i', file,
      '-filter_complex', filter,
      '-map', '[out]',
      '-b:a', `${Math.round(bitrate / 1000)}k`,
      tmpOut,
    ]);
    fs.copyFileSync(tmpOut, outPath);
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }

  const removedMs = totalMs - segs.reduce((a, [s, e]) => a + (e - s), 0);
  return {
    skipped: false,
    out_path: outPath,
    removed_ms: removedMs,
    new_duration_ms: totalMs - removedMs,
    silences_removed: selected.length,
  };
}

function parseLoudnorm(stderr) {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return {};
  try {
    return JSON.parse(stderr.slice(start, end + 1));
  } catch {
    return {};
  }
}

async function analyzeLoudness(file, opts = {}) {
  const targetI = opts.targetLufs == null ? -16 : opts.targetLufs;
  const targetTP = opts.targetTp == null ? -1.5 : opts.targetTp;
  const lra = opts.lra == null ? 11 : opts.lra;
  const filter = `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${lra}:print_format=json`;
  const { stderr } = await run(ffmpeg(), [
    '-hide_banner', '-nostats', '-i', file, '-af', filter, '-f', 'null', '-',
  ]);
  const m = parseLoudnorm(stderr);
  return {
    path: file,
    name: path.basename(file),
    integrated_lufs: m.input_i != null ? parseFloat(m.input_i) : null,
    true_peak: m.input_tp != null ? parseFloat(m.input_tp) : null,
    lra: m.input_lra != null ? parseFloat(m.input_lra) : null,
    target_lufs: targetI,
  };
}

async function normalizeLoudness(file, outPath, opts = {}) {
  const targetI = opts.targetLufs == null ? -16 : opts.targetLufs;
  const targetTP = opts.targetTp == null ? -1.5 : opts.targetTp;
  const lra = opts.lra == null ? 11 : opts.lra;
  const overwrite = opts.overwrite === true;
  const doBackup = opts.backup === true;

  // Pass 1 — measure.
  const measureFilter = `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${lra}:print_format=json`;
  const { stderr } = await run(ffmpeg(), [
    '-hide_banner', '-nostats', '-i', file, '-af', measureFilter, '-f', 'null', '-',
  ]);
  const m = parseLoudnorm(stderr);
  if (m.input_i == null) throw new Error('loudnorm measurement failed');

  if (overwrite && doBackup) {
    const backupPath = file + '.orig.mp3';
    if (!fs.existsSync(backupPath)) fs.copyFileSync(file, backupPath);
  }
  const dir = path.dirname(outPath);
  if (dir) fs.mkdirSync(dir, { recursive: true });

  // Pass 2 — apply.
  const applyFilter = `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const bitrate = (await ffprobeBitrate(file)) || 192000;
  const tmpOut = `${outPath}.tmp-${process.pid}-${Date.now()}.mp3`;
  try {
    await run(ffmpeg(), [
      '-hide_banner', '-y', '-i', file, '-af', applyFilter,
      '-b:a', `${Math.round(bitrate / 1000)}k`, tmpOut,
    ]);
    fs.copyFileSync(tmpOut, outPath);
  } finally {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }

  return {
    skipped: false,
    out_path: outPath,
    input_lufs: parseFloat(m.input_i),
    target_lufs: targetI,
  };
}

function resolveOutput(srcPath, sourceRoot, outputDir, overwrite) {
  if (overwrite) return srcPath;
  const isFile = fs.statSync(sourceRoot).isFile();
  const rel = isFile ? path.basename(srcPath) : path.relative(sourceRoot, srcPath);
  const defaultBase = isFile
    ? path.join(path.dirname(sourceRoot), 'silence_removed')
    : path.join(sourceRoot, 'silence_removed');
  const base = outputDir || defaultBase;
  return path.join(base, rel);
}

function scan(folderPath) {
  const root = path.resolve(folderPath);
  if (!fs.existsSync(root)) throw new Error(`Path not found: ${root}`);
  const isDir = fs.statSync(root).isDirectory();
  const files = [];
  if (!isDir) {
    if (/\.mp3$/i.test(root) && !/\.orig\.mp3$/i.test(root)) files.push(root);
  } else {
    walk(root, files);
  }
  return {
    root,
    count: files.length,
    files: files.map((p) => ({
      path: p,
      name: path.basename(p),
      rel: isDir ? path.relative(root, p) : path.basename(p),
      size: fs.statSync(p).size,
    })),
  };
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === 'silence_removed') continue;
      walk(path.join(dir, entry.name), acc);
    } else if (entry.isFile() && /\.mp3$/i.test(entry.name) && !/\.orig\.mp3$/i.test(entry.name)) {
      acc.push(path.join(dir, entry.name));
    }
  }
}

module.exports = {
  scan,
  analyze,
  processFile,
  analyzeLoudness,
  normalizeLoudness,
  resolveOutput,
  detectSilences,
  selectSilences,
  buildSegments,
  parseLoudnorm,
};
