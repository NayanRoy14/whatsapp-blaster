/**
 * automationService.js
 * Orchestrates the full send loop:
 * contacts → template render → send → status update → delay → repeat
 *
 * Supports pause/resume/stop.
 * Persists status to report.json in userData.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const logger = require('../utils/logger');
const templateService = require('./templateService');
const whatsapp = require('./whatsappService');
const { humanDelay, jitteredDelay, randomBetween } = require('../utils/delay');

// ─── State ────────────────────────────────────────────────────────────────────

let _running  = false;
let _paused   = false;
let _stopped  = false;
let _emit     = null;   // event emitter callback set by start()
let _statuses = [];     // array of status objects

const REPORT_PATH = () => path.join(app.getPath('userData'), 'report.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emit(event, data) {
  if (_emit) _emit(event, data);
}

function log(level, message) {
  logger[level](message);
  emit('automation:log', { level, message, time: new Date().toISOString() });
}

function saveReport() {
  try {
    fs.writeFileSync(REPORT_PATH(), JSON.stringify(_statuses, null, 2), 'utf8');
  } catch (err) {
    logger.warn('Could not save report.json: ' + err.message);
  }
}

function updateStatus(index, patch) {
  Object.assign(_statuses[index], patch);
  emit('automation:status', { index, status: _statuses[index] });
  saveReport();
}

/** Block until unpaused or stopped */
async function waitWhilePaused() {
  while (_paused && !_stopped) {
    await humanDelay(500);
  }
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * @param {Object} config
 * @param {Array}  config.contacts      - [{name, phone}]
 * @param {string} config.template      - message template
 * @param {string} [config.imagePath]   - optional image
 * @param {number} config.delaySeconds  - base delay between sends
 * @param {boolean} config.resumeFailed - skip already-sent contacts
 * @param {Function} emitFn             - callback(event, data)
 */
async function start(config, emitFn) {
  if (_running) throw new Error('Automation already running');

  _running = true;
  _paused  = false;
  _stopped = false;
  _emit    = emitFn;

  const { contacts, template, imagePath, delaySeconds = 5, resumeFailed } = config;

  // Initialize statuses (or resume from existing)
  const existing = (() => {
    try {
      if (resumeFailed && fs.existsSync(REPORT_PATH())) {
        return JSON.parse(fs.readFileSync(REPORT_PATH(), 'utf8'));
      }
    } catch {}
    return null;
  })();

  _statuses = contacts.map((c, i) => {
    const prev = existing && existing[i];
    // If resuming and previously sent, keep that status
    if (resumeFailed && prev && prev.phone === c.phone && prev.status === 'sent') {
      return { ...c, status: 'sent', timestamp: prev.timestamp };
    }
    return { ...c, status: 'pending' };
  });

  emit('automation:progress', { sent: 0, total: contacts.length, statuses: _statuses });

  try {
    log('info', 'Initializing browser...');
    await whatsapp.initBrowser();
    await whatsapp.openWhatsApp();

    log('info', 'Waiting for WhatsApp login (scan QR if prompted)...');
    await whatsapp.waitForLogin(
      () => log('info', '📱 Please scan the QR code in the browser window'),
      () => log('info', '✅ WhatsApp logged in successfully')
    );

    let sentCount = _statuses.filter(s => s.status === 'sent').length;

    for (let i = 0; i < contacts.length; i++) {
      if (_stopped) break;
      await waitWhilePaused();
      if (_stopped) break;

      const contact = contacts[i];
      const status  = _statuses[i];

      // Skip already sent (resume mode)
      if (status.status === 'sent') {
        log('info', `⏭  Skipping ${contact.name} (already sent)`);
        continue;
      }

      updateStatus(i, { status: 'sending' });
      log('info', `📨 Sending to ${contact.name} (${contact.phone})...`);

      try {
        const message = templateService.render(template, contact);

        await whatsapp.sendMessage(contact.phone, message);

        if (imagePath) {
          await humanDelay(randomBetween(1000, 2000));
          // Pass message as caption so image + text arrive together
          await whatsapp.sendImage(imagePath);
        }

        sentCount++;
        updateStatus(i, {
          status: 'sent',
          timestamp: new Date().toISOString(),
          error: null,
        });

        log('info', `✅ Sent to ${contact.name}`);
        emit('automation:progress', {
          sent: sentCount,
          total: contacts.length,
          statuses: _statuses,
        });

      } catch (err) {
        log('warn', `❌ Failed: ${contact.name} — ${err.message}`);
        updateStatus(i, {
          status: 'failed',
          timestamp: new Date().toISOString(),
          error: err.message,
        });
      }

      // Human-like delay before next contact (skip after last)
      if (i < contacts.length - 1 && !_stopped) {
        const ms = jitteredDelay(delaySeconds * 1000, 0.2);
        log('info', `⏱  Waiting ${(ms / 1000).toFixed(1)}s...`);
        await humanDelay(ms);
      }
    }

    if (_stopped) {
      log('info', '🛑 Automation stopped by user');
    } else {
      log('info', `🎉 Done! Sent: ${sentCount}/${contacts.length}`);
    }

    emit('automation:done', { sent: sentCount, total: contacts.length, statuses: _statuses });

  } catch (err) {
    log('error', `Fatal error: ${err.message}`);
    emit('automation:error', { message: err.message });
  } finally {
    _running = false;
    _paused  = false;
  }
}

function pause() {
  if (!_running) return;
  _paused = true;
  log('info', '⏸  Paused');
  emit('automation:log', { level: 'info', message: '⏸  Paused', time: new Date().toISOString() });
}

function resume() {
  if (!_running) return;
  _paused = false;
  log('info', '▶️  Resumed');
}

async function stop() {
  _stopped = true;
  _paused  = false;
  await whatsapp.closeBrowser();
  _running = false;
}

module.exports = { start, pause, resume, stop };
