'use strict';
/* Standalone test for audio.js — no Electron needed. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const audio = require('../audio');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp3remover-test-'));
const src = path.join(tmp, 'sample.mp3');
const src2 = path.join(tmp, 'edges.mp3');

// File 1 — ElevenLabs-v3-like: 0.6s leading silence + 1s speech + 2s silence + 1s speech + 0.5s loud glitch.
execFileSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:duration=0.6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:duration=2',
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
  '-f', 'lavfi', '-i', 'sine=frequency=3000:duration=0.5',
  '-filter_complex', '[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[a]',
  '-map', '[a]', '-b:a', '128k', src,
], { stdio: 'ignore' });

// File 2 — 0.5s leading + 1s speech + 1s middle silence + 1s speech + 0.5s trailing silence.
execFileSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:duration=0.5',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:duration=1',
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:duration=0.5',
  '-filter_complex', '[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[a]',
  '-map', '[a]', '-b:a', '128k', src2,
], { stdio: 'ignore' });

const ALL = { minSilenceMs: 500, thresholdDb: -35, paddingMs: 200, trimEndMs: 500, mode: 'all' };

(async () => {
  // --- "all" mode (default): leading + middle + tail glitch all removed ---
  const info = await audio.analyze(src, ALL);
  assert.ok(Math.abs(info.duration_ms - 5100) <= 30, `duration ${info.duration_ms}`);
  assert.strictEqual(info.silence_count, 2, `silences ${info.silence_count}`);
  assert.ok(Math.abs(info.removed_ms - 2700) <= 30, `removed ${info.removed_ms}`);

  const out = path.join(tmp, 'silence_removed', 'sample.mp3');
  const res = await audio.processFile(src, out, ALL);
  assert.strictEqual(res.skipped, false, JSON.stringify(res));
  assert.ok(fs.existsSync(out), 'output missing');
  const outInfo = await audio.analyze(out, { minSilenceMs: 500, thresholdDb: -35, paddingMs: 200, trimEndMs: 0 });
  assert.ok(Math.abs(outInfo.duration_ms - 2400) <= 40, `out duration ${outInfo.duration_ms}`);

  // --- "edges" mode: only leading + trailing, middle kept ---
  const edgeInfo = await audio.analyze(src, { ...ALL, trimEndMs: 0, mode: 'edges' });
  assert.strictEqual(edgeInfo.silence_count, 1, `edges silences ${edgeInfo.silence_count}`);
  assert.ok(Math.abs(edgeInfo.removed_ms - 600) <= 30, `edges removed ${edgeInfo.removed_ms}`);

  const edge2 = await audio.analyze(src2, { ...ALL, trimEndMs: 0, mode: 'edges' });
  assert.strictEqual(edge2.silence_count, 2, `edge2 silences ${edge2.silence_count}`);
  assert.ok(Math.abs(edge2.removed_ms - 1000) <= 30, `edge2 removed ${edge2.removed_ms}`);

  // all mode + trimEnd on trailing-silence file: speech preserved, not cut into
  const all2 = await audio.analyze(src2, { minSilenceMs: 500, thresholdDb: -35, paddingMs: 200, trimEndMs: 500, mode: 'all' });
  assert.ok(Math.abs(all2.removed_ms - 1600) <= 30, `all2 removed ${all2.removed_ms}`);
  assert.ok(Math.abs(all2.result_duration_ms - 2400) <= 40, `all2 result ${all2.result_duration_ms}`);

  // overwrite mode: edits in-place, backs up the original
  const owSrc = path.join(tmp, 'ow.mp3');
  fs.copyFileSync(src2, owSrc);
  const owRes = await audio.processFile(owSrc, owSrc, { ...ALL, trimEndMs: 0, mode: 'edges', overwrite: true, backup: true });
  assert.strictEqual(owRes.skipped, false, JSON.stringify(owRes));
  assert.ok(fs.existsSync(owSrc + '.orig.mp3'), 'backup missing');
  const owInfo = await audio.analyze(owSrc, { minSilenceMs: 500, thresholdDb: -35, paddingMs: 200, trimEndMs: 0 });
  assert.ok(Math.abs(owInfo.duration_ms - 3000) <= 40, `ow duration ${owInfo.duration_ms}`);

  // overwrite mode with backup disabled: no .orig.mp3 created
  const owSrc2 = path.join(tmp, 'ow2.mp3');
  fs.copyFileSync(src2, owSrc2);
  const owRes2 = await audio.processFile(owSrc2, owSrc2, { ...ALL, trimEndMs: 0, mode: 'edges', overwrite: true, backup: false });
  assert.strictEqual(owRes2.skipped, false, JSON.stringify(owRes2));
  assert.ok(!fs.existsSync(owSrc2 + '.orig.mp3'), 'backup should not exist');

  // loudness analysis + normalization
  const loud = await audio.analyzeLoudness(src);
  assert.ok(typeof loud.integrated_lufs === 'number' && isFinite(loud.integrated_lufs), 'loudness measured');
  const normOut = path.join(tmp, 'silence_removed', 'norm.mp3');
  const normRes = await audio.normalizeLoudness(src, normOut, {});
  assert.strictEqual(normRes.skipped, false, JSON.stringify(normRes));
  assert.ok(fs.existsSync(normOut), 'normalized output missing');
  const postLoud = await audio.analyzeLoudness(normOut);
  assert.ok(Math.abs(postLoud.integrated_lufs - (-16)) < 3, `post loudness ${postLoud.integrated_lufs}`);

  const scanRes = audio.scan(tmp);
  assert.strictEqual(scanRes.files.length, 4, `scan files ${scanRes.files.length}`);

  console.log('ALL PASS');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error('FAIL:', e.message);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
