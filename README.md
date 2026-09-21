# Silence Remover + Normalization

A free, open-source desktop app for cleaning up text-to-speech audio — built
for **ElevenLabs v3** output but useful for any MP3 or WAV with unwanted silence.

It strips the **leading silence**, trims awkward **interior gaps**, removes the
**loud trailing glitch** the v3 model sometimes leaves at the very end, and can
also **measure and normalize loudness** so every file sits at a consistent
level.

Built with **Electron** (Node.js) + **ffmpeg**. No Python, no server, no
account — everything runs locally on your machine.

## Features

- **Native folder / file picker** — real OS dialogs, no typed paths.
- **Recursive scan** of a folder tree (or pick a single file).
- **MP3 and WAV support** — detect and cut silences in both formats. Output
  keeps the source container: WAV stays lossless PCM, MP3 re-encodes at its
  source bitrate.
- **Three ElevenLabs-v3 cleanups in one pass:**
  - **Leading silence** — removed completely.
  - **Interior gaps** — trimmed, keeping a little padding so words don't clip.
  - **Trailing glitch** — removed with an explicit tail cut.
- **Two scope modes** — remove *all* silences, or *edges only* (leading +
  trailing) while preserving interior pauses.
- **Per-file preview** — see duration, silence count, and removable time before
  you commit.
- **Progress bar + "n / m" counter** on analyze, cut, and volume jobs, with a
  **Stop** button to halt the queue after the current file.
- **Volume tools:**
  - **Analyze volume** — reports each file's integrated loudness (LUFS) and
    true peak.
  - **Normalize** — applies EBU R128 loudness normalization to **-16 LUFS**
    (true peak **-1.5 dBTP**).
- **Two output modes:**
  - **New folder** — writes to `<source>/silence_removed/`, originals untouched.
  - **Overwrite** (default) — replaces originals, with an optional `.orig`
    backup checkbox.
- Re-scanning skips `*.orig.*` backups and `silence_removed/` folders, so you
  never double-process.

## Requirements

| Tool     | Version         | Why                            |
| -------- | --------------- | ------------------------------ |
| Node.js  | 18+             | Runs Electron + the app        |
| npm      | any             | Installs dependencies          |
| ffmpeg   | 5+              | Does the actual audio work     |
| ffprobe  | ships with ffmpeg | Reads duration / bitrate     |

> **Windows** is the primary target (the `.exe` build and folder picker are
> Windows-first). The core (Node + ffmpeg) also runs on macOS and Linux with
> ffmpeg installed.

## Install

```bash
# 1. Clone the repo
git clone https://github.com/syntagmastudios/AudioSIlenceRemover.git
cd AudioSIlenceRemover

# 2. Install dependencies
npm install

# 3. Provide ffmpeg (any one of these):
#    a) Windows — copy the binaries into ./ffmpeg/ (from a WinGet install):
copy-ffmpeg.bat
#       macOS / Linux:
bash copy-ffmpeg.sh
#    b) OR make sure `ffmpeg` and `ffprobe` are on your PATH
#    c) OR set FFMPEG_PATH and FFPROBE_PATH to their full paths

# 4. Run
npm run dev
```

## Usage

1. Click **Choose folder** (or **Choose file**).
2. All found audio files are listed and pre-selected. Uncheck any you want to skip.
3. Click **Analyze selected** — each file shows its duration, silence count,
   and removable time.
4. Adjust settings if needed (see below).
5. Click **Cut selected** — only the selected files *with silences* are written.
6. Optionally, click **Analyze volume** to see LUFS per file, then
   **Normalize** to bring them all to -16 LUFS.

### Settings

| Setting         | Default | Meaning                                                        |
| --------------- | ------- | -------------------------------------------------------------- |
| Scope           | Edges   | **All** (leading + middle + trailing) or **Edges only** (leading + trailing). |
| Min silence     | 0.5 s   | Gaps shorter than this are ignored.                            |
| Noise threshold | -50 dB  | Below this level counts as silence. More negative = quieter.   |
| Keep padding    | 0.2 s   | Silence left around each interior cut so audio doesn't clip.   |
| Trim end        | 0.2 s   | Always cut this from the very end (the v3 glitch). `0` = off.  |

## Volume normalization

**Normalize** runs a two-pass EBU R128 loudness normalization to **-16 LUFS**
(integrated) with a **-1.5 dBTP** true-peak ceiling — a good podcast/voice
standard. It uses ffmpeg's `loudnorm` filter with `linear=true` (a constant
gain, so there's no audible "pumping").

Targets are configurable in code via the `targetLufs`, `targetTp`, and `lra`
options passed to `analyzeLoudness()` / `normalizeLoudness()` in `audio.js`.

## Build a Windows .exe

```bash
npm run build
```

Produces a portable `.exe` and an NSIS installer under `dist/`. The build
bundles `ffmpeg.exe` + `ffprobe.exe` from the `ffmpeg/` folder into the app's
resources, so the resulting `.exe` is self-contained — no ffmpeg install needed
on the target machine.

## Project structure

```
.
├── main.js              # Electron main process + IPC handlers
├── preload.js           # contextBridge — exposes window.api to the UI
├── audio.js             # Core engine: ffmpeg silence detection, cut, loudness
├── renderer/
│   ├── index.html       # UI layout
│   ├── app.js           # UI logic
│   └── style.css        # dark theme
├── test/
│   └── audio.test.js    # Self-contained engine tests (generates synthetic MP3/WAV)
├── copy-ffmpeg.bat/.sh  # Copy ffmpeg binaries into ./ffmpeg/
├── testdata/sample.mp3  # 4-second demo file (1s tone + 2s silence + 1s tone)
└── package.json
```

## Testing

```bash
npm test
```

Runs `test/audio.test.js`, which generates synthetic MP3 and WAV files on the fly and checks
silence detection, cut / overwrite / backup behaviour, edge mode, and loudness
normalization. No network access, no fixtures to download.

## Contributing

Pull requests are welcome. This is a small, single-purpose codebase — the two
places you'll most likely want to touch are:

- **`audio.js`** — the ffmpeg engine (silence detection, segmentation, loudness).
- **`renderer/app.js`** — the UI behaviour.

Please run `npm test` before opening a PR. If you add a feature, add a test for
it in `test/audio.test.js`.

## License

MIT — see [LICENSE](LICENSE).
