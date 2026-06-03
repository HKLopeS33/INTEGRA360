const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sistema', {
  platform: process.platform,
  saveReportPdf: async (html) => ipcRenderer.invoke('save-report-pdf', html),
  previewReportPdf: async (html) => ipcRenderer.invoke('preview-report-pdf', html),
  onUpdaterStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('updater-status', handler);
    return () => ipcRenderer.removeListener('updater-status', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater-check'),
  installUpdate: () => ipcRenderer.invoke('updater-install'),
});
