/**
 * whatsappService.js
 * Core Puppeteer automation for WhatsApp Web.
 * Handles browser lifecycle, login detection, message sending, and image uploads.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const { app } = require('electron');
const logger = require('../utils/logger');
const { humanDelay, randomBetween } = require('../utils/delay');

// ─── Constants ────────────────────────────────────────────────────────────────

const WA_URL = 'https://web.whatsapp.com';
const SESSION_DIR = path.join(app.getPath('userData'), 'wa-session');

// CSS selectors — WhatsApp Web uses dynamic classnames, so we rely on
// data-testid, aria-label, and structural attributes which are far more stable.
const SELECTORS = {
  // QR code canvas — user is NOT logged in
  qrCode: 'canvas[aria-label="Scan this QR code to link a device"]',
  // Side panel — user IS logged in
  chatList: '#pane-side',

  // ── Text message input ──────────────────────────────────────────────────
  // data-tab="10" is the main composer; fall back to the footer contenteditable
  messageInput: [
    'div[contenteditable="true"][data-tab="10"]',
    'footer div[contenteditable="true"]',
    'div[role="textbox"][data-tab="10"]',
  ].join(', '),

  // ── Send text button ─────────────────────────────────────────────────────
  // WhatsApp renders either a button or a span depending on context
  sendButton: [
    'button[data-testid="send"]',
    'span[data-testid="send"]',
    '[data-testid="send"]',
    'span[data-icon="send"]',
  ].join(', '),

  // ── Attachment (paperclip) button ────────────────────────────────────────
  attachButton: [
    'button[data-testid="clip"]',
    'span[data-testid="clip"]',
    '[data-testid="clip"]',
    'div[title="Attach"]',
  ].join(', '),

  // ── Hidden <input type=file> revealed after clicking the paperclip ───────
  // WhatsApp renders multiple file inputs; the image one accepts image/* types
  imageFileInput: [
    'input[accept="image/*,video/mp4,video/3gpp,video/quicktime"]',
    'input[accept*="image/*"]',
    'input[type="file"]',
  ].join(', '),

  // ── "Photos & Videos" menu item inside the attach menu ──────────────────
  // On newer WA Web builds you must click a sub-menu item first
  attachPhotoMenu: [
    'li[data-testid="mi-attach-media"]',
    'li span[data-icon="photos"]',
    'input[accept*="image"]',
  ].join(', '),

  // ── Caption box shown after image is selected ────────────────────────────
  // Different data-tab value inside the media preview modal
  captionInput: [
    'div[contenteditable="true"][data-tab="11"]',
    'div[contenteditable="true"][data-tab="10"]',
    'div[role="textbox"]',
  ].join(', '),

  // ── Send button inside the image preview / caption modal ────────────────
  imageSendButton: [
    'div[aria-label="Send"]',
    'span[data-icon="send"]',
    'button[data-testid="send"]',
    '[data-testid="send"]',
  ].join(', '),

  // Invalid phone error text
  invalidPhone: '[data-testid="intro-text"]',
};

// ─── State ────────────────────────────────────────────────────────────────────

let browser = null;
let page = null;

// ─── Browser Lifecycle ────────────────────────────────────────────────────────

/**
 * Launch Chromium with persistent session directory.
 * headless:false is required for WhatsApp Web to work.
 */
async function initBrowser() {
  if (browser) return; // already running

  logger.info('Launching browser...');
  browser = await puppeteer.launch({
    headless: false,
    userDataDir: SESSION_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', // avoid bot detection
    ],
    defaultViewport: null, // use window size
  });

  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();

  // Mask automation signals
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  logger.info('Browser launched');
}

/**
 * Navigate to WhatsApp Web.
 */
async function openWhatsApp() {
  logger.info('Opening WhatsApp Web...');
  await page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

/**
 * Wait until the user is logged in (either already has session or scans QR).
 * After login is confirmed, waits for the page to fully settle before returning.
 * This prevents the "Requesting main frame too early" error that occurs when
 * page.goto() is called while Chromium is still finishing post-login hydration.
 *
 * @param {Function} onQRDetected - callback when QR appears (user must scan)
 * @param {Function} onLoggedIn  - callback when login confirmed
 */
async function waitForLogin(onQRDetected, onLoggedIn) {
  logger.info('Waiting for WhatsApp login...');
  const timeout = 5 * 60 * 1000; // 5 minutes
  const start = Date.now();
  let qrNotified = false;

  while (Date.now() - start < timeout) {
    try {
      // Check if QR code is visible — notify only once, not every poll cycle
      const qr = await page.$(SELECTORS.qrCode);
      if (qr && onQRDetected && !qrNotified) {
        qrNotified = true;
        onQRDetected();
      }

      // Check if chat list is visible (means we are logged in)
      const chatList = await page.$(SELECTORS.chatList);
      if (chatList) {
        logger.info('WhatsApp login confirmed — waiting for page to fully settle...');
        if (onLoggedIn) onLoggedIn();

        // CRITICAL FIX: WhatsApp Web continues heavy JS work after the chat list
        // appears. Calling page.goto() immediately causes "Requesting main frame
        // too early". We wait 4s then poll document.readyState before proceeding.
        await humanDelay(4000);
        await waitForPageReady();

        logger.info('Page settled — ready to send');
        return true;
      }
    } catch (err) {
      // Transient errors during polling are normal while page is loading
      logger.debug(`Login poll error (ignored): ${err.message}`);
    }

    await humanDelay(2000);
  }

  throw new Error('WhatsApp login timed out after 5 minutes');
}

/**
 * Poll until the page's main frame reports readyState = complete or interactive.
 * Prevents navigation errors caused by calling goto() on a not-yet-ready frame.
 * @param {number} maxAttempts
 */
async function waitForPageReady(maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ready = await page.evaluate(() => document.readyState);
      if (ready === 'complete' || ready === 'interactive') {
        logger.debug(`Page readyState: ${ready}`);
        return;
      }
    } catch (err) {
      logger.debug(`waitForPageReady attempt ${i + 1}: ${err.message}`);
    }
    await humanDelay(1000);
  }
}

/**
 * Check if browser/page are still alive.
 */
async function isReady() {
  if (!browser || !page) return false;
  try {
    await page.evaluate(() => true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Close browser and reset state.
 */
async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    page = null;
    logger.info('Browser closed');
  }
}

// ─── Messaging ────────────────────────────────────────────────────────────────

/**
 * Safe page.goto() wrapper.
 * The "Requesting main frame too early" error is a Puppeteer/Chromium race
 * condition where goto() is called before the renderer process is ready.
 * This helper catches that specific error and retries with a delay.
 *
 * @param {string} url
 * @param {number} maxAttempts
 */
async function safeGoto(url, maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return; // success
    } catch (err) {
      const isFrameError = err.message.includes('main frame')
                        || err.message.includes('frame was detached')
                        || err.message.includes('Session closed')
                        || err.message.includes('Target closed');

      if (isFrameError && i < maxAttempts - 1) {
        logger.warn(`Navigation not ready (attempt ${i + 1}): ${err.message} — retrying in 3s`);
        await humanDelay(3000);
        // Re-acquire the page reference in case it changed
        try {
          const pages = await browser.pages();
          page = pages.find(p => !p.isClosed()) || pages[0];
        } catch {}
        continue;
      }
      throw err; // non-recoverable or out of attempts
    }
  }
}

/**
 * Send a text message to a phone number.
 * Opens the WhatsApp direct URL, waits for chat to load, types and sends.
 *
 * @param {string} phone   - e.g. "14155552671"
 * @param {string} message - rendered message text
 * @param {number} retries - retry count (default 2)
 */
async function sendMessage(phone, message, retries = 2) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      logger.info(`Sending to ${phone} (attempt ${attempt})`);

      // Use safe navigation — retries the goto if the frame isn't ready yet
      const url = `${WA_URL}/send?phone=${phone}`;
      await safeGoto(url);

      // Give WhatsApp's SPA time to route and render the chat
      await humanDelay(randomBetween(2000, 3000));

      // Wait for either the message input or an invalid-phone indicator
      await page.waitForSelector(
        `${SELECTORS.messageInput}, ${SELECTORS.invalidPhone}`,
        { timeout: 25000 }
      );

      // Detect invalid phone number page
      const invalid = await page.$(SELECTORS.invalidPhone);
      if (invalid) {
        const txt = await page.evaluate(el => el.innerText, invalid);
        if (txt && txt.toLowerCase().includes('phone number')) {
          throw new Error(`Invalid phone number: ${phone}`);
        }
      }

      // Find and focus message input
      const input = await page.waitForSelector(SELECTORS.messageInput, { timeout: 12000 });
      await input.click();
      await humanDelay(randomBetween(300, 700));

      // Type message — execCommand works reliably with Unicode/emoji
      await page.evaluate((msg) => {
        const candidates = document.querySelectorAll('div[contenteditable="true"]');
        let el = document.querySelector('div[contenteditable="true"][data-tab="10"]')
                || document.querySelector('footer div[contenteditable="true"]')
                || candidates[candidates.length - 1];
        if (!el) throw new Error('Message input not found in DOM');
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, msg);
      }, message);

      await humanDelay(randomBetween(400, 900));

      // Click the send button — try each selector in order
      let sent = false;
      const sendSelectors = [
        'button[data-testid="send"]',
        'span[data-testid="send"]',
        '[data-testid="send"]',
        'span[data-icon="send"]',
      ];

      for (const sel of sendSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            sent = true;
            break;
          }
        } catch {}
      }

      if (!sent) {
        // Fallback: press Enter in the input box
        await input.press('Enter');
        logger.warn('Send button not found; used Enter key fallback');
      }

      await humanDelay(randomBetween(800, 1500));
      logger.info(`Message sent to ${phone}`);
      return { success: true };

    } catch (err) {
      logger.warn(`Attempt ${attempt} failed for ${phone}: ${err.message}`);
      if (attempt <= retries) {
        await humanDelay(randomBetween(3000, 6000));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Send an image to the currently open chat.
 * Must be called AFTER sendMessage() has already navigated to the chat.
 *
 * Strategy:
 *  1. Click the paperclip/attach button to open the attach menu
 *  2. Directly inject the file path into the hidden <input type=file>
 *     (bypasses needing to click the exact sub-menu item which varies by WA version)
 *  3. Wait for the image preview modal to appear
 *  4. Optionally type a caption
 *  5. Click the send button inside the modal
 *
 * @param {string} imagePath - absolute local path to image file
 * @param {string} caption   - optional caption text
 */
async function sendImage(imagePath, caption = '') {
  logger.info(`Attaching image: ${imagePath}`);

  // ── Step 1: Open the attach menu ─────────────────────────────────────────
  const clipBtn = await page.waitForSelector(SELECTORS.attachButton, { timeout: 10000 });
  await clipBtn.click();
  await humanDelay(randomBetween(600, 1100));

  // ── Step 2: Upload file via the hidden input ──────────────────────────────
  // WhatsApp Web hides <input type=file> elements. We make them visible
  // temporarily so Puppeteer can interact with them.
  let uploaded = false;

  // First attempt: standard uploadFile on any visible/hidden file input
  try {
    // Make all file inputs temporarily accessible
    await page.evaluate(() => {
      document.querySelectorAll('input[type="file"]').forEach(el => {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.zIndex = '99999';
      });
    });

    // Prefer the image-accepting input
    const imageInput = await page.$(SELECTORS.imageFileInput);
    if (imageInput) {
      await imageInput.uploadFile(imagePath);
      uploaded = true;
      logger.info('Image file set via image/* input');
    }
  } catch (e) {
    logger.warn(`First upload attempt failed: ${e.message}`);
  }

  // Second attempt: use the first file input if image-specific one not found
  if (!uploaded) {
    try {
      const anyInput = await page.$('input[type="file"]');
      if (anyInput) {
        await anyInput.uploadFile(imagePath);
        uploaded = true;
        logger.info('Image file set via generic file input');
      }
    } catch (e) {
      logger.warn(`Second upload attempt failed: ${e.message}`);
    }
  }

  if (!uploaded) {
    throw new Error('Could not find a file input to upload the image. The attach menu may not have opened.');
  }

  // ── Step 3: Wait for image preview modal ────────────────────────────────
  // After upload, WA shows a preview. Wait for the send button in that modal.
  // The modal send button has aria-label="Send" or data-icon="send"
  await humanDelay(randomBetween(1500, 2500));

  // ── Step 4: Optional caption ──────────────────────────────────────────────
  if (caption) {
    try {
      // Caption input appears in the preview modal (data-tab="11" or similar)
      const captionBox = await page.waitForSelector(
        'div[contenteditable="true"][data-tab="11"], div[contenteditable="true"][data-tab="10"][role="textbox"]',
        { timeout: 6000 }
      );
      await captionBox.click();
      await humanDelay(randomBetween(200, 500));
      await page.evaluate((text) => {
        // Find the focused contenteditable and insert text
        const el = document.activeElement;
        if (el && el.isContentEditable) {
          document.execCommand('insertText', false, text);
        } else {
          // Fallback: find any caption-area contenteditable
          const boxes = document.querySelectorAll('div[contenteditable="true"]');
          // Use the last one visible in a modal/overlay
          const last = [...boxes].filter(b => b.offsetParent !== null).pop();
          if (last) { last.focus(); document.execCommand('insertText', false, text); }
        }
      }, caption);
      await humanDelay(randomBetween(300, 600));
      logger.info('Caption typed');
    } catch (e) {
      logger.warn(`Caption input not found, sending without caption: ${e.message}`);
    }
  }

  // ── Step 5: Click send in the image preview modal ─────────────────────────
  // Try multiple selectors for the send button
  let sent = false;
  const sendSelectors = [
    'div[aria-label="Send"]',
    'span[data-icon="send"]',
    '[data-testid="send"]',
    'button[data-testid="send"]',
  ];

  for (const sel of sendSelectors) {
    try {
      const btn = await page.waitForSelector(sel, { timeout: 4000 });
      if (btn) {
        await btn.click();
        sent = true;
        logger.info(`Image send button clicked (${sel})`);
        break;
      }
    } catch {
      // try next selector
    }
  }

  if (!sent) {
    // Last resort: press Enter in the caption area
    await page.keyboard.press('Enter');
    logger.warn('Send button not found; pressed Enter as fallback');
  }

  // Wait for upload + delivery
  await humanDelay(randomBetween(2500, 4000));
  logger.info('Image sent successfully');
  return { success: true };
}

module.exports = {
  initBrowser,
  openWhatsApp,
  waitForLogin,
  isReady,
  closeBrowser,
  sendMessage,
  sendImage,
};
