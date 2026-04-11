/**
 * Preload Script
 * Exposes a safe, typed API to the renderer via contextBridge.
 * Only whitelisted channels can pass through.
 */

const { contextBridge, ipcRenderer } = require('electron');

const VALID_EVENTS = [
  'automation:progress',
  'automation:status',
  'automation:log',
  'automation:done',
  'automation:error',
];

contextBridge.exposeInMainWorld('api', {
  // ── Dialogs ──────────────────────────────────────────────────────────────
  openCSV:      () => ipcRenderer.invoke('dialog:openCSV'),
  openImage:    () => ipcRenderer.invoke('dialog:openImage'),
  saveReport:   () => ipcRenderer.invoke('dialog:saveReport'),

  // ── CSV ──────────────────────────────────────────────────────────────────
  parseCSV:     (filePath) => ipcRenderer.invoke('csv:parse', filePath),

  // ── Template ─────────────────────────────────────────────────────────────
  previewTemplate: (template, contact) =>
    ipcRenderer.invoke('template:preview', { template, contact }),

  // ── Automation ───────────────────────────────────────────────────────────
  startAutomation:  (config)  => ipcRenderer.invoke('automation:start', config),
  pauseAutomation:  ()        => ipcRenderer.invoke('automation:pause'),
  resumeAutomation: ()        => ipcRenderer.invoke('automation:resume'),
  stopAutomation:   ()        => ipcRenderer.invoke('automation:stop'),

  // ── Report ───────────────────────────────────────────────────────────────
  exportReport: (filePath, statuses) =>
    ipcRenderer.invoke('report:export', { filePath, statuses }),
  loadReport: () => ipcRenderer.invoke('report:load'),

  // ── Event Listeners ──────────────────────────────────────────────────────
  on: (channel, callback) => {
    if (!VALID_EVENTS.includes(channel)) return;
    const wrapped = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    // Return cleanup function
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  off: (channel, callback) => {
    if (!VALID_EVENTS.includes(channel)) return;
    ipcRenderer.removeAllListeners(channel);
  },
});
