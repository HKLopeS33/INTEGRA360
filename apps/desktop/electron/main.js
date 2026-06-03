import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: 'Integra360',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (!app.isPackaged) {
    void window.loadURL(devUrl);
    window.webContents.openDevTools();
    return window;
  }

  // In packaged mode, load from dist/index.html
  // __dirname will be the dist folder when packaged via electron-builder
  const indexPath = path.join(__dirname, 'index.html');
  console.log('[Electron] Loading:', indexPath);
  console.log('[Electron] __dirname:', __dirname);
  console.log('[Electron] app.isPackaged:', app.isPackaged);
  
  void window.loadFile(indexPath).catch(err => {
    console.error('[Electron] Failed to load index.html:', err);
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

  return window;
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

// Lista impressoras disponíveis no sistema
ipcMain.handle('list-printers', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const printers = await win.webContents.getPrintersAsync();
    return printers.map((p) => ({ name: p.name, isDefault: p.isDefault, status: p.status }));
  } catch (e) {
    return [];
  }
});

// Imprime HTML silenciosamente em uma impressora específica
ipcMain.handle('print-silent', async (event, html, printerName) => {
  return new Promise((resolve) => {
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true }
    });
    printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    printWindow.webContents.once('did-finish-load', () => {
      printWindow.webContents.print(
        { silent: true, deviceName: printerName, printBackground: true, margins: { marginType: 'none' } },
        (success, reason) => {
          printWindow.close();
          resolve({ success, reason: reason ?? '' });
        }
      );
    });
  });
});

// IPC handlers para controle manual do updater pelo renderer
ipcMain.handle('updater-check', () => {
  if (!app.isPackaged) return { status: 'dev' };
  return autoUpdater.checkForUpdates().catch((e) => ({ error: e?.message }));
});

ipcMain.handle('updater-install', () => {
  autoUpdater.quitAndInstall();
});

// ── Auto-updater ──────────────────────────────────────────────
function setupAutoUpdater(win) {
  if (!app.isPackaged) {
    // Em dev, avisa o renderer para pular a splash imediatamente
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('updater-status', { event: 'update-not-available' });
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Repo público — sem necessidade de token
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'HKLopeS33',
    repo: 'INTEGRA360'
  });

  const send = (event, data = {}) =>
    win.webContents.send('updater-status', { event, ...data });

  autoUpdater.on('checking-for-update', () => {
    send('checking-for-update');
  });

  autoUpdater.on('update-available', (info) => {
    send('update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    send('download-progress', { percent: Math.floor(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send('update-downloaded', { version: info.version });
    // Dá 1.5s para o renderer mostrar "concluído" antes de perguntar
    setTimeout(() => {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'info',
        title: 'Atualização pronta',
        message: `Versão ${info.version} baixada.\nDeseja reiniciar agora para instalar?`,
        buttons: ['Reiniciar agora', 'Depois'],
        defaultId: 0
      });
      if (choice === 0) autoUpdater.quitAndInstall();
      else send('update-not-available'); // segue para login se escolheu "Depois"
    }, 1500);
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] erro:', err?.message ?? err);
    send('error', { message: err?.message ?? 'Erro desconhecido' });
  });

  // Verifica ao iniciar — após o renderer estar pronto
  win.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdates().catch((err) => {
      send('error', { message: err?.message ?? 'Falha ao verificar' });
    });
  });

  // Reverifica a cada 2 horas
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000);
}
// ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const win = createWindow();
  setupAutoUpdater(win);
});

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
