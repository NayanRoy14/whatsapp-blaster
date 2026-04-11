/**
 * logger.js
 * Thin wrapper around electron-log.
 * Writes to file in userData and to console.
 */

const log = require('electron-log');
const path = require('path');

// electron-log auto-detects userData path
log.transports.file.level = 'debug';
log.transports.console.level = 'debug';
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

module.exports = {
  info:  (...args) => log.info(...args),
  warn:  (...args) => log.warn(...args),
  error: (...args) => log.error(...args),
  debug: (...args) => log.debug(...args),
};
