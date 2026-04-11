/**
 * whatsappService.js
 * Core Puppeteer automation for WhatsApp Web.
 * Handles browser lifecycle, login detection, message sending, and image uploads.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { app } = require('electron');
const logger = require('../utils/logger');
const { humanDelay, randomBetween } = require('../utils/delay');

const WA_URL = 'https://web.whatsapp.com';
const SESSION_DIR = path.join(app.getPath('userData'), 'wa-session');
const DEBUG_DIR = path.join(app.getPath('userData'), 'debug');

const CONFIG = {
  timeouts: {
    default: 20000,
    chatLoad: 20000,
    messageInput: 20000,
    attachButton: 20000,
    imagePreview: 20000,
    login: 30000,
  },
  retries: {
    sendMessage: 2,
    attachButton: 3,
    click: 3,
    attachClick: 3,
  },
  delays: {
    afterNavigationMin: 600,
    afterNavigationMax: 1100,
    composerSettleMin: 250,
    composerSettleMax: 500,
    attachMenuMin: 150,
    attachMenuMax: 300,
    retryBaseMs: 500,
    retryStepMs: 500,
    postSendMin: 250,
    postSendMax: 500,
    postUploadMin: 500,
    postUploadMax: 900,
    postImageSendMin: 80,
    postImageSendMax: 180,
  },
};

const SELECTORS = {
  qrCode: 'canvas[aria-label="Scan this QR code to link a device"]',
  chatList: '#pane-side',
  invalidPhone: '[data-testid="intro-text"]',

  messageInputCandidates: [
    'div[contenteditable="true"][data-tab="10"]',
    'footer div[contenteditable="true"]',
    'div[role="textbox"][data-tab="10"]',
    '[contenteditable="true"]',
  ],

  sendButtonCandidates: [
    'button[data-testid="send"]',
    'span[data-testid="send"]',
    '[data-testid="send"]',
    'span[data-icon="send"]',
  ],

  attachButtonCandidates: [
    '[aria-label="Attach"]',
    'span[data-icon="clip"]',
    'div[title="Attach"]',
  ],

  imageFileInputCandidates: [
    'input[accept="image/*,video/mp4,video/3gpp,video/quicktime"]',
    'input[accept*="image/*"]',
  ],

  mediaMenuCandidates: [
    'li[data-testid="mi-attach-media"]',
    'button[data-testid="mi-attach-media"]',
    '[aria-label="Photos & videos"]',
    'div[title="Photos & videos"]',
  ],

  captionInputCandidates: [
    'div[contenteditable="true"][data-tab="11"]',
    'div[contenteditable="true"][data-tab="10"]',
    'div[role="textbox"]',
  ],

  imageSendButtonCandidates: [
    '[role="dialog"] div[aria-label="Send"]',
    '[role="dialog"] button[data-testid="send"]',
    '[role="dialog"] [data-testid="send"]',
    '[role="dialog"] span[data-icon="send"]',
    'span[data-icon="send"]',
    'button[data-testid="send"]',
    '[data-testid="send"]',
  ],

  mediaPreviewCandidates: [
    '[role="dialog"] img',
    '[role="dialog"] video',
    '[role="dialog"] canvas',
    '[role="dialog"] [data-testid="media-viewer"]',
    '[role="dialog"] [data-testid="media-preview"]',
    '[role="dialog"] [data-animate-media-preview="true"]',
    'div[aria-label="Media preview"] img',
    'div[aria-label="Media preview"] video',
  ],
};

SELECTORS.messageInput = SELECTORS.messageInputCandidates.join(', ');
SELECTORS.sendButton = SELECTORS.sendButtonCandidates.join(', ');
SELECTORS.attachButton = SELECTORS.attachButtonCandidates.join(', ');
SELECTORS.imageFileInput = SELECTORS.imageFileInputCandidates.join(', ');
SELECTORS.mediaMenu = SELECTORS.mediaMenuCandidates.join(', ');
SELECTORS.captionInput = SELECTORS.captionInputCandidates.join(', ');
SELECTORS.imageSendButton = SELECTORS.imageSendButtonCandidates.join(', ');
SELECTORS.mediaPreview = SELECTORS.mediaPreviewCandidates.join(', ');

let browser = null;
let page = null;

async function ensureDebugDirectory() {
  try {
    await fs.promises.mkdir(DEBUG_DIR, { recursive: true });
  } catch (err) {
    logger.debug(`Could not create debug directory: ${err.message}`);
  }
}

async function captureDebugScreenshot(name) {
  if (!page) return null;

  try {
    await ensureDebugDirectory();
    const filePath = path.join(DEBUG_DIR, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    logger.warn(`Debug screenshot saved: ${filePath}`);
    return filePath;
  } catch (err) {
    logger.warn(`Could not capture debug screenshot: ${err.message}`);
    return null;
  }
}

async function initBrowser() {
  if (browser) return;

  logger.info('Launching browser...');
  browser = await puppeteer.launch({
    headless: false,
    userDataDir: SESSION_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: null,
  });

  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  logger.info('Browser launched');
}

async function openWhatsApp() {
  logger.info('Opening WhatsApp Web...');
  await page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.login });
}

async function waitForLogin(onQRDetected, onLoggedIn) {
  logger.info('Waiting for WhatsApp login...');
  const timeout = 5 * 60 * 1000;
  const start = Date.now();
  let qrNotified = false;

  while (Date.now() - start < timeout) {
    try {
      const qr = await page.$(SELECTORS.qrCode);
      if (qr && onQRDetected && !qrNotified) {
        qrNotified = true;
        onQRDetected();
      }

      const chatList = await page.$(SELECTORS.chatList);
      if (chatList) {
        logger.info('WhatsApp login confirmed; waiting for page to settle...');
        if (onLoggedIn) onLoggedIn();

        await humanDelay(4000);
        await waitForPageReady();

        logger.info('Page settled and ready');
        return true;
      }
    } catch (err) {
      logger.debug(`Login poll error (ignored): ${err.message}`);
    }

    await humanDelay(2000);
  }

  throw new Error('WhatsApp login timed out after 5 minutes');
}

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

async function isReady() {
  if (!browser || !page) return false;

  try {
    await page.evaluate(() => true);
    return true;
  } catch {
    return false;
  }
}

async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch {}

    browser = null;
    page = null;
    logger.info('Browser closed');
  }
}

async function safeGoto(url, maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.login });
      return;
    } catch (err) {
      const isFrameError = err.message.includes('main frame')
        || err.message.includes('frame was detached')
        || err.message.includes('Session closed')
        || err.message.includes('Target closed');

      if (isFrameError && i < maxAttempts - 1) {
        logger.warn(`Navigation not ready (attempt ${i + 1}): ${err.message}; retrying in 3s`);
        await humanDelay(3000);

        try {
          const pages = await browser.pages();
          page = pages.find((p) => !p.isClosed()) || pages[0];
        } catch {}

        continue;
      }

      throw err;
    }
  }
}

function isRetryableClickError(message) {
  return message.includes('detached')
    || message.includes('not visible')
    || message.includes('not clickable')
    || message.includes('Node is either not clickable')
    || message.includes('Execution context was destroyed');
}

async function getVisibleElement(selector, timeout = CONFIG.timeouts.default) {
  await page.waitForFunction(
    (sel) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.some((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      });
    },
    { timeout },
    selector
  );

  const handles = await page.$$(selector);
  for (const handle of handles) {
    try {
      const visible = await handle.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      });

      if (visible) {
        return handle;
      }
    } catch (err) {
      logger.debug(`Skipped stale handle for ${selector}: ${err.message}`);
    }
  }

  throw new Error(`Visible element not found for selector: ${selector}`);
}

async function safeClick(elementHandle, label, retries = CONFIG.retries.click) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await elementHandle.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      });
      await humanDelay(150);
      await elementHandle.click();
      logger.debug(`${label} clicked on attempt ${attempt}`);
      return true;
    } catch (err) {
      lastError = err;
      logger.warn(`${label} click failed on attempt ${attempt}/${retries}: ${err.message}`);

      if (!isRetryableClickError(err.message) || attempt === retries) {
        throw err;
      }

      await humanDelay(CONFIG.delays.retryBaseMs + ((attempt - 1) * CONFIG.delays.retryStepMs));
    }
  }

  throw lastError;
}

async function waitForChatReady() {
  logger.debug('Waiting for chat to finish loading...');

  await page.waitForSelector(SELECTORS.messageInput, {
    timeout: CONFIG.timeouts.messageInput,
  });

  await page.waitForFunction(
    (selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      return nodes.some((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      });
    },
    { timeout: CONFIG.timeouts.chatLoad },
    SELECTORS.messageInput
  );

  await humanDelay(randomBetween(CONFIG.delays.composerSettleMin, CONFIG.delays.composerSettleMax));
  logger.debug('Chat input is ready');
}

async function waitForAttachButton(pageInstance) {
  await waitForChatReady();

  let lastError = null;

  for (let attempt = 1; attempt <= CONFIG.retries.attachButton; attempt++) {
    logger.info(`Looking for attach button (attempt ${attempt}/${CONFIG.retries.attachButton})`);

    for (const selector of SELECTORS.attachButtonCandidates) {
      try {
        await pageInstance.waitForFunction(
          (sel) => {
            const nodes = Array.from(document.querySelectorAll(sel));
            return nodes.some((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0
                && rect.height > 0
                && style.visibility !== 'hidden'
                && style.display !== 'none'
                && !el.disabled;
            });
          },
          { timeout: CONFIG.timeouts.attachButton },
          selector
        );

        const button = await getVisibleElement(selector, CONFIG.timeouts.attachButton);
        logger.info(`Attach button found with selector: ${selector}`);
        return button;
      } catch (err) {
        lastError = err;
        logger.warn(`Attach selector failed: ${selector} (${err.message})`);
      }
    }

    if (attempt < CONFIG.retries.attachButton) {
      const retryDelay = CONFIG.delays.retryBaseMs + ((attempt - 1) * CONFIG.delays.retryStepMs);
      logger.warn(`Retrying attach button lookup in ${retryDelay}ms`);
      await humanDelay(retryDelay);
      await waitForChatReady();
    }
  }

  await captureDebugScreenshot('attach-button-not-found');
  throw new Error(`Attach button not found after ${CONFIG.retries.attachButton} attempts: ${lastError ? lastError.message : 'unknown error'}`);
}

async function findMessageInput() {
  await waitForChatReady();
  return getVisibleElement(SELECTORS.messageInput, CONFIG.timeouts.messageInput);
}

async function clickAttachButtonWithRetry() {
  let lastError = null;

  for (let attempt = 1; attempt <= CONFIG.retries.attachClick; attempt++) {
    try {
      const attachButton = await waitForAttachButton(page);
      await safeClick(attachButton, 'Attach button');
      await humanDelay(randomBetween(CONFIG.delays.attachMenuMin, CONFIG.delays.attachMenuMax));
      return true;
    } catch (err) {
      lastError = err;
      logger.warn(`Attach button interaction retry ${attempt}/${CONFIG.retries.attachClick}: ${err.message}`);

      if (attempt < CONFIG.retries.attachClick) {
        const retryDelay = CONFIG.delays.retryBaseMs + ((attempt - 1) * CONFIG.delays.retryStepMs);
        await humanDelay(retryDelay);
      }
    }
  }

  await captureDebugScreenshot('attach-button-click-failed');
  throw lastError || new Error('Unable to click attach button');
}

async function openChat(phone) {
  logger.info(`Opening chat for ${phone}`);

  const url = `${WA_URL}/send?phone=${phone}`;
  await safeGoto(url);

  await humanDelay(randomBetween(CONFIG.delays.afterNavigationMin, CONFIG.delays.afterNavigationMax));

  await page.waitForSelector(
    `${SELECTORS.messageInput}, ${SELECTORS.invalidPhone}`,
    { timeout: 25000 }
  );

  const invalid = await page.$(SELECTORS.invalidPhone);
  if (invalid) {
    const txt = await page.evaluate((el) => el.innerText, invalid);
    if (txt && txt.toLowerCase().includes('phone number')) {
      throw new Error(`Invalid phone number: ${phone}`);
    }
  }

  await waitForChatReady();
}

async function uploadViaMediaChooser(imagePath) {
  for (const selector of SELECTORS.mediaMenuCandidates) {
    try {
      const menuItem = await getVisibleElement(selector, 4000);
      const chooserPromise = page.waitForFileChooser({ timeout: 5000 });

      await safeClick(menuItem, `Media menu (${selector})`, 2);
      const chooser = await chooserPromise;
      await chooser.accept([imagePath]);

      logger.info(`Image selected through media chooser: ${selector}`);
      return true;
    } catch (err) {
      logger.debug(`Media chooser selector skipped: ${selector} (${err.message})`);
    }
  }

  return false;
}

async function findMediaFileInput() {
  await page.waitForFunction(
    (selector) => {
      return Array.from(document.querySelectorAll(selector)).some((el) => {
        const accept = (el.getAttribute('accept') || '').toLowerCase();
        return accept.includes('image/');
      });
    },
    { timeout: CONFIG.timeouts.default },
    SELECTORS.imageFileInput
  );

  const inputs = await page.$$(SELECTORS.imageFileInput);
  let bestMatch = null;
  let bestScore = -1;

  for (const input of inputs) {
    try {
      const metadata = await input.evaluate((el) => {
        const accept = (el.getAttribute('accept') || '').toLowerCase();
        const score = [
          accept.includes('image/*,video/mp4'),
          accept.includes('video/quicktime'),
          accept.includes('video/3gpp'),
          accept.includes('image/*'),
          !accept.includes('webp'),
        ].filter(Boolean).length;

        return {
          accept,
          isMediaInput: accept.includes('image/'),
          score,
        };
      });

      if (!metadata.isMediaInput) {
        continue;
      }

      if (metadata.accept.includes('webp') && !metadata.accept.includes('video/mp4')) {
        logger.debug(`Rejected sticker-like file input: ${metadata.accept}`);
        continue;
      }

      if (metadata.score > bestScore) {
        bestMatch = input;
        bestScore = metadata.score;
      }
    } catch (err) {
      logger.debug(`Skipped stale media input handle: ${err.message}`);
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  throw new Error('Media file input not found');
}

async function waitForMediaPreview() {
  await page.waitForFunction(
    (previewSelector, captionSelector, sendSelector) => {
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };

      const previewVisible = Array.from(document.querySelectorAll(previewSelector)).some(isVisible);
      const captionVisible = Array.from(document.querySelectorAll(captionSelector)).some(isVisible);
      const sendVisible = Array.from(document.querySelectorAll(sendSelector)).some((el) => {
        const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
        return isVisible(el) && !disabled;
      });

      return previewVisible || captionVisible || sendVisible;
    },
    { timeout: CONFIG.timeouts.imagePreview },
    SELECTORS.mediaPreview,
    SELECTORS.captionInput,
    SELECTORS.imageSendButton
  );

  logger.info('Media preview detected');
}

async function waitForMediaSendButton() {
  for (const selector of SELECTORS.imageSendButtonCandidates) {
    try {
      await page.waitForFunction(
        (sel) => {
          const nodes = Array.from(document.querySelectorAll(sel));
          return nodes.some((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
            return rect.width > 0
              && rect.height > 0
              && style.visibility !== 'hidden'
              && style.display !== 'none'
              && !disabled;
          });
        },
        { timeout: 5000 },
        selector
      );

      const button = await getVisibleElement(selector, 5000);
      logger.info(`Media send button found with selector: ${selector}`);
      return { button, selector };
    } catch (err) {
      logger.debug(`Media send selector skipped: ${selector} (${err.message})`);
    }
  }

  throw new Error('Media send button not found in preview dialog');
}

async function sendMessage(phone, message, retries = CONFIG.retries.sendMessage) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      logger.info(`Sending to ${phone} (attempt ${attempt})`);
      await openChat(phone);

      const input = await findMessageInput();
      await safeClick(input, 'Message input');
      await humanDelay(randomBetween(300, 700));

      await page.evaluate((msg) => {
        const candidates = document.querySelectorAll('div[contenteditable="true"]');
        const el = document.querySelector('div[contenteditable="true"][data-tab="10"]')
          || document.querySelector('footer div[contenteditable="true"]')
          || candidates[candidates.length - 1];

        if (!el) {
          throw new Error('Message input not found in DOM');
        }

        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, msg);
      }, message);

      await humanDelay(randomBetween(400, 900));

      let sent = false;
      for (const selector of SELECTORS.sendButtonCandidates) {
        try {
          const button = await page.$(selector);
          if (button) {
            await safeClick(button, `Send button (${selector})`);
            sent = true;
            break;
          }
        } catch (err) {
          logger.debug(`Send button selector failed: ${selector} (${err.message})`);
        }
      }

      if (!sent) {
        await input.press('Enter');
        logger.warn('Send button not found; used Enter key fallback');
      }

      await humanDelay(randomBetween(CONFIG.delays.postSendMin, CONFIG.delays.postSendMax));
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

async function sendImage(imagePath, caption = '') {
  logger.info(`Attaching image: ${imagePath}`);

  await clickAttachButtonWithRetry();

  let uploaded = false;

  try {
    uploaded = await uploadViaMediaChooser(imagePath);
  } catch (err) {
    logger.warn(`Media chooser upload failed: ${err.message}`);
  }

  if (!uploaded) {
    try {
      await page.evaluate(() => {
        document.querySelectorAll('input[type="file"]').forEach((el) => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.style.opacity = '1';
          el.style.position = 'fixed';
          el.style.top = '0';
          el.style.left = '0';
          el.style.zIndex = '99999';
        });
      });

      const imageInput = await findMediaFileInput();
      if (imageInput) {
        await imageInput.uploadFile(imagePath);
        uploaded = true;
        logger.info('Image file set via image input');
      }
    } catch (err) {
      logger.warn(`Hidden media input upload failed: ${err.message}`);
    }
  }

  if (!uploaded) {
    try {
      const mediaInput = await findMediaFileInput();
      if (mediaInput) {
        await mediaInput.uploadFile(imagePath);
        uploaded = true;
        logger.info('Image file set via fallback media input');
      }
    } catch (err) {
      logger.warn(`Second upload attempt failed: ${err.message}`);
    }
  }

  if (!uploaded) {
    await captureDebugScreenshot('image-upload-input-missing');
    throw new Error('Could not find a file input to upload the image. The attach menu may not have opened.');
  }

  await waitForMediaPreview();
  await humanDelay(randomBetween(CONFIG.delays.postUploadMin, CONFIG.delays.postUploadMax));

  if (caption) {
    try {
      const captionBox = await page.waitForSelector(SELECTORS.captionInput, {
        timeout: CONFIG.timeouts.default,
      });

      await safeClick(captionBox, 'Caption input');
      await humanDelay(randomBetween(200, 500));

      await page.evaluate((text) => {
        const active = document.activeElement;
        if (active && active.isContentEditable) {
          document.execCommand('insertText', false, text);
          return;
        }

        const boxes = document.querySelectorAll('div[contenteditable="true"]');
        const lastVisible = [...boxes].filter((box) => box.offsetParent !== null).pop();
        if (lastVisible) {
          lastVisible.focus();
          document.execCommand('insertText', false, text);
        }
      }, caption);

      await humanDelay(randomBetween(300, 600));
      logger.info('Caption typed');
    } catch (err) {
      logger.warn(`Caption input not found, sending without caption: ${err.message}`);
    }
  }

  let sent = false;
  try {
    const { button, selector } = await waitForMediaSendButton();
    await safeClick(button, `Image send button (${selector})`);
    sent = true;
    logger.info(`Image send button clicked (${selector})`);
  } catch (err) {
    logger.warn(`Image send button lookup failed: ${err.message}`);
  }

  if (!sent) {
    await captureDebugScreenshot('image-send-button-missing');
    try {
      const captionBox = await page.$(SELECTORS.captionInput);
      if (captionBox) {
        await safeClick(captionBox, 'Caption input fallback', 2);
      }
    } catch (err) {
      logger.debug(`Caption fallback focus failed: ${err.message}`);
    }
    await page.keyboard.press('Enter');
    logger.warn('Image send button not found; pressed Enter from preview as fallback');
  }

  await humanDelay(randomBetween(CONFIG.delays.postImageSendMin, CONFIG.delays.postImageSendMax));
  logger.info('Image sent successfully');
  return { success: true };
}

module.exports = {
  initBrowser,
  openWhatsApp,
  waitForLogin,
  isReady,
  closeBrowser,
  openChat,
  sendMessage,
  sendImage,
  waitForAttachButton,
};
