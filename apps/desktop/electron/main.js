import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: 'Sistema Shawarma',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (!app.isPackaged) {
    void window.loadURL(devUrl);
    window.webContents.openDevTools();
    return;
  }

  // In packaged mode, load from dist/index.html
  // __dirname will be the dist folder when packaged via electron-builder
  const indexPath = path.join(__dirname, 'index.html');
  console.log('[Electron] Loading:', indexPath);
  console.log('[Electron] __dirname:', __dirname);
  console.log('[Electron] app.isPackaged:', app.isPackaged);
  
  void window.loadFile(indexPath).catch(err => {
    console.error('[Electron] Failed to load index.html:', err);
    // Fallback: show error message
    window.webContents.loadURL(`data:text/html;charset=utf-8,
      <html><body style="background: #f0f0f0; font-family: monospace; padding: 20px;">
        <h2>Error loading application</h2>
        <p>Failed to load index.html from: ${indexPath}</p>
        <p>Error: ${err.message}</p>
        <hr>
        <p>__dirname: ${__dirname}</p>
      </body></html>
    `);
  });
};

ipcMain.handle('save-report-pdf', async (event, html) => {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(browserWindow, {
    title: 'Salvar relatório em PDF',
    defaultPath: 'relatorio.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true
    }
  });

  await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const pdfData = await pdfWindow.webContents.printToPDF({
    marginsType: 1,
    printBackground: true,
    pageSize: 'A4'
  });
  await writeFile(filePath, pdfData);
  pdfWindow.close();

  return { canceled: false, filePath };
});

ipcMain.handle('preview-report-pdf', async (event, html) => {
  const tempPath = path.join(os.tmpdir(), `relatorio-preview-${Date.now()}.pdf`);
  const previewWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true
    }
  });

  await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const pdfData = await previewWindow.webContents.printToPDF({
    marginsType: 1,
    printBackground: true,
    pageSize: 'A4'
  });
  await writeFile(tempPath, pdfData);
  previewWindow.close();
  await shell.openPath(tempPath);

  return { canceled: false, filePath: tempPath };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
