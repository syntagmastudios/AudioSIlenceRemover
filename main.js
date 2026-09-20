'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const audio = require('./audio');

// Simple UI — no need for GPU acceleration (also avoids gpu_disk_cache errors).
app.disableHardwareAcceleration();

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0e1116',
    autoHideMenuBar: true,
    title: 'MP3 Silence Remover',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------- IPC ---------- */

ipcMain.handle('select-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a folder of MP3 files',
    properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('select-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose an MP3 file',
    properties: ['openFile'],
    filters: [{ name: 'MP3', extensions: ['mp3'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('scan', (_e, folderPath) => audio.scan(folderPath));

ipcMain.handle('analyze', (_e, filePath, opts) => audio.analyze(filePath, opts));

ipcMain.handle('process', async (_e, filePath, opts) => {
  const outPath = audio.resolveOutput(
    filePath,
    opts.sourceRoot,
    opts.outputDir || null,
    opts.overwrite
  );
  const res = await audio.processFile(filePath, outPath, opts);
  res.path = filePath;
  res.name = path.basename(filePath);
  return res;
});

ipcMain.handle('analyze-volume', (_e, filePath, opts) =>
  audio.analyzeLoudness(filePath, opts)
);

ipcMain.handle('normalize', async (_e, filePath, opts) => {
  const outPath = audio.resolveOutput(
    filePath,
    opts.sourceRoot,
    opts.outputDir || null,
    opts.overwrite
  );
  const res = await audio.normalizeLoudness(filePath, outPath, opts);
  res.path = filePath;
  res.name = path.basename(filePath);
  return res;
});
