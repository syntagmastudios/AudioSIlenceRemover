#!/usr/bin/env bash
cd "$(dirname "$0")"
mkdir -p ffmpeg
FF="$(command -v ffmpeg.exe || command -v ffmpeg)"
FP="$(command -v ffprobe.exe || command -v ffprobe)"
if [ -z "$FF" ] || [ -z "$FP" ]; then
  echo "ffmpeg/ffprobe not found on PATH" >&2
  exit 1
fi
cp "$FF" ffmpeg/ffmpeg.exe
cp "$FP" ffmpeg/ffprobe.exe
echo "Copied ffmpeg + ffprobe into ./ffmpeg/"
