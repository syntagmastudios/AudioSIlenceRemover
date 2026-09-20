#!/usr/bin/env python3
"""Command-line MP3 silence remover (recursive)."""
import argparse
import os
import sys

import audio


def fmt_ms(ms):
    s = ms / 1000.0
    if s >= 3600:
        return f"{int(s // 3600)}h{int((s % 3600) // 60):02d}m{int(s % 60):02d}s"
    if s >= 60:
        return f"{int(s // 60)}m{int(s % 60):02d}s"
    return f"{s:.1f}s"


def main():
    ap = argparse.ArgumentParser(
        description="Detect and remove silences from MP3 files, recursively."
    )
    ap.add_argument("path", help="MP3 file or folder to scan")
    ap.add_argument("--min-silence", type=float, default=0.5,
                    help="minimum silence length in seconds (default 0.5)")
    ap.add_argument("--threshold", type=float, default=-35.0,
                    help="noise threshold in dBFS; more negative = quieter (default -35)")
    ap.add_argument("--padding", type=float, default=0.2,
                    help="silence to keep around each cut in seconds (default 0.2)")
    ap.add_argument("--output-dir", default=None,
                    help="output directory (default: <path>/silence_removed)")
    ap.add_argument("--overwrite", action="store_true",
                    help="overwrite originals (original kept as *.orig.mp3)")
    ap.add_argument("--dry-run", action="store_true",
                    help="analyze only; write nothing")
    args = ap.parse_args()

    src = os.path.abspath(args.path)
    if not os.path.exists(src):
        print(f"ERROR: path not found: {src}")
        sys.exit(1)

    min_ms = int(args.min_silence * 1000)
    pad_ms = int(args.padding * 1000)

    files = list(audio.iter_mp3s(src))
    if not files:
        print("No .mp3 files found.")
        return

    print(f"Found {len(files)} mp3 file(s).")
    if args.dry_run:
        print("DRY RUN — nothing will be written.\n")

    total_removed = 0
    for f in files:
        try:
            info = audio.analyze_file(f, min_ms, args.threshold, pad_ms)
        except Exception as e:
            print(f"[ERROR] {f}: {e}")
            continue

        rel = os.path.basename(f)
        if info["silence_count"] == 0:
            print(f"[SKIP] {rel} — no silences (dur {fmt_ms(info['duration_ms'])})")
            continue

        print(f"[OK]   {rel} — {info['silence_count']} silences, removable "
              f"{fmt_ms(info['removed_ms'])} ({info['removed_pct']}%)")
        total_removed += info["removed_ms"]

        if args.dry_run:
            continue

        out = audio.resolve_output(f, src, args.output_dir, args.overwrite)
        try:
            res = audio.process_file(f, out, min_ms, args.threshold, pad_ms,
                                     overwrite=args.overwrite)
        except Exception as e:
            print(f"[ERROR] processing {rel}: {e}")
            continue

        if res.get("skipped"):
            print(f"       -> {res['reason']}")
        else:
            print(f"       -> saved {res['out_path']}")

    print(f"\nDone. Total removable silence: {fmt_ms(total_removed)}")


if __name__ == "__main__":
    main()
