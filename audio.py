"""Core MP3 silence detection and removal using pydub + ffmpeg."""
import os
import shutil
import subprocess

from pydub import AudioSegment
from pydub.silence import detect_silence, split_on_silence

# Granularity of silence detection in ms. 10 ms is a good speed/accuracy tradeoff.
SEEK_STEP_MS = 10


def _detect_bitrate(path):
    """Return the audio stream bitrate in bits/s, or None if unknown."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "a:0",
                "-show_entries", "stream=bit_rate",
                "-of", "default=noprint_wrappers=1:nokey=1", path,
            ],
            capture_output=True, text=True, timeout=30,
        )
        val = out.stdout.strip()
        if val.isdigit() and int(val) > 0:
            return int(val)
    except Exception:
        pass
    return None


def analyze_file(path, min_silence_ms=500, silence_thresh_db=-35.0, padding_ms=200):
    """Detect silences and compute what would be removed. Does not write anything."""
    audio = AudioSegment.from_file(path)
    total_ms = len(audio)

    silences = detect_silence(
        audio,
        min_silence_len=int(min_silence_ms),
        silence_thresh=float(silence_thresh_db),
        seek_step=SEEK_STEP_MS,
    )

    chunks = split_on_silence(
        audio,
        min_silence_len=int(min_silence_ms),
        silence_thresh=float(silence_thresh_db),
        keep_silence=int(padding_ms),
        seek_step=SEEK_STEP_MS,
    )
    result_ms = sum(len(c) for c in chunks)
    removed_ms = max(0, total_ms - result_ms)

    return {
        "path": path,
        "name": os.path.basename(path),
        "duration_ms": total_ms,
        "sample_rate": audio.frame_rate,
        "channels": audio.channels,
        "silence_count": len(silences),
        "silences": [
            {"start_ms": int(s), "end_ms": int(e), "duration_ms": int(e - s)}
            for s, e in silences
        ],
        "total_silence_ms": sum(int(e - s) for s, e in silences),
        "result_duration_ms": result_ms,
        "removed_ms": removed_ms,
        "removed_pct": round(100.0 * removed_ms / total_ms, 2) if total_ms else 0.0,
    }


def process_file(path, out_path, min_silence_ms=500, silence_thresh_db=-35.0,
                 padding_ms=200, overwrite=False):
    """Cut silences and write the result. Returns a result dict."""
    audio = AudioSegment.from_file(path)
    chunks = split_on_silence(
        audio,
        min_silence_len=int(min_silence_ms),
        silence_thresh=float(silence_thresh_db),
        keep_silence=int(padding_ms),
        seek_step=SEEK_STEP_MS,
    )

    if not chunks:
        return {"skipped": True, "reason": "entire file is silence"}
    if len(chunks) == 1 and len(chunks[0]) == len(audio):
        return {"skipped": True, "reason": "no silences detected"}

    result = chunks[0]
    for c in chunks[1:]:
        result += c

    removed_ms = len(audio) - len(result)

    if overwrite:
        backup = path + ".orig.mp3"
        if not os.path.exists(backup):
            shutil.copy2(path, backup)

    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    bitrate = _detect_bitrate(path) or 192000
    result.export(out_path, format="mp3", bitrate=f"{round(bitrate / 1000)}k")

    return {
        "skipped": False,
        "out_path": out_path,
        "removed_ms": removed_ms,
        "new_duration_ms": len(result),
        "silences_removed": len(chunks) - 1,
    }


def resolve_output(src_path, source_root, output_dir=None, overwrite=False):
    """Compute the output path for a source file, mirroring folder structure."""
    if overwrite:
        return src_path
    if os.path.isfile(source_root):
        rel = os.path.basename(src_path)
        default_base = os.path.join(os.path.dirname(source_root), "silence_removed")
    else:
        rel = os.path.relpath(src_path, source_root)
        default_base = os.path.join(source_root, "silence_removed")
    base = output_dir or default_base
    return os.path.join(base, rel)


def iter_mp3s(path):
    """Yield .mp3 file paths under a file or folder, recursively.

    Skips backup files (*.orig.mp3) and the silence_removed output folder so
    re-scanning a folder never re-processes prior output.
    """
    if os.path.isfile(path):
        low = path.lower()
        if low.endswith(".mp3") and not low.endswith(".orig.mp3"):
            yield path
        return
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d.lower() != "silence_removed"]
        for f in sorted(files):
            low = f.lower()
            if low.endswith(".mp3") and not low.endswith(".orig.mp3"):
                yield os.path.join(root, f)
