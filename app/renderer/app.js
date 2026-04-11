/**
 * app.js — Renderer Process
 * All UI logic: navigation, CSV import, template preview,
 * automation controls, status table, log panel, report export.
 * Communicates with main process via window.api (preload bridge).
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  contacts:   [],
  imagePath:  null,
  statuses:   [],
  running:    false,
  paused:     false,
  cleanups:   [],   // IPC listener cleanup fns
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Navigation
const navBtns  = $$('.nav-btn');
const panels   = $$('.panel');

// Contacts
const csvDropZone        = $('csv-drop-zone');
const csvBrowseBtn       = $('csv-browse-btn');
const csvErrors          = $('csv-errors');
const contactsTableWrap  = $('contacts-table-wrap');
const contactsTbody      = $('contacts-tbody');
const contactsLoadedLbl  = $('contacts-loaded-label');
const csvClearBtn        = $('csv-clear-btn');
const contactCountBadge  = $('contact-count');

// Message
const messageTemplate    = $('message-template');
const charCount          = $('char-count');
const messagePreview     = $('message-preview');
const imageBrowseBtn     = $('image-browse-btn');
const imagePathDisplay   = $('image-path-display');
const imageClearBtn      = $('image-clear-btn');
const imagePreviewWrap   = $('image-preview-wrap');
const imagePreview       = $('image-preview');
const delaySlider        = $('delay-slider');
const delayInput         = $('delay-input');
const optResume          = $('opt-resume');
const chips              = $$('.chip');

// Send
const startBtn       = $('start-btn');
const pauseBtn       = $('pause-btn');
const stopBtn        = $('stop-btn');
const exportBtn      = $('export-btn');
const progressSection = $('progress-section');
const statSent       = $('stat-sent');
const statFailed     = $('stat-failed');
const statPending    = $('stat-pending');
const statTotal      = $('stat-total');
const progressFill   = $('progress-fill');
const progressPct    = $('progress-pct');
const logBody        = $('log-body');
const clearLogBtn    = $('clear-log-btn');

// Summary
const summaryContacts  = $('summary-contacts');
const summaryTemplate  = $('summary-template');
const summaryImage     = $('summary-image');
const summaryDelay     = $('summary-delay');

// Report
const reportTbody     = $('report-tbody');
const reportExportBtn = $('report-export-btn');

// ─── Navigation ───────────────────────────────────────────────────────────────

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panelId = `panel-${btn.dataset.panel}`;
    document.getElementById(panelId).classList.add('active');
    if (btn.dataset.panel === 'send') updateSendSummary();
    if (btn.dataset.panel === 'report') renderReportTable(state.statuses);
  });
});

// ─── CSV Import ───────────────────────────────────────────────────────────────

csvDropZone.addEventListener('click', handleCsvBrowse);
csvBrowseBtn.addEventListener('click', e => { e.stopPropagation(); handleCsvBrowse(); });

csvDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  csvDropZone.classList.add('drag-over');
});
csvDropZone.addEventListener('dragleave', () => csvDropZone.classList.remove('drag-over'));
csvDropZone.addEventListener('drop', async e => {
  e.preventDefault();
  csvDropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    await loadCSV(file.path);
  }
});

csvClearBtn.addEventListener('click', () => {
  state.contacts = [];
  contactsTbody.innerHTML = '';
  contactsTableWrap.style.display = 'none';
  csvErrors.style.display = 'none';
  contactCountBadge.textContent = '0 loaded';
  updatePreview();
});

async function handleCsvBrowse() {
  const filePath = await window.api.openCSV();
  if (filePath) await loadCSV(filePath);
}

async function loadCSV(filePath) {
  const result = await window.api.parseCSV(filePath);
  csvErrors.style.display = 'none';

  if (!result.success) {
    csvErrors.textContent = result.error;
    csvErrors.style.display = 'block';
    return;
  }

  const { contacts, errors } = result.contacts;
  state.contacts = contacts;

  if (errors && errors.length) {
    csvErrors.textContent = 'Warnings:\n' + errors.join('\n');
    csvErrors.style.display = 'block';
  }

  renderContactsTable(contacts);
  contactCountBadge.textContent = `${contacts.length} loaded`;
  updatePreview();
}

function renderContactsTable(contacts) {
  contactsTbody.innerHTML = '';
  contacts.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.id = `row-${i}`;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escHtml(c.name)}</td>
      <td>${escHtml(c.phone)}</td>
      <td><span class="status-chip status-pending" id="status-${i}">pending</span></td>
    `;
    contactsTbody.appendChild(tr);
  });
  contactsLoadedLbl.textContent = `${contacts.length} contacts loaded`;
  contactsTableWrap.style.display = 'block';
}

// ─── Template ─────────────────────────────────────────────────────────────────

messageTemplate.addEventListener('input', () => {
  charCount.textContent = messageTemplate.value.length;
  updatePreview();
});

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    const insert = chip.dataset.insert;
    const pos = messageTemplate.selectionStart;
    const val = messageTemplate.value;
    messageTemplate.value = val.slice(0, pos) + insert + val.slice(pos);
    messageTemplate.focus();
    messageTemplate.setSelectionRange(pos + insert.length, pos + insert.length);
    charCount.textContent = messageTemplate.value.length;
    updatePreview();
  });
});

function updatePreview() {
  const tpl = messageTemplate.value;
  const contact = state.contacts[0];
  if (!tpl || !contact) {
    messagePreview.innerHTML = '<em>Preview will appear here once you load contacts and write a template.</em>';
    return;
  }
  // Render locally (mirrors templateService logic)
  const rendered = tpl.replace(/\{(\w+)\}/g, (m, k) =>
    contact[k] !== undefined ? escHtml(String(contact[k])) : m
  );
  messagePreview.textContent = rendered;
}

// ─── Image ────────────────────────────────────────────────────────────────────

imageBrowseBtn.addEventListener('click', async () => {
  const filePath = await window.api.openImage();
  if (!filePath) return;
  state.imagePath = filePath;
  imagePathDisplay.textContent = filePath.split(/[\\/]/).pop();
  imageClearBtn.style.display = 'inline-flex';

  // Show preview using file:// protocol
  imagePreview.src = `file://${filePath}`;
  imagePreviewWrap.style.display = 'block';
});

imageClearBtn.addEventListener('click', () => {
  state.imagePath = null;
  imagePathDisplay.textContent = 'No image selected';
  imageClearBtn.style.display = 'none';
  imagePreviewWrap.style.display = 'none';
  imagePreview.src = '';
});

// ─── Delay Sync ───────────────────────────────────────────────────────────────

delaySlider.addEventListener('input', () => {
  delayInput.value = delaySlider.value;
  updateSendSummary();
});

delayInput.addEventListener('change', () => {
  let v = Math.max(3, Math.min(60, parseInt(delayInput.value) || 8));
  delayInput.value = v;
  delaySlider.value = v;
  updateSendSummary();
});

// ─── Send Summary ─────────────────────────────────────────────────────────────

function updateSendSummary() {
  summaryContacts.textContent = `${state.contacts.length} contact${state.contacts.length !== 1 ? 's' : ''}`;
  const tpl = messageTemplate.value.trim();
  summaryTemplate.textContent = tpl ? `${tpl.slice(0, 28)}${tpl.length > 28 ? '…' : ''}` : 'No template';
  summaryImage.textContent = state.imagePath
    ? state.imagePath.split(/[\\/]/).pop()
    : 'No image';
  summaryDelay.textContent = `${delayInput.value}s delay`;
}

// ─── Automation Controls ──────────────────────────────────────────────────────

startBtn.addEventListener('click', async () => {
  if (!validateBeforeStart()) return;

  setRunningUI(true);
  progressSection.style.display = 'block';
  clearLog();
  state.statuses = [];

  // Reset contact status chips
  state.contacts.forEach((_, i) => setContactStatus(i, 'pending'));

  // Subscribe to events
  const off1 = window.api.on('automation:log',      onLog);
  const off2 = window.api.on('automation:status',   onStatus);
  const off3 = window.api.on('automation:progress', onProgress);
  const off4 = window.api.on('automation:done',     onDone);
  const off5 = window.api.on('automation:error',    onError);
  state.cleanups = [off1, off2, off3, off4, off5].filter(Boolean);

  await window.api.startAutomation({
    contacts:      state.contacts,
    template:      messageTemplate.value,
    imagePath:     state.imagePath,
    delaySeconds:  parseInt(delayInput.value) || 8,
    resumeFailed:  optResume.checked,
  });
});

pauseBtn.addEventListener('click', async () => {
  if (state.paused) {
    await window.api.resumeAutomation();
    state.paused = false;
    pauseBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z"/></svg> Pause`;
  } else {
    await window.api.pauseAutomation();
    state.paused = true;
    pauseBtn.textContent = '▶ Resume';
  }
});

stopBtn.addEventListener('click', async () => {
  await window.api.stopAutomation();
  setRunningUI(false);
  cleanupListeners();
});

exportBtn.addEventListener('click', exportReport);
reportExportBtn.addEventListener('click', exportReport);

async function exportReport() {
  if (!state.statuses.length) {
    addLog('warn', 'No report data to export yet.');
    return;
  }
  const filePath = await window.api.saveReport();
  if (!filePath) return;
  const result = await window.api.exportReport(filePath, state.statuses);
  if (result.success) {
    addLog('info', `✅ Report exported to ${filePath}`);
  } else {
    addLog('error', `Export failed: ${result.error}`);
  }
}

clearLogBtn.addEventListener('click', clearLog);

// ─── Automation Event Handlers ────────────────────────────────────────────────

function onLog({ level, message, time }) {
  addLog(level, message, time);
}

function onStatus({ index, status }) {
  state.statuses[index] = status;
  setContactStatus(index, status.status);
  renderReportTable(state.statuses);
}

function onProgress({ sent, total, statuses }) {
  state.statuses = statuses || state.statuses;
  const failed  = state.statuses.filter(s => s.status === 'failed').length;
  const pending = state.statuses.filter(s => s.status === 'pending' || s.status === 'sending').length;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

  statSent.textContent    = sent;
  statFailed.textContent  = failed;
  statPending.textContent = pending;
  statTotal.textContent   = total;
  progressFill.style.width = `${pct}%`;
  progressPct.textContent  = `${pct}%`;
}

function onDone({ sent, total }) {
  addLog('info', `🎉 Complete — ${sent}/${total} sent`);
  setRunningUI(false);
  cleanupListeners();
  renderReportTable(state.statuses);
}

function onError({ message }) {
  addLog('error', `Fatal: ${message}`);
  setRunningUI(false);
  cleanupListeners();
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateBeforeStart() {
  if (!state.contacts.length) {
    alert('Please load a CSV file with contacts first.');
    return false;
  }
  if (!messageTemplate.value.trim()) {
    alert('Please enter a message template.');
    return false;
  }
  return true;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function setRunningUI(running) {
  state.running = running;
  startBtn.disabled  = running;
  pauseBtn.disabled  = !running;
  stopBtn.disabled   = !running;
  if (!running) {
    state.paused = false;
    pauseBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z"/></svg> Pause`;
  }
}

function setContactStatus(index, status) {
  const chip = $(`status-${index}`);
  if (!chip) return;
  chip.className = `status-chip status-${status}`;
  chip.textContent = status;
}

function addLog(level, message, time) {
  // Remove empty placeholder
  const empty = logBody.querySelector('.log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;

  const now = time ? new Date(time) : new Date();
  const ts  = now.toTimeString().slice(0, 8);

  entry.innerHTML = `
    <span class="log-time">${ts}</span>
    <span class="log-msg">${escHtml(message)}</span>
  `;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
}

function clearLog() {
  logBody.innerHTML = '<div class="log-empty">No activity yet. Start sending to see logs.</div>';
}

function cleanupListeners() {
  state.cleanups.forEach(fn => { try { fn(); } catch {} });
  state.cleanups = [];
}

function renderReportTable(statuses) {
  if (!statuses || !statuses.length) return;
  reportTbody.innerHTML = '';
  statuses.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escHtml(s.name || '')}</td>
      <td>${escHtml(s.phone || '')}</td>
      <td><span class="status-chip status-${s.status}">${s.status || 'pending'}</span></td>
      <td>${s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : '—'}</td>
      <td style="color:var(--danger);font-size:11px">${escHtml(s.error || '')}</td>
    `;
    reportTbody.appendChild(tr);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  // Try to load previous report
  try {
    const saved = await window.api.loadReport();
    if (saved && saved.length) {
      state.statuses = saved;
    }
  } catch {}
})();
