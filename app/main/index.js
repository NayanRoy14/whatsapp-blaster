/**
 * WhatsApp Blaster - Main Process
 * Electron entry point: creates BrowserWindow, sets up IPC handlers,
 * and coordinates between renderer and backend services.
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const csvService = require('../services/csvService');
const templateService = require('../services/templateService');
const automationService = require('../services/automationService');

let mainWindow = null;

// ─── Window Creation ──────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#0f1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show once ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    logger.info('Main window ready');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    automationService.stop();
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await automationService.stop();
});

// ─── IPC: File Dialogs ────────────────────────────────────────────────────────

ipcMain.handle('dialog:openCSV', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Contacts CSV',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Image to Attach',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:saveReport', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Report',
    defaultPath: `whatsapp-report-${Date.now()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (result.canceled) return null;
  return result.filePath;
});

// ─── IPC: CSV ─────────────────────────────────────────────────────────────────

ipcMain.handle('csv:parse', async (_event, filePath) => {
  try {
    const contacts = await csvService.parse(filePath);
    return { success: true, contacts };
  } catch (err) {
    logger.error('CSV parse error:', err);
    return { success: false, error: err.message };
  }
});

// ─── IPC: Template ────────────────────────────────────────────────────────────

ipcMain.handle('template:preview', (_event, { template, contact }) => {
  return templateService.render(template, contact);
});

// ─── IPC: Automation ─────────────────────────────────────────────────────────

ipcMain.handle('automation:start', async (_event, config) => {
  try {
    await automationService.start(config, (event, data) => {
      // Forward events to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(event, data);
      }
    });
    return { success: true };
  } catch (err) {
    logger.error('Automation start error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('automation:pause', () => {
  automationService.pause();
  return { success: true };
});

ipcMain.handle('automation:resume', () => {
  automationService.resume();
  return { success: true };
});

ipcMain.handle('automation:stop', async () => {
  await automationService.stop();
  return { success: true };
});

// ─── IPC: Report ─────────────────────────────────────────────────────────────

ipcMain.handle('report:export', async (_event, { filePath, statuses }) => {
  try {
    const lines = ['name,phone,status,timestamp,error'];
    for (const s of statuses) {
      const err = (s.error || '').replace(/,/g, ';');
      lines.push(`${s.name},${s.phone},${s.status},${s.timestamp || ''},${err}`);
    }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('report:load', () => {
  const reportPath = path.join(app.getPath('userData'), 'report.json');
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
});
