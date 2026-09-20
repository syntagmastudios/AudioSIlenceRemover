@echo off
setlocal enabledelayedexpansion
cd /d %~dp0
if not exist "ffmpeg" mkdir ffmpeg
set "FF="
set "FP="
for /f "delims=" %%F in ('where ffmpeg 2^>nul') do if not defined FF set "FF=%%F"
for /f "delims=" %%P in ('where ffprobe 2^>nul') do if not defined FP set "FP=%%P"
if "%FF%"=="" (echo ffmpeg not found on PATH & exit /b 1)
copy /y "%FF%" "ffmpeg\ffmpeg.exe" >nul
copy /y "%FP%" "ffmpeg\ffprobe.exe" >nul
echo Copied ffmpeg + ffprobe into .\ffmpeg\
