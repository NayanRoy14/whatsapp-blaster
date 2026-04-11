/**
 * delay.js
 * Human-like timing utilities.
 * Random jitter prevents bot-pattern detection.
 */

/**
 * Wait for exactly ms milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function humanDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Return a random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Apply ±jitter fraction to a base delay.
 * e.g. jitteredDelay(5000, 0.2) returns a value in [4000, 6000]
 * @param {number} baseMs
 * @param {number} jitter - fraction (0–1)
 * @returns {number}
 */
function jitteredDelay(baseMs, jitter = 0.2) {
  const spread = baseMs * jitter;
  return Math.round(baseMs + (Math.random() * 2 - 1) * spread);
}

module.exports = { humanDelay, randomBetween, jitteredDelay };
