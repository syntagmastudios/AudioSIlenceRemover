'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  scan: (p) => ipcRenderer.invoke('scan', p),
  analyze: (p, opts) => ipcRenderer.invoke('analyze', p, opts),
  process: (p, opts) => ipcRenderer.invoke('process', p, opts),
  analyzeVolume: (p, opts) => ipcRenderer.invoke('analyze-volume', p, opts),
  normalize: (p, opts) => ipcRenderer.invoke('normalize', p, opts),
});
