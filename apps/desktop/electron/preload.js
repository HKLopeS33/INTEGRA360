import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sistema', {
  platform: process.platform,
  saveReportPdf: async (html) => ipcRenderer.invoke('save-report-pdf', html),
  previewReportPdf: async (html) => ipcRenderer.invoke('preview-report-pdf', html)
});
